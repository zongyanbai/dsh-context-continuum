/**
 * 原文回溯层：需求(c)「需要找具体上下文时，回原始对话里定位」的落地处。
 *
 * 事实基础（已核实）：压缩只是**替换 surface 派生**，被遮蔽的原始事件仍逐字留在
 * append-only 会话日志里；`compaction/summary` 事件上的 `shadowedSeqs` 就是权威入口。
 * 因此回溯 = 读出锚点 seq → 按 seq 取回原始事件文本。
 *
 * 为什么端口是防御式的（duck-typed）：
 * 宿主在 RC 期调整过会话读取面（`Session.snapshotEvents()` / `eventAt()` 已被官方标记
 * deprecated、并明确"新调用禁止"），替代面是 `ctx.sessionQuery`，其请求/返回结构仍在演进。
 * 这里按"多形状尝试 + 只信实际取到的字段"处理：能取到就给原文，取不到就如实报告失败，
 * 绝不把"读不到"包装成"没有原文"。
 *
 * @module @local/dsh-context-continuum/trace
 */

import { blocksToText, renderValue, type LogEventLike } from './anchors.ts'

/** `ctx.sessionQuery` 的最小结构面。 */
export interface SessionQueryLike {
  readSession?: (request: unknown) => Promise<unknown>
  readEvent?: (request: unknown) => Promise<unknown>
}

/** 一段被取回的原始历史。 */
export interface OriginalSlice {
  readonly seq: number
  readonly type: string
  /** 该事件的可见文本（逐字，不做摘要）。 */
  readonly text: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') return value
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/** 从任意形状的事件记录里取出「类型 / seq / 时间 / 数据体」。 */
export function toLogEventLike(value: unknown): LogEventLike | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const type = typeof record['type'] === 'string' ? record['type'] : undefined
  if (type === undefined) return undefined
  const seq = firstNumber(record['seq'], record['sequence'])
  const time = firstNumber(record['time'], record['timestamp'])
  const data = record['data']
  const out: { type: string; seq?: number; time?: number; data?: unknown } = { type }
  if (seq !== undefined) out.seq = seq
  if (time !== undefined) out.time = time
  if (data !== undefined) out.data = data
  return out
}

/**
 * 取出一个事件里**逐字**的可见文本。
 *
 * 覆盖 `user/message`、`assistant/message`、`tool/result` 与压缩摘要等常见承载字段；
 * 内容块走 `blocksToText(..., { includeBlockPayload: true })`——工具调用的参数
 * （`tool_use` 块的 `input`、`tool/call` 的 `arguments`）是路径类事实的主要载体，
 * 只留 `[tool_use]` 占位会让这些事实在取回后依然读不到（真实日志实测缺口 23/99）。
 * 都取不到就返回空串，由调用方如实呈现"该事件无可读文本"。
 */
export function extractEventText(event: LogEventLike): string {
  const data = asRecord(event.data)
  if (data === undefined) return ''
  const candidates: unknown[] = [data['text'], data['content']]
  const message = asRecord(data['message'])
  if (message !== undefined) candidates.push(message['content'], message['text'])
  const result = asRecord(data['result'])
  if (result !== undefined) candidates.push(result['content'], result['text'])
  if (data['summary'] !== undefined) candidates.push(data['summary'])
  // 工具调用参数：放在最后，不抢已有承载的优先次序。
  candidates.push(data['arguments'], data['input'])
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
    if (Array.isArray(candidate)) {
      const text = blocksToText(candidate, { includeBlockPayload: true })
      if (text !== '') return text
    }
    // 参数以对象形式给出时同样要逐字呈现，不能因为"不是字符串"就丢掉。
    // 注意不做 JSON 序列化：那会给已转义的 `arguments` 再加一层转义。
    const record = asRecord(candidate)
    if (record !== undefined) {
      const text = renderValue(candidate)
      if (text !== '') return text
    }
  }
  return ''
}

/** 从任意返回体里尽力取出事件数组。 */
export function toEventArray(value: unknown): LogEventLike[] {
  if (Array.isArray(value)) {
    return value.map(toLogEventLike).filter((event): event is LogEventLike => event !== undefined)
  }
  const record = asRecord(value)
  if (record === undefined) return []
  for (const key of ['events', 'log', 'entries', 'items']) {
    const inner = record[key]
    if (Array.isArray(inner)) {
      return inner.map(toLogEventLike).filter((event): event is LogEventLike => event !== undefined)
    }
  }
  return []
}

/**
 * 读取一个会话的完整事件日志。
 *
 * 首选形状是**已核实的真实签名**：`readSession(sessionId): Promise<SessionLogSnapshot>`
 * —— 参数是会话 id 本身，不是对象（`dsh-session-query/lib/types/index.d.ts:74`）；
 * 返回体 `{ session, inheritedEventCount, events }` 的 `events` 就是完整原始日志
 * （同包 `types.d.ts:34-41`）。
 *
 * 仍保留另两种形状兜底：RC 期接口在变动，且 `ctx.sessionQuery` 位置上可能是适配层。
 * 但顺序不能反——把对象形状放前面，会让真实实现白白抛两次异常。
 *
 * 全部失败返回 `undefined`：调用方必须区分"读不到"与"空日志"。
 */
export async function readSessionEvents(
  query: SessionQueryLike | undefined,
  sessionId: string,
): Promise<LogEventLike[] | undefined> {
  const readSession = query?.readSession
  if (typeof readSession !== 'function') return undefined
  const shapes: unknown[] = [sessionId, { sessionId }, { id: sessionId }]
  for (const shape of shapes) {
    try {
      const events = toEventArray(await readSession.call(query, shape))
      if (events.length > 0) return events
    } catch {
      // 该形状不被接受就换下一种；这是形状探测，不是错误吞掉。
    }
  }
  return undefined
}

/**
 * 按锚点 seq 取回原始历史（逐字）。
 *
 * `seqs` 来自 `compaction/summary` 的 `shadowedSeqs`，所以这不依赖模型在摘要里写没写引用。
 */
export async function readOriginalSlices(
  query: SessionQueryLike | undefined,
  sessionId: string,
  seqs: readonly number[],
): Promise<OriginalSlice[] | undefined> {
  const events = await readSessionEvents(query, sessionId)
  if (events === undefined) return undefined
  const wanted = new Set(seqs)
  const slices: OriginalSlice[] = []
  for (const event of events) {
    if (event.seq === undefined || !wanted.has(event.seq)) continue
    slices.push({ seq: event.seq, type: event.type, text: extractEventText(event) })
  }
  // 日志顺序即时间顺序；保持不动，让调用方看到的就是真实先后。
  return slices
}
