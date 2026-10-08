import { describe, expect, it } from 'vitest'
import type { LogEventLike } from '../src/anchors.ts'
import { presentedArtifactsFromEvents, readPresentedArtifactPointers, readPresentedArtifacts } from '../src/artifacts.ts'
import type { SessionQueryLike } from '../src/trace.ts'

const presented = (files: unknown): LogEventLike => ({ type: 'deliverables/presented', seq: 1, data: { turn: 1, callId: 'c1', files } })

/** 会话查询面的最小假实现：`readSession(sessionId)` → `{ events }`（已核实的真实签名）。 */
const fakeQuery = (events: readonly LogEventLike[]): SessionQueryLike => ({
  readSession: async () => ({ events }),
})

describe('presentedArtifactsFromEvents', () => {
  it('取权威账本的 path 与 description（并记下事件 seq，供回原文定位）', () => {
    const out = presentedArtifactsFromEvents([
      presented([{ path: 'C:\\w\\a.md', description: '审计报告' }, { path: 'C:\\w\\b.md' }]),
    ])
    expect(out).toEqual([
      { path: 'C:\\w\\a.md', description: '审计报告', seq: 1 },
      { path: 'C:\\w\\b.md', description: undefined, seq: 1 },
    ])
  })

  it('忽略其它事件类型、缺 files、path 非字符串的条目', () => {
    const out = presentedArtifactsFromEvents([
      { type: 'workspace/changes', data: { turn: 7 } },
      { type: 'deliverables/presented', data: { turn: 1 } },
      presented([{ description: '没有路径' }, { path: 42 }, null, 'not-an-object']),
    ])
    expect(out).toEqual([])
  })

  it('同一路径只记一次', () => {
    const out = presentedArtifactsFromEvents([
      presented([{ path: 'C:\\w\\a.md' }]),
      presented([{ path: 'C:\\w\\a.md', description: '第二次' }]),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.description).toBeUndefined()
  })
})

describe('readPresentedArtifacts', () => {
  it('服务缺失时返回 undefined —— "读不到"绝不能被当成"没有新产物"', async () => {
    expect(await readPresentedArtifacts(undefined, 'session-x', '')).toBeUndefined()
  })

  it('剔除索引里已经有的路径，只返回新增产物', async () => {
    const query = fakeQuery([
      presented([{ path: 'C:\\w\\old.md' }, { path: 'C:\\w\\new.md' }]),
    ])
    const inheritedText = '- 产物：`C:\\w\\old.md`'
    expect(await readPresentedArtifacts(query, 'session-x', inheritedText)).toEqual(['C:\\w\\new.md'])
  })

  it('遵守上限', async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({ path: `C:\\w\\f${i}.md` }))
    const query = fakeQuery([presented(files)])
    expect(await readPresentedArtifacts(query, 'session-x', '', 5)).toHaveLength(5)
  })

  it('没有 present 记录时返回空数组（此时是真的没有，而不是读不到）', async () => {
    const query = fakeQuery([{ type: 'user/message', data: {} }])
    expect(await readPresentedArtifacts(query, 'session-x', '')).toEqual([])
  })
})

describe('readPresentedArtifactPointers', () => {
  it('同源但带上 seq 与存在性：不存在的路径如实标 ✗', async () => {
    const query = fakeQuery([presented([{ path: 'C:\\w\\definitely-missing-xyz.md' }])])
    expect(await readPresentedArtifactPointers(query, 'session-x', '')).toEqual([
      { path: 'C:\\w\\definitely-missing-xyz.md', seq: 1, exists: false },
    ])
  })

  it('服务缺失时返回 undefined，不伪装成"没有新产物"', async () => {
    expect(await readPresentedArtifactPointers(undefined, 'session-x', '')).toBeUndefined()
  })

  it('读不到日志时同样返回 undefined', async () => {
    const broken: SessionQueryLike = { readSession: async () => { throw new Error('读失败') } }
    expect(await readPresentedArtifactPointers(broken, 'session-x', '')).toBeUndefined()
  })

  it('剔除索引里已经有的路径，并遵守上限', async () => {
    const query = fakeQuery([presented([{ path: 'C:\\w\\old.md' }, { path: 'C:\\w\\new1.md' }, { path: 'C:\\w\\new2.md' }])])
    const out = await readPresentedArtifactPointers(query, 'session-x', '- 产物：`C:\\w\\old.md`', 1)
    expect(out?.map((p) => p.path)).toEqual(['C:\\w\\new1.md'])
  })
})
