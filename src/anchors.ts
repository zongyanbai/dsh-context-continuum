/**
 * 锚点账本：从 append-only 会话日志里，把「压缩摘要 ↔ 被遮蔽的原始事件」这条链抽出来。
 *
 * 为什么锚点从日志取、而不是从摘要正文里造：
 * 宿主在 `compaction/summary` 事件上已经写下了 `shadowedSeqs`（被替换的 surface 节点
 * 的权威 seq 集合）与 `summary`（摘要正文）、`rawOutput`（投影前的完整输出）。也就是说
 * 「摘要 → 原文」的对应关系**在持久日志里本来就有**，且由 `compactionId` 唯一关联。
 * 于是回溯不需要信任模型在正文里写没写锚点——模型只是可读性的补充，账本才是事实来源。
 *
 * @module @local/dsh-context-continuum/anchors
 */

/** 本模块只依赖日志事件的最小结构面，不绑定宿主具体的 SessionEvent 联合类型。 */
export interface LogEventLike {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: unknown
}

/** 一次压缩事务在日志里留下的完整锚点。 */
export interface CheckpointAnchor {
  /** 事务身份；`compaction/start`、`compaction/summary`、`compaction/end` 共享它。 */
  readonly compactionId: string
  /**
   * 成功事务的 1-based 时序序号；与索引条目 `T<n>` 一一对应（失败事务无序号）。
   * 索引条目里不写 seq（压缩钩子拿不到 seq），所以序号就是"索引 ↔ 锚点"的连接键。
   */
  readonly ordinal: number | undefined
  /** 摘要事件自身的 seq（定位摘要正文用）。 */
  readonly summarySeq: number | undefined
  /** 被替换区间的首/末 surface 节点 seq。注意这是**位置跨度**，start 可能大于 end。 */
  readonly startSeq: number | undefined
  readonly endSeq: number | undefined
  /** 被遮蔽节点的全部 seq，按 surface 顺序——这是回溯的权威入口。 */
  readonly shadowedSeqs: readonly number[]
  /** 被遮蔽内容的估算 token 数（省了多少上下文）。 */
  readonly shadowedTokenCount: number | undefined
  /** 写这条摘要的 provider / model（用于回答"这条摘要谁写的"）。 */
  readonly provider: string | undefined
  readonly model: string | undefined
  /** 摘要正文的纯文本。 */
  readonly summaryText: string
  /** 该事务是否失败（`compaction/end` 带 error）。 */
  readonly error: string | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** `blocksToText` 的选项。 */
export interface BlocksToTextOptions {
  /**
   * 是否把非文本块（`tool_use` / `tool_result` 等）的**内容**一并展开。
   *
   * 默认 `false`：索引与摘要路径要紧凑，非文本块只留 `[type]` 占位。
   * 原文取回路径（`context_read`）必须传 `true`——否则工具调用的参数（路径类事实的
   * 主要载体）会被静默丢成 `[tool_use]`，真实日志端到端实测取回率只有 76.8%。
   */
  readonly includeBlockPayload?: boolean
}

/**
 * 按**值原样**渲染一段载荷（逐字取回用）。
 *
 * 关键：**不加转义层**。工具调用的 `arguments` 本身已是 JSON 文本（内部已含 `\\`），
 * 再套一层 `JSON.stringify` 会变成 `\\\\`，那就不是逐字原文了——实测正是这一层
 * 多余的转义让 19 条路径事实看起来"取不回"。这里只做结构展开，字符串一律原样给出。
 */
export function renderValue(value: unknown, depth = 0): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (depth >= 8) return ''
  if (Array.isArray(value)) {
    return value.map((item) => renderValue(item, depth + 1)).filter((part) => part !== '').join('\n')
  }
  const record = asRecord(value)
  if (record === undefined) return ''
  const lines: string[] = []
  for (const [key, item] of Object.entries(record)) {
    const text = renderValue(item, depth + 1)
    if (text !== '') lines.push(`${key}: ${text}`)
  }
  return lines.join('\n')
}

/** 除 `type`/`text` 外的块字段按值原样给出；空则返回空串。 */
function blockPayloadToText(record: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(record)) {
    if (key === 'type' || key === 'text') continue
    const text = renderValue(value)
    if (text !== '') lines.push(`${key}: ${text}`)
  }
  return lines.join('\n')
}

/**
 * 把内容块数组压成纯文本；非文本块按类型占位，保证摘要长度不会被静默吞掉。
 *
 * `includeBlockPayload: true` 时连块内容一起展开（逐字取回用）；默认保持紧凑占位
 * （索引 / 摘要路径用）。两条路径的长度预算不同，所以共用一种渲染是错的。
 */
export function blocksToText(blocks: unknown, options?: BlocksToTextOptions): string {
  if (!Array.isArray(blocks)) return ''
  const includePayload = options?.includeBlockPayload === true
  const parts: string[] = []
  for (const block of blocks) {
    const record = asRecord(block)
    if (record === undefined) continue
    const text = asString(record['text'])
    if (text !== undefined) {
      parts.push(text)
      continue
    }
    const type = asString(record['type'])
    const name = asString(record['name'])
    const label = type === undefined ? '' : name === undefined ? `[${type}]` : `[${type} ${name}]`
    if (!includePayload) {
      if (label !== '') parts.push(label)
      continue
    }
    const payload = blockPayloadToText(record)
    if (label === '' && payload === '') continue
    parts.push(label === '' ? payload : payload === '' ? label : `${label} ${payload}`)
  }
  return parts.join('\n').trim()
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const item of value) {
    const n = asNumber(item)
    if (n !== undefined) out.push(n)
  }
  return out
}

/**
 * 按 `compactionId` 归并日志事件，产出锚点账本。
 *
 * 只认 `compaction/*` 事件的真实字段，不读模型自称；缺字段就如实留空，
 * 不用 0 或空串把"不知道"伪装成"知道"。
 */
export function collectCheckpoints(events: readonly LogEventLike[]): CheckpointAnchor[] {
  interface Draft {
    compactionId: string
    summarySeq: number | undefined
    startSeq: number | undefined
    endSeq: number | undefined
    shadowedSeqs: readonly number[]
    shadowedTokenCount: number | undefined
    provider: string | undefined
    model: string | undefined
    summaryText: string
    error: string | undefined
  }
  const drafts = new Map<string, Draft>()
  const ensure = (compactionId: string): Draft => {
    const existing = drafts.get(compactionId)
    if (existing !== undefined) return existing
    const created: Draft = {
      compactionId,
      summarySeq: undefined,
      startSeq: undefined,
      endSeq: undefined,
      shadowedSeqs: [],
      shadowedTokenCount: undefined,
      provider: undefined,
      model: undefined,
      summaryText: '',
      error: undefined,
    }
    drafts.set(compactionId, created)
    return created
  }

  for (const event of events) {
    if (event.type !== 'compaction/summary' && event.type !== 'compaction/end') continue
    const data = asRecord(event.data)
    if (data === undefined) continue
    const compactionId = asString(data['compactionId'])
    if (compactionId === undefined) continue
    const draft = ensure(compactionId)
    if (event.type === 'compaction/summary') {
      draft.summarySeq = event.seq
      const range = asRecord(data['shadowedRange'])
      if (range !== undefined) {
        draft.startSeq = asNumber(range['start'])
        draft.endSeq = asNumber(range['end'])
      }
      draft.shadowedSeqs = numberArray(data['shadowedSeqs'])
      draft.shadowedTokenCount = asNumber(data['shadowedTokenCount'])
      draft.provider = asString(data['provider'])
      draft.model = asString(data['model'])
      draft.summaryText = blocksToText(data['summary'])
    } else {
      draft.error = asString(data['error'])
    }
  }

  const out = [...drafts.values()]
  // 稳定顺序：按摘要 seq 升序（时间串联），缺 seq 的排最后。
  out.sort((a, b) => (a.summarySeq ?? Number.MAX_SAFE_INTEGER) - (b.summarySeq ?? Number.MAX_SAFE_INTEGER))
  // 只给真正产出了摘要的事务编号：序号必须与索引条目一一对应，
  // 因此失败/无摘要的事务留 undefined，不用 0 把"没有"伪装成一个序号。
  let ordinal = 0
  return out.map((draft): CheckpointAnchor => {
    if (draft.summarySeq === undefined && draft.summaryText === '') return { ...draft, ordinal: undefined }
    ordinal += 1
    return { ...draft, ordinal }
  })
}

/** 一次压缩实际压掉了多少上下文（用于向用户交代"省了多少"）。 */
export function totalShadowedTokens(anchors: readonly CheckpointAnchor[]): number {
  let total = 0
  for (const anchor of anchors) total += anchor.shadowedTokenCount ?? 0
  return total
}
