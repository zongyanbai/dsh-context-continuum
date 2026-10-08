import { describe, expect, it } from 'vitest'
import type { Message } from '@deepseek-ai/dsh-llm'
import { extractArtifactPaths, MAX_ARTIFACTS } from '../src/artifacts.ts'

/** 造一条助手消息，内容是若干 tool-call 块。 */
const toolCalls = (...calls: Array<{ name: string; arguments: string }>): Message =>
  ({
    role: 'assistant',
    source: { kind: 'model', provider: 'p', model: 'm' },
    content: calls.map((call, index) => ({
      type: 'tool-call',
      id: `call_${index}`,
      name: call.name,
      arguments: call.arguments,
    })),
  }) as unknown as Message

describe('extractArtifactPaths', () => {
  it('从写文件工具的 JSON 参数里抽出真实路径（不带转义）', () => {
    const message = toolCalls({
      name: 'write',
      arguments: JSON.stringify({ path: 'C:\\work\\out\\report.md', content: 'x' }),
    })
    expect(extractArtifactPaths([message])).toEqual(['C:\\work\\out\\report.md'])
  })

  it('只认写/改/建类工具，读文件工具不产生产物条目', () => {
    const message = toolCalls(
      { name: 'read', arguments: JSON.stringify({ path: 'C:\\work\\ignored.md' }) },
      { name: 'edit', arguments: JSON.stringify({ file_path: 'C:\\work\\kept.md' }) },
    )
    expect(extractArtifactPaths([message])).toEqual(['C:\\work\\kept.md'])
  })

  it('参数不是合法 JSON 时退回原文匹配，并把重复反斜杠收成单个', () => {
    const message = toolCalls({ name: 'write', arguments: '{"path": "C:\\work\\\\d.md"' })
    expect(extractArtifactPaths([message])).toEqual(['C:\\work\\d.md'])
  })

  it('去重并保持首次出现顺序', () => {
    const message = toolCalls(
      { name: 'write', arguments: JSON.stringify({ path: 'C:\\a\\1.md' }) },
      { name: 'write', arguments: JSON.stringify({ path: 'C:\\a\\2.md' }) },
      { name: 'write', arguments: JSON.stringify({ path: 'C:\\a\\1.md' }) },
    )
    expect(extractArtifactPaths([message])).toEqual(['C:\\a\\1.md', 'C:\\a\\2.md'])
  })

  it('遵守上限，防止索引被路径撑长', () => {
    const calls = Array.from({ length: MAX_ARTIFACTS + 15 }, (_, index) => ({
      name: 'write',
      arguments: JSON.stringify({ path: `C:\\many\\f${index}.md` }),
    }))
    expect(extractArtifactPaths([toolCalls(...calls)])).toHaveLength(MAX_ARTIFACTS)
  })

  it('忽略非 tool-call 块，也忽略没有 content 的消息', () => {
    const textOnly = {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'C:\\work\\not-an-artifact.md' }],
    } as unknown as Message
    const bare = { role: 'user', source: { kind: 'user' } } as unknown as Message
    expect(extractArtifactPaths([textOnly, bare])).toEqual([])
  })

  it('抽出相对路径（带已知扩展名）', () => {
    const message = toolCalls({
      name: 'create',
      arguments: JSON.stringify({ target: 'dsh-context-merge/plugin/src/artifacts.ts' }),
    })
    expect(extractArtifactPaths([message])).toEqual(['dsh-context-merge/plugin/src/artifacts.ts'])
  })
})
