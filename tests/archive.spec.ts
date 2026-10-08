import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_PREFIX,
  assembleIndex,
  CURRENT_STATE_HEADER,
  extractInheritedIndex,
  highestOrdinal,
  INDEX_HEADER,
  INDEX_MARKER,
  MAX_ENTRIES_IN_SURFACE,
  NO_INHERITANCE,
  splitEntryBlocks,
} from '../src/indexlog.ts'

/** 造一份含 `count` 条条目的索引正文。 */
const indexWith = (count: number): string => {
  const parts: string[] = [INDEX_MARKER, INDEX_HEADER, '']
  for (let n = 1; n <= count; n += 1) {
    parts.push(`### T${n} 第${n}件事`, '- 状态：完成', '- 未决：无', '')
  }
  parts.push(CURRENT_STATE_HEADER, '- 正在做：x', '- 下一步：y')
  return parts.join('\n')
}

const entryLines = (text: string): string[] =>
  text.split(/\r?\n/).filter((line) => /^###\s*T\d+\b/.test(line.trim())).map((line) => line.trim())

const extend = (text: string, maxEntries: number): string => {
  const inherited = extractInheritedIndex(text)
  const ordinal = inherited.nextOrdinal
  return assembleIndex(
    {
      ordinal,
      newEntry: `### T${ordinal} 第${ordinal}件事\n- 状态：完成\n- 未决：无`,
      artifacts: [],
      current: '- 正在做：a\n- 下一步：b',
      inherited,
    },
    40,
    maxEntries,
  )
}

describe('highestOrdinal', () => {
  it('可见条目行取最大', () => {
    expect(highestOrdinal('### T3 a\n- 状态：完成\n### T11 b')).toBe(11)
  })

  it('归档行的上界必须计入，否则归档后序号会回退', () => {
    expect(highestOrdinal(`${ARCHIVE_PREFIX}T1…T27（共 27 条，正文已移出表层）`)).toBe(27)
  })

  it('没有条目时返回 0', () => {
    expect(highestOrdinal('')).toBe(0)
    expect(highestOrdinal('无关正文 T5 但不是条目行')).toBe(0)
  })
})

describe('splitEntryBlocks', () => {
  it('按条目行切块，并丢掉归档指针等首个条目之前的行', () => {
    const blocks = splitEntryBlocks(`${ARCHIVE_PREFIX}T1…T2（共 2 条）\n### T3 a\n- 状态：完成\n### T4 b\n- 状态：完成`)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain('T3')
    expect(blocks.join('\n')).not.toContain('已归档')
  })
})

describe('超量归档（解掉"索引长到比被压内容还大"的硬上限）', () => {
  it('表层条数封顶，超出的压成一行归档指针', () => {
    const inherited = extractInheritedIndex(indexWith(5))
    expect(inherited.entryCount).toBe(5)
    expect(inherited.nextOrdinal).toBe(6)

    const text = assembleIndex(
      {
        ordinal: 6,
        newEntry: '### T6 新条目\n- 状态：完成\n- 未决：无',
        artifacts: [],
        current: '- 正在做：a\n- 下一步：b',
        inherited,
      },
      40,
      3,
    )
    const entries = entryLines(text)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toContain('T4')
    expect(entries[2]).toContain('T6')
    expect(text).toContain(`${ARCHIVE_PREFIX}T1…T3`)
  })

  it('归档之后序号继续递增（不能退回"可见条目数 + 1"）', () => {
    const after = extend(indexWith(5), 3)
    const inherited = extractInheritedIndex(after)
    expect(inherited.entryCount).toBe(3)
    // 已经存在 T1..T6，因此下一个必须是 T7
    expect(inherited.nextOrdinal).toBe(7)
  })

  it('反复组装不会累积多个归档指针，序号一路递增', () => {
    let text = indexWith(5)
    for (let round = 0; round < 4; round += 1) text = extend(text, 3)
    expect(text.split('已归档：').length - 1).toBe(1)
    expect(entryLines(text)).toHaveLength(3)
    // T1..T5 原有 + 4 轮 = T9，下一个应为 T10
    expect(extractInheritedIndex(text).nextOrdinal).toBe(10)
    expect(text).toContain(`${ARCHIVE_PREFIX}T1…T6`)
  })

  it('归档区间恒为前缀：归档上界 = 历史总数 - 保留数', () => {
    let text = indexWith(10)
    text = extend(text, 6)
    const match = /已归档：T(\d+)…T(\d+)/.exec(text)
    expect(match?.[1]).toBe('1')
    // 原有 10 条，保留 5 条（maxEntries-1），故归档 5 条；
    // 新条目永远在表层，绝不进归档（否则刚写的条目当场就会消失）。
    expect(match?.[2]).toBe('5')
    expect(entryLines(text)).toHaveLength(6)
  })

  it('默认上限生效：条目数超过 MAX_ENTRIES_IN_SURFACE 时自动归档', () => {
    let text = indexWith(MAX_ENTRIES_IN_SURFACE + 3)
    text = extend(text, MAX_ENTRIES_IN_SURFACE)
    expect(text).toContain(ARCHIVE_PREFIX)
    expect(entryLines(text)).toHaveLength(MAX_ENTRIES_IN_SURFACE)
  })

  it('没有继承时不写归档行（第一代不该出现归档）', () => {
    const text = assembleIndex(
      {
        ordinal: 1,
        newEntry: '### T1 首条\n- 状态：完成\n- 未决：无',
        artifacts: [],
        current: '- 正在做：a\n- 下一步：b',
        inherited: NO_INHERITANCE,
      },
      40,
      3,
    )
    expect(text).not.toContain('已归档')
  })
})
