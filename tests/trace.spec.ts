import { describe, expect, it } from 'vitest'
import {
  extractEventText,
  readOriginalSlices,
  readSessionEvents,
  toEventArray,
  toLogEventLike,
} from '../src/trace.ts'

describe('extractEventText', () => {
  it('从 data.content / data.message.content / data.summary 三种承载里取逐字文本', () => {
    expect(extractEventText({ type: 'user/message', data: { content: [{ type: 'text', text: '原话一' }] } })).toBe('原话一')
    expect(
      extractEventText({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '原话二' }] } } }),
    ).toBe('原话二')
    expect(extractEventText({ type: 'compaction/summary', data: { summary: [{ type: 'text', text: '摘要正文' }] } })).toBe(
      '摘要正文',
    )
  })

  it('纯字符串内容直接返回', () => {
    expect(extractEventText({ type: 'user/message', data: { text: '  直接给字符串  ' } })).toBe('  直接给字符串  ')
  })

  it('没有可读文本时返回空串，不编造', () => {
    expect(extractEventText({ type: 'tool/call', data: { args: '{}' } })).toBe('')
    expect(extractEventText({ type: 'x' })).toBe('')
  })

  it('取回 assistant 消息里 tool_use 块的参数（路径类事实的载体，曾被丢成 [tool_use]）', () => {
    const out = extractEventText({
      type: 'assistant/message',
      data: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\work\\a.py' } }] },
    })
    expect(out).toContain('a.py')
    expect(out).not.toBe('[tool_use]')
  })

  it('取回 tool/call 的 arguments（字符串与对象两种形态）', () => {
    expect(extractEventText({ type: 'tool/call', data: { arguments: '{"file_path":"C:\\\\a.py"}' } })).toContain('a.py')
    expect(extractEventText({ type: 'tool/call', data: { arguments: { file_path: 'C:\\a.py' } } })).toContain('a.py')
  })
})

describe('toEventArray', () => {
  it('接受裸数组与 events/log/entries/items 包装', () => {
    expect(toEventArray([{ type: 'a', seq: 1 }])).toHaveLength(1)
    expect(toEventArray({ events: [{ type: 'a', seq: 1 }] })).toHaveLength(1)
    expect(toEventArray({ log: [{ type: 'a', seq: 1 }] })).toHaveLength(1)
    expect(toEventArray({ entries: [{ type: 'a', seq: 1 }] })).toHaveLength(1)
  })

  it('丢掉没有 type 的项', () => {
    expect(toEventArray({ events: [{ seq: 1 }, { type: 'a', seq: 2 }] })).toHaveLength(1)
  })

  it('无法识别时返回空数组', () => {
    expect(toEventArray(undefined)).toEqual([])
    expect(toEventArray({ nope: true })).toEqual([])
  })
})

describe('toLogEventLike', () => {
  it('兼容 sequence/timestamp 别名', () => {
    expect(toLogEventLike({ type: 'a', sequence: 7, timestamp: 123 })).toEqual({ type: 'a', seq: 7, time: 123 })
  })
})

describe('readSessionEvents / readOriginalSlices', () => {
  const events = [
    { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '第一句' }] } },
    { type: 'assistant/message', seq: 2, data: { content: [{ type: 'text', text: '第二句' }] } },
    { type: 'user/message', seq: 3, data: { content: [{ type: 'text', text: '第三句' }] } },
  ]

  it('首选已核实的真实签名 readSession(sessionId)：一次调用就取到，不先试对象形状', async () => {
    const calls: unknown[] = []
    const query = {
      async readSession(request: unknown) {
        calls.push(request)
        if (typeof request === 'string') {
          return { session: {}, inheritedEventCount: 0, events }
        }
        throw new Error('不该先用对象形状')
      },
    }
    const got = await readSessionEvents(query, 's-1')
    expect(got).toHaveLength(3)
    expect(calls).toEqual(['s-1'])
  })

  it('实现只认对象形状时，兜底探测仍能取到（不因形状差异直接失效）', async () => {
    const query = {
      async readSession(request: unknown) {
        if (typeof request === 'object' && request !== null && 'sessionId' in request) {
          return { events }
        }
        throw new Error('只认对象形状')
      },
    }
    await expect(readSessionEvents(query, 's-1')).resolves.toHaveLength(3)
  })

  it('端口缺失时返回 undefined（区分"读不到"与"空日志"）', async () => {
    await expect(readSessionEvents(undefined, 's-1')).resolves.toBeUndefined()
  })

  it('按锚点 seq 取回原文，保持日志先后顺序', async () => {
    const query = { async readSession() { return { events } } }
    const slices = await readOriginalSlices(query, 's-1', [3, 1])
    expect(slices?.map((s) => s.seq)).toEqual([1, 3])
    expect(slices?.[0]?.text).toBe('第一句')
    expect(slices?.[1]?.text).toBe('第三句')
  })

  it('seq 不存在时返回空数组（而不是假装取到）', async () => {
    const query = { async readSession() { return { events } } }
    await expect(readOriginalSlices(query, 's-1', [999])).resolves.toEqual([])
  })
})
