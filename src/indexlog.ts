/**
 * 「会话索引」模板、不可变条目继承、以及超量归档：需求(b) 的落地处。
 *
 * 为什么从「叙事摘要」改成「索引」——依据是一次真实会话上的 A/B 实测
 * （`AB实测报告.md`，语料 session-<REDACTED>，9 次真实压缩）：
 *
 * - 官方滚动重压把早期 407 条字面事实**从第 1 代起就丢光（0%）**，却占 **7703 token**；
 * - 官方引擎的替换区间**起点恰好是上一份摘要的 seq**（9/9 次），即每代都在重写旧摘要，
 *   早期内容被反复磨平——这是"干了后面忘了前面"的机制根源；
 * - 而原文在 append-only 日志里**一条不少**，按锚点检索可 100% 取回。
 *
 * 于是本模块做三件事：
 * 1. 让模型只写**一个新条目**（标题 / 状态 / 未决）+ 一个「当前状态」小节，不再复述细节；
 * 2. 由 {@link assembleIndex} 把**上一份索引的旧条目逐字继承**到新摘要里。
 *    官方虽然会重压整个区间，但只要旧条目的文本被原样搬运，早期内容就**不再被重写**——
 *    等于在官方钩子里实现了索引的不可变性；
 * 3. **超量归档**：条目只增不减的话，索引最终会长到比被压内容还大，引擎的自保护会直接拒绝
 *    （实测到：`summary is not smaller than the shadowed content (760 >= 740)`）。
 *    所以表层只保留最新 {@link MAX_ENTRIES_IN_SURFACE} 条，更早的压成**一行归档指针**：
 *    正文移出表层，但因为序号与锚点一一对应，原文随时可逐字取回。
 *
 * seq 锚点不写进条目（`SummarizationInput` 不含 seq），而由工具侧用**序号 `T<n>`** 对齐：
 * 第 n 个成功压缩事务 ↔ 第 n 条索引条目。
 *
 * @module @local/dsh-context-continuum/indexlog
 */

import { createUserMessage, type ContentBlock, type Message } from '@deepseek-ai/dsh-llm'
import { blocksToText } from './anchors.ts'
import type { ArtifactPointer } from './artifacts.ts'

/** 稳定标记：既用于在输入里认出上一份索引，也用于在日志/测试里识别模板版本。 */
export const INDEX_MARKER = '<!-- CONTINUUM-INDEX v1 -->'

/** 索引正标题；规整时保证有且仅有一处。 */
export const INDEX_HEADER = '## 会话索引（不可变条目，只追加）'

/** 当前状态小节标题。该小节每代重写（它必须反映最新状态），旧条目则逐字继承。 */
export const CURRENT_STATE_HEADER = '## 当前状态'

/** 条目行前缀；`T<n>` 的 n 与工具侧第 n 个成功压缩事务对齐。 */
export const ENTRY_PREFIX = '### T'

/** 条目标题的长度上限（超出即截断，防止模型写成长摘要）。 */
export const MAX_TITLE_CHARS = 60

/** 表层最多保留多少条条目正文；超出即降级为归档指针。 */
export const MAX_ENTRIES_IN_SURFACE = 24

/** 归档行前缀。 */
export const ARCHIVE_PREFIX = '- 已归档：'

/** 归档行里 `T首…T末` 的解析式；归档后序号必须继续递增，所以它同时是"最高序号"的来源。 */
const ARCHIVE_RE = /已归档[:：]\s*T(\d+)\D{1,4}T(\d+)/

/** 指导文本的稳定标记（版本随格式变更递增）。 */
export const GUIDANCE_MARKER = 'CONTEXT-CONTINUUM-INDEX-V1'

/**
 * 压缩指导正文。
 *
 * 每条规则都对应一条真实失效模式：写细节会挤掉后续能力且仍会丢（实测 0% 存活）；
 * 产物由模型写会编造；不要求"信息不足就说信息不足"会让模型补全出假历史。
 */
export const INDEX_GUIDANCE = `${GUIDANCE_MARKER}
你正在为一段**即将被压出上下文**的历史生成索引条目。索引的用途是"让人知道发生过什么、能去哪找"，
**不是**保存细节——详情仍可用 context_read 按锚点逐字取回。规则：

1. 只输出**一个条目**，其后可选地给一个「${CURRENT_STATE_HEADER}」小节。
2. 条目格式严格如下（序号我会在最后一行告诉你）：
   \`${ENTRY_PREFIX}<n> <一行标题>\`
   \`- 状态：完成\`（或 \`未完成\`）
   \`- 未决：<一句话；没有就写"无">\`
3. **只有这 3 行会被采用**：标题行、状态行、未决行。你写的其它任何正文（段落、小节标题、
   逐字引用、要点列表）都会被系统**直接丢弃**——因为详情本来就可用锚点逐字取回。
   凡是要留下的信息，必须写进标题或「未决」那一句里。
4. 标题写"这段历史干了什么"，不超过 ${MAX_TITLE_CHARS} 字；不写过程、不写"我将要……"。
5. **不要**列举文件路径、命令或具体数字——产物由系统确定性抽取，你写了也不会被采用。
6. 「${CURRENT_STATE_HEADER}」小节只写两行：\`- 正在做：…\` 与 \`- 下一步：…\`。
7. 每一句都必须是历史里真的出现过的事；信息不足就写"信息不足"，**禁止**猜测或补全。`

/** 模型没产出可用内容时的条目兜底：如实写明缺失，而不是造一条看起来完整的条目。 */
export const EMPTY_ENTRY_NOTE = '（本次压缩未产出可用条目）'

/** 整体兜底正文（导出供测试与降级路径使用）。 */
export const EMPTY_INDEX = `${INDEX_MARKER}\n${INDEX_HEADER}\n\n${ENTRY_PREFIX}0 ${EMPTY_ENTRY_NOTE}\n- 状态：未完成\n- 未决：索引生成失败；原始历史仍完整保留在会话日志中，可用 context_read 按锚点取回。\n\n${CURRENT_STATE_HEADER}\n- 正在做：信息不足\n- 下一步：信息不足`

/** 当前状态缺失时的兜底行。 */
export const EMPTY_CURRENT = '- 正在做：信息不足\n- 下一步：信息不足'

/** 构造追加到压缩请求尾部的指导消息（只进入这次辅助调用，不写入会话日志）。 */
export function buildGuidanceMessage(nextOrdinal: number): Message {
  return createUserMessage({
    content: [{ type: 'text', text: `${INDEX_GUIDANCE}\n\n本次条目序号：T${nextOrdinal}` }],
    // 该消息仅存在于辅助调用中，不会进入持久日志；用 user 源避免依赖别处注册的 source kind。
    source: { kind: 'user' },
  })
}

/** 从一份已存在的索引正文里抽出的可继承部分。 */
export interface InheritedIndex {
  /** 旧条目原文（从标记/标题之后到「当前状态」之前），**逐字**保留（含归档指针行）。 */
  readonly entries: string
  /** 旧的「当前状态」小节正文（每代重写，仅供参考）。 */
  readonly current: string
  /** 表层可见的条目条数（归档掉的不计）。 */
  readonly entryCount: number
  /**
   * 下一条条目应当使用的序号。
   *
   * **不能**用 `entryCount + 1`：一旦开始归档，可见条目数就不再增长，序号会重复。
   * 因此从"见过的最高 T"（可见条目行 + 归档行的上界）推导。
   */
  readonly nextOrdinal: number
}

/** 空继承：本次是第一代压缩（或输入里没有索引）。 */
export const NO_INHERITANCE: InheritedIndex = { entries: '', current: '', entryCount: 0, nextOrdinal: 1 }

/** 数表层可见条目条数。 */
function countEntries(entries: string): number {
  let count = 0
  for (const line of entries.split(/\r?\n/)) {
    if (/^###\s*T\d+\b/.test(line.trim())) count += 1
  }
  return count
}

/**
 * 见过的最高条目序号：可见条目行与归档行上界取最大。
 *
 * 归档行的上界必须计入——否则归档之后 `nextOrdinal` 会回退，序号立刻重复。
 */
export function highestOrdinal(entries: string): number {
  let highest = 0
  for (const line of entries.split(/\r?\n/)) {
    const trimmed = line.trim()
    const entry = /^###\s*T(\d+)\b/.exec(trimmed)
    if (entry?.[1] !== undefined) highest = Math.max(highest, Number(entry[1]))
    const archive = ARCHIVE_RE.exec(trimmed)
    if (archive?.[2] !== undefined) highest = Math.max(highest, Number(archive[2]))
  }
  return highest
}

/** 归档指针行：正文移出表层，但锚点仍在，原文可逐字取回。 */
export function archiveLine(first: number, last: number): string {
  const count = last - first + 1
  return `${ARCHIVE_PREFIX}T${first}…T${last}（共 ${count} 条，正文已移出表层；`
    + '原文仍在 append-only 日志里，用 context_anchors 查锚点后以 context_read 按 seq 逐字取回）'
}

/**
 * 在给定文本里认出上一份索引并拆成「旧条目 + 旧当前状态」。
 *
 * 找不到标记就返回空继承——宁可当成第一代，也不要把无关正文误当条目继承下去。
 */
export function extractInheritedIndex(text: string): InheritedIndex {
  const markerAt = text.indexOf(INDEX_MARKER)
  const headerAt = text.indexOf(INDEX_HEADER)
  let bodyStart: number
  if (markerAt >= 0) bodyStart = markerAt + INDEX_MARKER.length
  else if (headerAt >= 0) bodyStart = headerAt + INDEX_HEADER.length
  else return NO_INHERITANCE

  const currentAt = text.indexOf(CURRENT_STATE_HEADER, bodyStart)
  let entries = currentAt >= 0 ? text.slice(bodyStart, currentAt) : text.slice(bodyStart)
  // 标记之后紧跟的正标题行不属于条目，去掉；重复出现的标题也去掉（规整保证唯一）。
  entries = entries
    .split(/\r?\n/)
    .filter((line) => line.trim() !== INDEX_HEADER)
    .join('\n')
    .trim()
  const current = currentAt >= 0 ? text.slice(currentAt + CURRENT_STATE_HEADER.length).trim() : ''
  return {
    entries,
    current,
    entryCount: countEntries(entries),
    nextOrdinal: highestOrdinal(entries) + 1,
  }
}

/** 压掉连续空行（最多保留一个），并去掉首尾空白。 */
export function cleanBlankRuns(text: string): string {
  const out: string[] = []
  let blank = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[ \t]+$/, '')
    if (line.trim() === '') {
      blank += 1
      if (blank === 1) out.push('')
      continue
    }
    blank = 0
    out.push(line)
  }
  while (out.length > 0 && out[0] === '') out.shift()
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** 把一行标题截断到 {@link MAX_TITLE_CHARS}，超出加省略号。 */
export function clipTitle(title: string): string {
  const single = title.replace(/\s+/g, ' ').trim()
  return single.length <= MAX_TITLE_CHARS ? single : `${single.slice(0, MAX_TITLE_CHARS)}…`
}

/**
 * 把继承来的条目正文拆成一条条条目块。
 *
 * 首个 `### T<n>` 之前的行（归档指针、杂散文字）**一律丢弃**：归档指针由
 * {@link assembleIndex} 依"最高序号 - 保留条数"重新生成，不继承旧的那一行。
 */
export function splitEntryBlocks(entries: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  for (const line of entries.split(/\r?\n/)) {
    if (/^###\s*T\d+\b/.test(line.trim())) {
      if (current.length > 0) blocks.push(current.join('\n').trim())
      current = [line]
      continue
    }
    if (current.length > 0) current.push(line)
  }
  if (current.length > 0) blocks.push(current.join('\n').trim())
  return blocks
}

/** 在若干行里取第一条匹配 `正则` 的第 1 个捕获组。 */
function firstMatching(lines: readonly string[], regex: RegExp): string | undefined {
  for (const line of lines) {
    const matched = regex.exec(line.trim())
    const captured = matched?.[1]
    if (captured !== undefined && captured.trim() !== '') return captured.trim()
  }
  return undefined
}

/**
 * 从模型输出里取出「新条目」与「当前状态」，并强制条目序号为期望值。
 *
 * **只采用标题行与状态/未决两行，其余正文一律丢弃**——依据真实宿主实测（两轮）：
 * 宿主会在本插件的指导消息之后**再追加自己的压缩指令**，因此模型往往返回官方那套
 * 叙事结构（`## Primary Request and Intent` 等），而且**会把叙事接在「当前状态」之后**。
 * 本插件改不到宿主的追加位置，于是把"强制"放在组装器里：
 * - 条目只留标题 + 状态 + 未决三行；
 * - 「当前状态」也**只留**「正在做」「下一步」两行，其后的内容同样丢弃。
 * 详情按设计走锚点检索（原文在 append-only 日志里一条不少）。
 */
export function extractNewEntry(text: string, ordinal: number): { entry: string; current: string } {
  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== INDEX_MARKER && line.trim() !== INDEX_HEADER)
    .join('\n')

  const currentAt = cleaned.indexOf(CURRENT_STATE_HEADER)
  const entryPart = (currentAt >= 0 ? cleaned.slice(0, currentAt) : cleaned).trim()
  const currentPart = currentAt >= 0 ? cleaned.slice(currentAt + CURRENT_STATE_HEADER.length) : ''

  const lines = entryPart.split(/\r?\n/)
  const titleAt = lines.findIndex((line) => /^###\s*T\d+\b/.test(line.trim()))
  const rawTitle = (
    titleAt >= 0 ? lines[titleAt]!.trim().replace(/^###\s*T\d+\s*/, '') : (lines.find((line) => line.trim() !== '') ?? '')
  ).replace(/^#+\s*/, '')

  const status = firstMatching(lines, /^[-*]?\s*状态[:：]\s*(.+)$/)
  const pending = firstMatching(lines, /^[-*]?\s*未决[:：]\s*(.+)$/)

  // 当前状态同样只认那两行：模型常把整段官方叙事接在这个标题之后。
  const currentLines = currentPart.split(/\r?\n/)
  const doing = firstMatching(currentLines, /^[-*]?\s*正在做[:：]\s*(.+)$/)
  const next = firstMatching(currentLines, /^[-*]?\s*下一步[:：]\s*(.+)$/)
  const current =
    doing === undefined && next === undefined
      ? EMPTY_CURRENT
      : `- 正在做：${doing ?? '信息不足'}\n- 下一步：${next ?? '信息不足'}`

  const title = rawTitle === '' ? EMPTY_ENTRY_NOTE : clipTitle(rawTitle)
  const entry = `${ENTRY_PREFIX}${ordinal} ${title}`
    + `\n- 状态：${status ?? '未完成（模型未给出）'}`
    + `\n- 未决：${pending ?? '信息不足'}`
  return { entry, current }
}

/** 组装索引所需的全部材料。 */
export interface AssembleIndexInput {
  /** 本条新条目的序号。 */
  readonly ordinal: number
  /** 模型产出的新条目（已经过 {@link extractNewEntry}）。 */
  readonly newEntry: string
  /**
   * 由事件流确定性抽取的产物（**不来自模型**）。
   *
   * 可以给裸路径（消息面抽取、无 seq），也可以给 {@link ArtifactPointer}
   * （官方账本、带 seq 与存在性）——后者渲染成 `path ✓@seq`，可回原文、可当场校验。
   */
  readonly artifacts: readonly (string | ArtifactPointer)[]
  /** 重写后的当前状态小节正文。 */
  readonly current: string
  /** 从上一份索引里逐字继承的旧条目。 */
  readonly inherited: InheritedIndex
}

/**
 * 把产物渲染成条目下的一行。
 *
 * 指针形态：`\`path\` ✓@1234`（存在/带 seq）、`\`path\` ✗@1234`（抽取时磁盘上不存在）、
 * `\`path\``（消息面抽取，无 seq，不做断言）。**只报实测结果，不猜。**
 */
export function renderArtifactLine(artifacts: readonly (string | ArtifactPointer)[], max: number): string {
  if (artifacts.length === 0) return '- 产物：（本区间无产物记录）'
  const shown = artifacts.slice(0, max)
  const more = artifacts.length > shown.length ? `（另有 ${artifacts.length - shown.length} 条未列出）` : ''
  const cells = shown.map((item) => {
    if (typeof item === 'string') return `\`${item}\``
    const mark = item.exists === undefined ? '' : item.exists ? ' ✓' : ' ✗'
    const seq = item.seq === undefined ? '' : `@${item.seq}`
    return `\`${item.path}\`${mark}${seq}`
  })
  return `- 产物：${cells.join('、')}${more}`
}

/**
 * 组装最终摘要：归档指针 → 保留的旧条目 → 新条目 → 产物 → 当前状态。
 *
 * 这里刻意不做任何"智能合并"——继承段原样拼接，是为了让"早期条目永不被重写"
 * 成为可验证的结构事实，而不是依赖模型每次都愿意照抄。
 *
 * 表层条目数封顶 {@link MAX_ENTRIES_IN_SURFACE}：超出部分不再携带正文，只留一行归档指针。
 * 归档区间恒为前缀 `T1…Tk`（序号从 1 连续递增、且只增不改），因此
 * `k = 历史条目总数 - 保留条数`，而历史条目总数由 `inherited.nextOrdinal - 1` 给出。
 */
export function assembleIndex(
  input: AssembleIndexInput,
  maxArtifacts = 40,
  maxEntries = MAX_ENTRIES_IN_SURFACE,
): string {
  const blocks = splitEntryBlocks(input.inherited.entries)
  const keep = Math.max(0, maxEntries - 1)
  const kept = keep === 0 ? [] : blocks.slice(Math.max(0, blocks.length - keep))
  const totalEntries = Math.max(input.inherited.nextOrdinal - 1, blocks.length)
  const archivedCount = Math.max(0, totalEntries - kept.length)

  const lines: string[] = [INDEX_MARKER, INDEX_HEADER, '']
  if (archivedCount > 0) lines.push(archiveLine(1, archivedCount), '')
  for (const block of kept) lines.push(block, '')
  lines.push(input.newEntry.trim())
  lines.push(renderArtifactLine(input.artifacts, maxArtifacts))
  lines.push('', CURRENT_STATE_HEADER, input.current.trim() === '' ? EMPTY_CURRENT : input.current.trim())
  return cleanBlankRuns(lines.join('\n'))
}

/** 把任意内容块收成索引文本；空内容给出显式兜底而不是空串。 */
export function normalizeIndex(blocks: readonly ContentBlock[]): ContentBlock[] {
  const raw = blocksToText(blocks)
  if (raw === '') return [{ type: 'text', text: EMPTY_INDEX }]
  return [{ type: 'text', text: cleanBlankRuns(raw) }]
}
