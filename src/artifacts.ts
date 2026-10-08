/**
 * 产物账本的**确定性**抽取：不让模型凭记忆写路径（它必然编）。
 *
 * 来源与依据（实测）：`deliverables/presented` 事件带 `files[].path`，是官方最权威的产物账本；
 * 但它**不是 surface 事件**，因此不在 `SummarizationInput.messages` 里。压缩钩子能拿到的
 * 只有消息面，所以这里从**助手消息里的写文件类 `tool-call` 块**抽参数中的路径——
 * 这与工具真正执行过的事实同源，仍然不依赖模型记忆。
 *
 * 已知限制：只会命中"写/改/建/呈现"类工具；模型若用别的方式产生产物（例如经命令重定向），
 * 这里抽不到，索引会写「本区间无产物记录」——**如实缺失，不猜**。
 *
 * @module @local/dsh-context-continuum/artifacts
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import { existsSync } from 'node:fs'
import type { LogEventLike } from './anchors.ts'
import { readSessionEvents, type SessionQueryLike } from './trace.ts'

/** 绝对路径（Windows 盘符形式）。字符类刻意排除引号/逗号/分号/右括号，避免把 JSON 尾巴吃进来。 */
const PATH_WIN = /[A-Za-z]:\\[^\s"'`,;)]{3,170}/g

/**
 * 带已知扩展名的相对路径。
 *
 * 左边界 `(?<![\w:.\\/-])` 是必需的：没有它，绝对路径的尾巴
 * （`C:\Users\Someone\a.md` 里的 `Users\Someone\a.md`）会被当成第二条产物，
 * 产物账本因此凭空翻倍——这是实测踩到的失效模式，不是理论担忧。
 */
const PATH_REL =
  /(?<![\w:.\\/-])[A-Za-z0-9_\-.]+(?:[\\/][A-Za-z0-9_\-.]+)+\.(?:py|json|jsonl|md|ts|tsx|js|mjs|cjs|cmd|ps1|txt|csv|yml|yaml|toml)/g

/** 只有这些工具的参数才可能承载产物路径。 */
const WRITE_TOOL = /write|edit|create|save|append|patch|move|copy|present|mkdir/i

/** 默认最多列出多少条产物（超出只报数量，防止索引本身变长）。 */
export const MAX_ARTIFACTS = 40

function walkStrings(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, out)
    return
  }
  if (typeof node === 'object' && node !== null) {
    for (const value of Object.values(node as Record<string, unknown>)) walkStrings(value, out)
  }
}

/**
 * 把重复的反斜杠收成单个。
 *
 * `tool-call` 的 `arguments` 本身是**一段 JSON 字符串**，其中的路径是转义形式（`C:\\Users`）。
 * 能 `JSON.parse` 时拿到的是真实路径；解析失败时才需要这层收拢。对单反斜杠幂等。
 */
function normalizePath(path: string): string {
  return path.replace(/\\\\+/g, '\\').replace(/\\+$/, '')
}

function collectPaths(text: string, out: string[]): void {
  for (const regex of [PATH_WIN, PATH_REL]) {
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const path = normalizePath(match[0])
      if (path.length >= 4) out.push(path)
    }
  }
}

/** 从消息面抽产物路径：去重、保持首次出现顺序、最多返回 `max` 条。 */
export function extractArtifactPaths(messages: readonly Message[], max = MAX_ARTIFACTS): string[] {
  const seen = new Set<string>()
  const found: string[] = []
  for (const message of messages) {
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const record = block as { type?: unknown; name?: unknown; arguments?: unknown }
      if (record?.type !== 'tool-call') continue
      const name = typeof record.name === 'string' ? record.name : ''
      if (!WRITE_TOOL.test(name)) continue
      const raw = typeof record.arguments === 'string' ? record.arguments : ''
      const strings: string[] = []
      if (raw !== '') {
        try {
          walkStrings(JSON.parse(raw), strings)
        } catch {
          strings.push(raw)
        }
      }
      for (const text of strings) {
        const paths: string[] = []
        collectPaths(text, paths)
        for (const path of paths) {
          if (seen.has(path)) continue
          seen.add(path)
          found.push(path)
          if (found.length >= max) return found
        }
      }
    }
  }
  return found
}

/** 一条来自官方产物账本的产物。 */
export interface PresentedArtifact {
  readonly path: string
  /** 官方给的说明；没给就是 undefined（不编）。 */
  readonly description: string | undefined
  /** 写下这条产物的 `deliverables/presented` 事件的 seq——用它可回原文定位。 */
  readonly seq: number | undefined
}

/**
 * 索引里的一条**产物指针**。
 *
 * 与"只写一个路径"的区别：`seq` 让它可回原文（可定位），`exists` 让它可当场校验
 * （磁盘上在不在）。实测口径：带指针的条目里 111 条产物有 109 条真实存在；
 * 而旧格式（只有裸路径）在 39 代会话上携带 **0** 条可解析指针。
 */
export interface ArtifactPointer {
  readonly path: string
  readonly seq?: number | undefined
  /** 抽取时实测的磁盘存在性；undefined 表示不检查（例如消息面抽取的路径）。 */
  readonly exists?: boolean | undefined
}

/** 校验一条产物指针的磁盘存在性（抽取侧做，渲染侧保持纯函数）。 */
function checkExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * 从 `deliverables/presented` 事件里取**权威**产物账本。
 *
 * 为什么这才是权威来源：该事件由宿主在 `present` 成功时写入，载荷是
 * `{ turn, callId, files: [{ path, description }] }`；而 `workspace/changes` 的载荷
 * **只有 `{ turn }`、不含路径**（实测确认）。消息面抽取只是它不可得时的降级手段。
 */
export function presentedArtifactsFromEvents(events: readonly LogEventLike[]): PresentedArtifact[] {
  const seen = new Set<string>()
  const out: PresentedArtifact[] = []
  for (const event of events) {
    if (event.type !== 'deliverables/presented') continue
    const data = event.data as { files?: unknown } | undefined
    const files = data?.files
    if (!Array.isArray(files)) continue
    for (const file of files) {
      const record = file as { path?: unknown; description?: unknown } | null
      if (record === null || typeof record !== 'object') continue
      const rawPath = record.path
      if (typeof rawPath !== 'string') continue
      const path = normalizePath(rawPath)
      if (path.length < 2 || seen.has(path)) continue
      seen.add(path)
      const rawDescription = record.description
      out.push({
        path,
        description:
          typeof rawDescription === 'string' && rawDescription.trim() !== ''
            ? rawDescription.trim()
            : undefined,
        seq: typeof event.seq === 'number' ? event.seq : undefined,
      })
    }
  }
  return out
}

/**
 * 读权威产物账本并剔除"索引里已经有的"。
 *
 * 剔除靠**文本包含**判断，不需要 seq：继承来的旧条目里已经写着旧产物路径，
 * 因此剩下的就是本区间新增的。返回 `undefined` 表示**读不到**（调用方据此区分
 * "本区间确实没有新产物"与"读不到账本"，不把后者伪装成前者）。
 */
export async function readPresentedArtifacts(
  sessionQuery: SessionQueryLike | undefined,
  sessionId: string,
  alreadyPresent: string,
  max = MAX_ARTIFACTS,
): Promise<readonly string[] | undefined> {
  if (sessionQuery === undefined) return undefined
  const events = await readSessionEvents(sessionQuery, sessionId)
  if (events === undefined) return undefined
  const found: string[] = []
  for (const artifact of presentedArtifactsFromEvents(events)) {
    if (alreadyPresent.includes(artifact.path)) continue
    found.push(artifact.path)
    if (found.length >= max) break
  }
  return found
}

/**
 * 与 {@link readPresentedArtifacts} 同源，但返回**带 seq 与存在性**的指针。
 *
 * 同一份日志、同一套"剔除索引里已经有的"规则；区别只是把 seq 留下、并当场校验磁盘存在性，
 * 这样索引里的每条产物都能被独立复验（可回原文 + 在不在）。
 */
export async function readPresentedArtifactPointers(
  sessionQuery: SessionQueryLike | undefined,
  sessionId: string,
  alreadyPresent: string,
  max = MAX_ARTIFACTS,
): Promise<readonly ArtifactPointer[] | undefined> {
  if (sessionQuery === undefined) return undefined
  const events = await readSessionEvents(sessionQuery, sessionId)
  if (events === undefined) return undefined
  const found: ArtifactPointer[] = []
  for (const artifact of presentedArtifactsFromEvents(events)) {
    if (alreadyPresent.includes(artifact.path)) continue
    found.push({ path: artifact.path, seq: artifact.seq, exists: checkExists(artifact.path) })
    if (found.length >= max) break
  }
  return found
}
