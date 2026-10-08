import { describe, expect, it } from 'vitest'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import DefaultExport, { ContinuumCompactionEngine } from '../src/index.ts'
import { createContinuumTools } from '../src/tools.ts'

const proto = (klass: unknown): Record<string, unknown> =>
  (klass as { prototype: Record<string, unknown> }).prototype

describe('挂载契约', () => {
  it('默认导出就是压缩后端类（加载器只接受函数/类/{apply}）', () => {
    expect(typeof DefaultExport).toBe('function')
    expect(DefaultExport).toBe(ContinuumCompactionEngine)
  })

  it('继承链仍指向官方引擎，因此 ctx.compaction 的键不受类名影响', () => {
    expect(Object.getPrototypeOf(ContinuumCompactionEngine)).toBe(BasicCompactionEngine)
  })

  it('确实覆盖了唯一的定制钩子 summarize（不是空继承）', () => {
    expect(proto(ContinuumCompactionEngine)['summarize']).toBeTypeOf('function')
    expect(proto(ContinuumCompactionEngine)['summarize']).not.toBe(proto(BasicCompactionEngine)['summarize'])
  })

  it('没有把宿主的其它入口一起改掉（compactIfNeeded / compactNow / compactRegion 仍继承官方实现）', () => {
      for (const method of ['compactIfNeeded', 'compactNow', 'compactRegion']) {
        expect(proto(ContinuumCompactionEngine)[method]).toBe(proto(BasicCompactionEngine)[method])
      }
  })
})

describe('工具面', () => {
  it('注册三个工具，名字稳定', () => {
    const tools = createContinuumTools({ sessionQuery: undefined })
    expect(tools.map((tool) => tool.name)).toEqual(['context_anchors', 'context_read', 'context_compact'])
  })
})
