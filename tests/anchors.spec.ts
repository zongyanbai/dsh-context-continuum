import { describe, expect, it } from 'vitest'
import { blocksToText, collectCheckpoints, totalShadowedTokens, type LogEventLike } from '../src/anchors.ts'

describe('blocksToText', () => {
  it('取出文本块，非文本块按类型占位（长度不被静默吞掉）', () => {
    expect(
      blocksToText([
        { type: 'text', text: '第一段' },
        { type: 'image' },
        { type: 'text', text: '第二段' },
      ]),
    ).toBe('第一段\n[image]\n第二段')
  })

  it('非数组一律返回空串', () => {
    expect(blocksToText(undefined)).toBe('')
    expect(blocksToText('不是数组')).toBe('')
  })

  it('默认不展开块内容（索引/摘要路径要紧凑，长度预算不能被参数撑爆）', () => {
    const blocks = [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\work\\a.py' } }]
    expect(blocksToText(blocks)).toBe('[tool_use Read]')
  })

  it('includeBlockPayload 时逐字展开块内容（原文取回路径必须能看到参数里的路径）', () => {
    const blocks = [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\work\\a.py' } }]
    const out = blocksToText(blocks, { includeBlockPayload: true })
    expect(out).toContain('[tool_use Read]')
    expect(out).toContain('file_path')
    expect(out).toContain('a.py')
  })
})

describe('collectCheckpoints', () => {
  const events: LogEventLike[] = [
    { type: 'user/message', seq: 1 },
    {
      type: 'compaction/summary',
      seq: 30,
      data: {
        compactionId: 'c-2',
        shadowedRange: { start: 20, end: 25 },
        shadowedSeqs: [20, 22, 25],
        shadowedTokenCount: 4096,
        provider: 'ark-plan',
        model: 'deepseek-v4-1-flash-260910',
        summary: [{ type: 'text', text: '## 时间串联摘要\n- [早期] 做了 A' }],
      },
    },
    { type: 'compaction/end', seq: 31, data: { compactionId: 'c-2' } },
    {
      type: 'compaction/summary',
      seq: 10,
      data: {
        compactionId: 'c-1',
        shadowedSeqs: [2, 3],
        shadowedTokenCount: 1000,
        summary: [{ type: 'text', text: '旧摘要' }],
      },
    },
    { type: 'compaction/end', seq: 11, data: { compactionId: 'c-1', error: '摘要是空的' } },
  ]

  it('按 compactionId 归并，并按摘要 seq 做时间串联排序', () => {
    const anchors = collectCheckpoints(events)
    expect(anchors.map((a) => a.compactionId)).toEqual(['c-1', 'c-2'])
  })

  it('抽全字段：遮蔽 seq、区间、token、provider/model、失败原因', () => {
    const [first, second] = collectCheckpoints(events)
    expect(first?.shadowedSeqs).toEqual([2, 3])
    expect(first?.error).toBe('摘要是空的')
    expect(second?.summarySeq).toBe(30)
    expect(second?.startSeq).toBe(20)
    expect(second?.endSeq).toBe(25)
    expect(second?.shadowedTokenCount).toBe(4096)
    expect(second?.provider).toBe('ark-plan')
    expect(second?.model).toBe('deepseek-v4-1-flash-260910')
    expect(second?.summaryText).toContain('做了 A')
    expect(second?.error).toBeUndefined()
  })

  it('缺字段如实留空，不把"不知道"写成 0 或空串', () => {
    const [first] = collectCheckpoints([
      { type: 'compaction/summary', seq: 5, data: { compactionId: 'c-9', summary: [] } },
    ])
    expect(first?.shadowedTokenCount).toBeUndefined()
    expect(first?.provider).toBeUndefined()
    expect(first?.shadowedSeqs).toEqual([])
  })

  it('非 compaction 事件与缺 compactionId 的事件不参与归并', () => {
    expect(
      collectCheckpoints([
        { type: 'user/message', seq: 1, data: { compactionId: 'x' } },
        { type: 'compaction/summary', seq: 2, data: { summary: [] } },
      ]),
    ).toEqual([])
  })

  it('累计省下的 token 只算真实记录过的那些', () => {
    const anchors = collectCheckpoints([
      { type: 'compaction/summary', seq: 1, data: { compactionId: 'a', shadowedTokenCount: 100 } },
      { type: 'compaction/summary', seq: 2, data: { compactionId: 'b' } },
      { type: 'compaction/summary', seq: 3, data: { compactionId: 'c', shadowedTokenCount: 50 } },
    ])
    expect(totalShadowedTokens(anchors)).toBe(150)
  })
})
