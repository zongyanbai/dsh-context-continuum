import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ContinuumCompactionEngine from '../src/index.ts'

/**
 * 运行时挂载验证：不是"能编译"，而是**真的能被 cordis 挂载并接管 ctx.compaction**。
 *
 * 官方引擎声明 `static inject = ["llm","tokenMeter","sessions"]`（compaction-basic
 * `lib/index.js:801-805`），所以这里把这四个服务（含 tools）用最小替身提供出来；
 * 构造期只会 resolveConfig 并注册事件监听，不会真的调用它们。
 */
function mount(options: { auto?: boolean; withTools?: boolean } = {}): {
  ctx: Context
  registered: { name: string }[]
  ready: Promise<unknown>
} {
  const ctx = new Context()
  ctx.provide('llm', {})
  ctx.provide('tokenMeter', {})
  ctx.provide('sessions', {})
  const registered: { name: string }[] = []
  if (options.withTools !== false) {
    ctx.provide('tools', {
      register(definition: { name: string }) {
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    })
  }
  // ctx.plugin 返回 Fiber（thenable）：插件是异步生效的，必须 await 才能断言。
  const ready = Promise.resolve(ctx.plugin(ContinuumCompactionEngine, options.auto === undefined ? {} : { auto: options.auto }))
  return { ctx, registered, ready }
}

describe('运行时挂载', () => {
  it('挂载后 ctx.compaction 就是本插件实例（服务键接管成功）', async () => {
    const { ctx, ready } = mount()
    await ready
    expect(ctx.get('compaction')).toBeInstanceOf(ContinuumCompactionEngine)
  })

  it('挂载时通过 ctx.inject(["tools"]) 注册了工具', async () => {
    const { registered, ready } = mount()
    await ready
    expect(registered.map((tool) => tool.name)).toEqual(['context_anchors', 'context_read', 'context_compact'])
  })

  it('tools 服务缺失时不崩，只是不注册（可选依赖语义）', async () => {
    const { registered, ctx, ready } = mount({ withTools: false })
    await ready
    expect(registered).toEqual([])
    expect(ctx.get('compaction')).toBeInstanceOf(ContinuumCompactionEngine)
  })

  it('auto 打开时不会抛错（此时注册了 agent/pre-step 自动压力压缩监听）', async () => {
    await expect(mount({ auto: true }).ready).resolves.toBeDefined()
    await expect(mount({ auto: false }).ready).resolves.toBeDefined()
  })

  it('配置被官方校验器接受（阈值/保留/重试参数形状正确）', async () => {
    const ctx = new Context()
    ctx.provide('llm', {})
    ctx.provide('tokenMeter', {})
    ctx.provide('sessions', {})
    ctx.provide('tools', { register: () => () => {} })
    await ctx.plugin(ContinuumCompactionEngine, {
      thresholdRatio: 0.8,
      headroomTokens: 65536,
      retainRatio: 0.16,
      maxOverflowRetries: 1,
      compactionRetries: 1,
      auto: true,
    })
    expect(ctx.get('compaction')).toBeInstanceOf(ContinuumCompactionEngine)
  })
})
