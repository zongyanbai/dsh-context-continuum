import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * bundle 安装形状验证。
 *
 * 为什么值得单测：patch 文件写错**不会报错**——加载器只会安静地什么都不做，
 * 表现成"装了插件但压缩还是没接管"。所以这里把"能解析 + 形状正确 + 配置键合法"
 * 都钉成测试。
 */
const require_ = createRequire(import.meta.url)
const yaml = require_('js-yaml') as { load(source: string, options?: unknown): unknown }

/**
 * DSH 的 patch 方言支持 `!!js <表达式>`（shipped 的 preset 就用它做平台判断，
 * 例：`disabled: !!js process.platform === 'win32'`）。该标签由 **DSH 自己的加载器**求值，
 * 普通 js-yaml 既不认、也不该替它求值。
 *
 * 所以这里把标签**剥掉**再解析：本测试要验的是"形状对不对"（id / insert / config 键），
 * 不是"表达式算出来是什么"。这样解析器认的是真实文件的真实结构，
 * 而不会因为一个与本测试无关的自定义标签，抛出一个把真实问题盖住的 YAMLException。
 */
const stripDshTags = (text: string): string => text.replace(/!!js\s+/g, '')

const readText = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

const patchDoc = yaml.load(stripDshTags(readText('../cordis.patch.yml'))) as Array<
  Record<string, unknown>
>
const pkg = JSON.parse(readText('../package.json')) as {
  name: string
  files: string[]
  dsh?: { bundle?: { patch?: string } }
  exports?: Record<string, unknown>
}

/** 官方 `BasicCompactionEngine.Config` 允许的键（compaction-basic `lib/index.js:806-818`）。 */
const OFFICIAL_CONFIG_KEYS = new Set([
  'thresholdRatio',
  'headroomTokens',
  'retainRatio',
  'retainTokens',
  'summarizationProvider',
  'summarizationModel',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
  'modelPolicies',
  'auto',
])

describe('bundle 安装形状', () => {
  it('package.json 声明了 dsh.bundle.patch，且该文件会被发出去', () => {
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.files).toContain('cordis.patch.yml')
  })

  it('patch 能被 YAML 解析出两层', () => {
    expect(Array.isArray(patchDoc)).toBe(true)
    expect(patchDoc).toHaveLength(2)
  })

  it('置灰 compaction-basic：保证 ctx.compaction 只有一个实现', () => {
    const disabled = patchDoc.find((row) => row['id'] === 'compaction-basic')
    expect(disabled).toBeDefined()
    expect(disabled?.['disabled']).toBe(true)
  })

  it('insert 行指向本包，且带一份非空配置', () => {
    const inserted = patchDoc.find((row) => Array.isArray(row['insert']))
    const rows = inserted?.['insert'] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row['name']).toBe(pkg.name)
    expect(typeof row['id']).toBe('string')
    expect(Object.keys(row['config'] as object).length).toBeGreaterThan(0)
  })

  it('配置键全部在官方 Config schema 允许集合内（写错键会被校验器拒掉整行）', () => {
    const inserted = patchDoc.find((row) => Array.isArray(row['insert']))
    const rows = inserted?.['insert'] as Array<Record<string, unknown>>
    const config = rows[0]!['config'] as Record<string, unknown>
    for (const key of Object.keys(config)) {
      expect(OFFICIAL_CONFIG_KEYS.has(key), `未知配置键：${key}`).toBe(true)
    }
  })

  it('需求(a) 的自动压缩开关与溢出恢复都显式打开', () => {
    const inserted = patchDoc.find((row) => Array.isArray(row['insert']))
    const rows = inserted?.['insert'] as Array<Record<string, unknown>>
    const config = rows[0]!['config'] as Record<string, unknown>
    expect(config['auto']).toBe(true)
    // 0 会关闭溢出恢复；必须是正数才符合需求(a)。
    expect(config['maxOverflowRetries']).toBeGreaterThan(0)
  })

  it('包入口指向 lib/index.js，default 导出即压缩后端（加载器只认 exports.default）', () => {
    expect(pkg.exports?.['.']).toEqual({
      types: './lib/index.d.ts',
      default: './lib/index.js',
    })
  })
})
