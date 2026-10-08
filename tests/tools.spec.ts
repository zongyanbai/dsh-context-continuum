import { describe, expect, it } from 'vitest'
import type { SessionQueryLike } from '../src/trace.ts'
import { createContinuumTools } from '../src/tools.ts'

/** 取某个工具并调用它，入参退化成最小形状（这里只关心工具自己的分支与话术）。 */
const callTool = async (
  tools: ReturnType<typeof createContinuumTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<string> => {
  const tool = tools.find((item) => item.name === name)
  if (tool === undefined) throw new Error(`工具 ${name} 未注册`)
  const execute = tool.execute as unknown as (a: unknown, b: unknown) => Promise<string>
  return await execute(args, {})
}

describe('上下文工具的检索面依赖', () => {
  it('没有 sessionQuery 取值器时，明确说"未注入"，而不是含糊的"读不到"', async () => {
    const tools = createContinuumTools({})
    const out = await callTool(tools, 'context_anchors', { sessionId: 'session-x' })
    expect(out).toContain('会话检索面未注入')
    expect(out).toContain('ctx.sessionQuery')
  })

  it('构造期不求值：取值器只在调用时才被调用（真实宿主踩到的注册顺序 bug）', async () => {
    let calls = 0
    const tools = createContinuumTools({
      sessionQuery: () => {
        calls += 1
        return undefined
      },
    })
    expect(calls).toBe(0)
    await callTool(tools, 'context_anchors', { sessionId: 'session-x' })
    expect(calls).toBeGreaterThan(0)
  })

  it('取值器后来才开始返回服务时，工具立刻能看见它（惰性取值的目的）', async () => {
    let available: (() => SessionQueryLike | undefined) | undefined
    const tools = createContinuumTools({ sessionQuery: () => available?.() })
    // 先造出来时服务还不存在
    const before = await callTool(tools, 'context_anchors', { sessionId: 'session-x' })
    expect(before).toContain('未注入')
    // 之后再"注册"服务：空对象没有任何读取方法，因此走 read-failed 分支，但已能看见服务
    available = () => ({}) as SessionQueryLike
    const after = await callTool(tools, 'context_anchors', { sessionId: 'session-x' })
    expect(after).not.toContain('未注入')
    expect(after).toContain('无法读出会话 session-x')
  })

  it('context_read 在服务缺失时同样给出"未注入"，而不是假装没找到原文', async () => {
    const tools = createContinuumTools({})
    const out = await callTool(tools, 'context_read', { sessionId: 'session-x', seqs: [1, 2] })
    expect(out).toContain('未注入')
  })

  it('context_compact 在没有压缩后端时如实报告', async () => {
    const tools = createContinuumTools({})
    const out = await callTool(tools, 'context_compact', {})
    // 无后端的分支先于"检查 agent 上下文"触发，因此这里应报告缺后端
    expect(out).toContain('没有压缩后端')
  })

  it('三个工具的说明都提到索引与锚点的对应关系', () => {
    const tools = createContinuumTools({})
    expect(tools.map((t) => t.name)).toEqual(['context_anchors', 'context_read', 'context_compact'])
    const anchors = tools[0]!.description ?? ''
    expect(anchors).toContain('T<n>')
  })
})
