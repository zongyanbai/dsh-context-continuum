import { describe, expect, it } from 'vitest'
import { blocksToText } from '../src/anchors.ts'
import {
  assembleIndex,
  buildGuidanceMessage,
  cleanBlankRuns,
  clipTitle,
  CURRENT_STATE_HEADER,
  EMPTY_CURRENT,
  EMPTY_ENTRY_NOTE,
  EMPTY_INDEX,
  ENTRY_PREFIX,
  extractInheritedIndex,
  extractNewEntry,
  GUIDANCE_MARKER,
  INDEX_HEADER,
  INDEX_MARKER,
  MAX_TITLE_CHARS,
  NO_INHERITANCE,
  normalizeIndex,
  renderArtifactLine,
} from '../src/indexlog.ts'

const messageText = (message: { content: unknown }): string =>
  (message.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')

/** 一份"上一代"索引，用于继承测试。 */
const PREVIOUS = [
  INDEX_MARKER,
  INDEX_HEADER,
  '',
  '### T1 搭好索引骨架',
  '- 状态：完成',
  '- 未决：无',
  '- 产物：`C:\\w\\a.md`',
  '',
  '### T2 修好继承链',
  '- 状态：完成',
  '- 未决：还需实测检索调用率',
  '- 产物：（本区间无产物记录）',
  '',
  CURRENT_STATE_HEADER,
  '- 正在做：写测试',
  '- 下一步：跑 typecheck',
].join('\n')

describe('buildGuidanceMessage', () => {
  it('携带稳定标记，并明确告知本次条目序号', () => {
    const text = messageText(buildGuidanceMessage(7) as unknown as { content: unknown })
    expect(text).toContain(GUIDANCE_MARKER)
    // 指导正文里给的是格式占位符 `### T<n>`，真实序号在最后一行明示
    expect(text).toContain('本次条目序号：T7')
  })

  it('明确禁止模型写产物路径（产物由系统确定性抽取）', () => {
    const text = messageText(buildGuidanceMessage(1) as unknown as { content: unknown })
    expect(text).toContain('产物由系统确定性抽取')
  })
})

describe('extractInheritedIndex', () => {
  it('拆出旧条目与旧当前状态，并数清条目数', () => {
    const inherited = extractInheritedIndex(PREVIOUS)
    expect(inherited.entryCount).toBe(2)
    expect(inherited.entries).toContain('### T1 搭好索引骨架')
    expect(inherited.entries).toContain('### T2 修好继承链')
    // 正标题不属于条目正文，必须被剔除（否则每代都会多出一行标题）
    expect(inherited.entries).not.toContain(INDEX_HEADER)
    expect(inherited.current).toContain('- 正在做：写测试')
  })

  it('没有标记时返回空继承，绝不把无关正文当条目继承', () => {
    expect(extractInheritedIndex('这是一段普通摘要，没有任何索引标记。')).toEqual(NO_INHERITANCE)
    expect(extractInheritedIndex('')).toEqual(NO_INHERITANCE)
  })

  it('没有「当前状态」小节时，条目照取、当前状态为空', () => {
    const inherited = extractInheritedIndex(`${INDEX_MARKER}\n${INDEX_HEADER}\n### T1 只有条目`)
    expect(inherited.entryCount).toBe(1)
    expect(inherited.current).toBe('')
  })
})

describe('assembleIndex', () => {
  const base = {
    ordinal: 3,
    newEntry: '### T3 改成索引式\n- 状态：完成\n- 未决：无',
    artifacts: ['C:\\w\\b.md', 'C:\\w\\c.md'],
    current: '- 正在做：收尾\n- 下一步：实测',
  }

  it('旧条目逐字继承：继承段必须是原文的子串', () => {
    const inherited = extractInheritedIndex(PREVIOUS)
    const text = assembleIndex({ ...base, inherited })
    // 这就是"不可变条目"的可验证形式：旧文本一个字符都没被改写
    expect(text).toContain(inherited.entries)
    expect(text).toContain('### T1 搭好索引骨架')
    expect(text).toContain('- 未决：还需实测检索调用率')
  })

  it('结构完整：标记、标题、产物行、当前状态各一处', () => {
    const text = assembleIndex({ ...base, inherited: extractInheritedIndex(PREVIOUS) })
    expect(text.split(INDEX_MARKER).length - 1).toBe(1)
    expect(text.split(CURRENT_STATE_HEADER).length - 1).toBe(1)
    expect(text).toContain('- 产物：`C:\\w\\b.md`、`C:\\w\\c.md`')
    expect(text).toContain('- 下一步：实测')
  })

  it('序号连续：继承 2 条 + 新 1 条 = 3 个条目行', () => {
    const text = assembleIndex({ ...base, inherited: extractInheritedIndex(PREVIOUS) })
    const entries = text.split(/\r?\n/).filter((line) => /^###\s*T\d+\b/.test(line.trim()))
    expect(entries).toHaveLength(3)
    expect(entries[2]).toContain('T3')
  })

  it('第一代（无继承）只产出 1 个条目，且没有多余空段', () => {
    const text = assembleIndex({ ...base, inherited: NO_INHERITANCE })
    const entries = text.split(/\r?\n/).filter((line) => /^###\s*T\d+\b/.test(line.trim()))
    expect(entries).toHaveLength(1)
    expect(text).not.toContain('\n\n\n')
  })

  it('没有产物时如实写「无产物记录」，不用空行伪装', () => {
    const text = assembleIndex({ ...base, artifacts: [], inherited: NO_INHERITANCE })
    expect(text).toContain('- 产物：（本区间无产物记录）')
  })

  it('产物超过上限时只报数量，避免索引被路径撑长', () => {
    const many = Array.from({ length: 50 }, (_, index) => `C:\\w\\f${index}.md`)
    const text = assembleIndex({ ...base, artifacts: many, inherited: NO_INHERITANCE }, 10)
    expect(text).toContain('（另有 40 条未列出）')
  })

  it('当前状态缺失时给显式兜底，而不是留空', () => {
    const text = assembleIndex({ ...base, current: '   ', inherited: NO_INHERITANCE })
    expect(text).toContain(EMPTY_CURRENT)
  })
})

describe('extractNewEntry', () => {
  it('强制条目序号为期望值（模型写错也要纠正）', () => {
    const { entry } = extractNewEntry('### T9 模型自己编的序号\n- 状态：完成', 4)
    expect(entry.startsWith('### T4 ')).toBe(true)
    expect(entry).not.toContain('T9')
  })

  it('取出当前状态小节', () => {
    const raw = `### T5 干活\n- 状态：完成\n\n${CURRENT_STATE_HEADER}\n- 正在做：A\n- 下一步：B`
    const { entry, current } = extractNewEntry(raw, 5)
    expect(entry).toContain('- 状态：完成')
    expect(current).toContain('- 下一步：B')
  })

  it('模型无视格式时补齐结构，标题取首行并截断', () => {
    const { entry } = extractNewEntry('我做了很多事情。\n还有更多细节。', 2)
    expect(entry.startsWith('### T2 ')).toBe(true)
    // 正文被无条件丢弃：索引只留标题 + 状态 + 未决，详情走锚点检索
    expect(entry).not.toContain('还有更多细节')
  })

  it('丢弃模型塞进来的叙事正文，只留三行（依据首次真实宿主实测）', () => {
    const narrative = [
      '### T1 ## Primary Request and Intent',
      '## Primary Request and Intent',
      '- User (verbatim): "请记住这串编号 NONCE-7F3A9C"',
      '## Key Technical Concepts',
      '- 一大堆过程叙述',
      '- 状态：完成',
      '- 未决：无',
    ].join('\n')
    const { entry } = extractNewEntry(narrative, 1)
    expect(entry).toBe('### T1 Primary Request and Intent\n- 状态：完成\n- 未决：无')
    expect(entry).not.toContain('NONCE-7F3A9C')
  })

  it('当前状态只留两行：叙事接在「当前状态」之后也要被丢掉（第二次实测的 bug）', () => {
    const raw = [
      '### T1 读取探针文件',
      '- 状态：未完成',
      '- 未决：尚未读取',
      CURRENT_STATE_HEADER,
      '- 正在做：尚未执行任何工具调用',
      '- 下一步：用 read 读取探针文件',
      '',
      '## Primary Request and Intent',
      '- Verbatim: "用 read 工具读取 E:\\dsh-temp\\nonce-probe.md 全文"',
      '## Key Technical Concepts',
      '- 一大段本不该进入表层的叙事',
    ].join('\n')
    const { entry, current } = extractNewEntry(raw, 1)
    expect(entry).toBe('### T1 读取探针文件\n- 状态：未完成\n- 未决：尚未读取')
    expect(current).toBe('- 正在做：尚未执行任何工具调用\n- 下一步：用 read 读取探针文件')
    expect(current).not.toContain('Primary Request')
    expect(current).not.toContain('本不该进入表层')
  })

  it('模型空输出时显式写明未产出，而不是造一条条目', () => {
    const { entry, current } = extractNewEntry('', 6)
    expect(entry).toContain(EMPTY_ENTRY_NOTE)
    expect(entry).toContain('### T6')
    expect(current).toBe(EMPTY_CURRENT)
  })

  it('只有标题行时补上状态与未决，保证条目字段齐全', () => {
    const { entry } = extractNewEntry('### T1 只有标题', 1)
    expect(entry).toContain('- 状态：未完成')
    expect(entry).toContain('- 未决：信息不足')
  })
})

describe('辅助函数', () => {
  it('clipTitle 按上限截断并标注省略', () => {
    const long = '标'.repeat(MAX_TITLE_CHARS + 20)
    expect(clipTitle(long).length).toBe(MAX_TITLE_CHARS + 1)
    expect(clipTitle('  多   空格  ')).toBe('多 空格')
  })

  it('cleanBlankRuns 最多保留一个空行', () => {
    expect(cleanBlankRuns('\n\na\n\n\n\nb\n\n')).toBe('a\n\nb')
  })

  it('normalizeIndex 对空内容给显式兜底', () => {
    expect(blocksToText(normalizeIndex([]))).toBe(EMPTY_INDEX)
    expect(EMPTY_INDEX).toContain('context_read')
  })

  it('normalizeIndex 不做内容改写，只收敛空行', () => {
    const out = blocksToText(normalizeIndex([{ type: 'text', text: '## 会话索引（不可变条目，只追加）\n\n\n### T1 x' }]))
    expect(out).toBe(`${INDEX_HEADER}\n\n### T1 x`)
  })
})

describe('产物指针（可回原文 + 可当场校验）', () => {
  it('带 seq 与存在性时渲染成 `path` ✓@seq / ✗@seq', () => {
    expect(renderArtifactLine([{ path: 'C:\\w\\a.md', seq: 1234, exists: true }], 40)).toBe(
      '- 产物：`C:\\w\\a.md` ✓@1234',
    )
    expect(renderArtifactLine([{ path: 'C:\\w\\gone.md', seq: 99, exists: false }], 40)).toContain('✗@99')
  })

  it('裸路径（消息面抽取、无 seq）不添加任何断言，避免把"没查"伪装成"查过"', () => {
    expect(renderArtifactLine(['C:\\w\\a.md'], 40)).toBe('- 产物：`C:\\w\\a.md`')
  })

  it('混合来源时逐条按自身信息渲染，顺序不变', () => {
    const line = renderArtifactLine(
      [{ path: 'C:\\w\\a.md', seq: 5, exists: true }, 'C:\\w\\b.md'],
      40,
    )
    expect(line).toBe('- 产物：`C:\\w\\a.md` ✓@5、`C:\\w\\b.md`')
  })

  it('无产物时仍如实写「无产物记录」', () => {
    expect(renderArtifactLine([], 40)).toBe('- 产物：（本区间无产物记录）')
  })
})
