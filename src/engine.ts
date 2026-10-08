/**
 * 合并插件的行为主体：一个可挂载的压缩后端。
 *
 * 为什么继承 `BasicCompactionEngine` 而不是从零写引擎：
 * 宿主官方引擎已经实现了这条链上最难、最容易写错的部分——按 `ctx.tokenMeter` 计价的
 * 压力判定、保留尾部策略、`compaction/start → compaction/summary → 替换 user/message
 * → compaction/end` 的持久事务与并发锁、以及 `CONTEXT_WINDOW_EXCEEDED` 的溢出恢复
 * （`maxOverflowRetries` 默认 1，即溢出后自动重试）。官方声明 `summarize()` 是**唯一**
 * 的子类定制钩子，本插件因此只动这一个钩子。
 *
 * 服务键的接管方式已核实：`@deepseek-ai/dsh-compaction` 的 `CompactionEngine` 构造函数
 * 显式写死 `super(ctx, "compaction")`（`lib/index.js:171`），键名不从类名推导，
 * 因此本子类即使类名不同，也仍然提供 `ctx.compaction`。
 *
 * 本钩子做四件事（依据 A/B 实测与真实宿主复验，见 indexlog.ts 的模块注释）：
 * 1. 从输入里认出**上一份索引**，把它的旧条目**逐字继承**——官方虽会重压整个区间，
 *    旧条目文本原样搬运即不再被改写，早期内容因此不会被反复磨平；
 * 2. **确定性抽取**产物路径：优先读官方权威账本 `deliverables/presented`（经会话日志），
 *    退化到消息面的写文件类 `tool-call` 参数；两次都不让模型参与，杜绝编造；
 * 3. 只要求模型写**一个新条目**（标题/状态/未决）+「当前状态」，输出短、不会撞截断上限；
 * 4. 条目超量时由组装器降级为**归档指针**，避免索引长到比被压内容还大而被引擎拒绝。
 *
 * @module @local/dsh-context-continuum/engine
 */

import { BasicCompactionEngine, type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { blocksToText } from './anchors.ts'
import {
  extractArtifactPaths,
  MAX_ARTIFACTS,
  readPresentedArtifactPointers,
  type ArtifactPointer,
} from './artifacts.ts'
import {
  assembleIndex,
  buildGuidanceMessage,
  extractInheritedIndex,
  extractNewEntry,
  INDEX_HEADER,
  INDEX_MARKER,
} from './indexlog.ts'
import { createContinuumTools } from './tools.ts'
import type { SessionQueryLike } from './trace.ts'

/**
 * `summarize()` 的入参结构。
 *
 * 官方把 `SummarizationInput` / `SummaryResult` 定义在包内 `summarizer` 模块且**未导出**
 * （包 exports 只有 `.`、`./src/*`、`./package.json`），所以这里按结构声明等价类型；
 * 结构一致即可被 `super.summarize()` 接受，且不随 rc 版本的内部路径变化而碎掉。
 *
 * 注意：它**不含 seq**（只有 tools 与 messages），所以索引条目里不写 seq 区间，
 * 而由 `context_anchors` 用序号 `T<n>` 提供锚点对应关系。
 */
interface IndexSummarizationInput {
  /** 对话的工具 schema，复用是为了前缀缓存对齐。 */
  readonly tools?: readonly ToolSchema[]
  /** 派生出的 system 头，其后是待压缩区域，均按 surface 顺序。 */
  readonly messages: readonly Message[]
}

/** 取消息里的可见文本（只认 text 块；其他块没有可读正文）。 */
function textOfMessage(message: Message): string {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const record = block as { type?: unknown; text?: unknown }
    if (record?.type === 'text' && typeof record.text === 'string') parts.push(record.text)
  }
  return parts.join('\n')
}

/** 找到携带上一份索引的那条消息（取最后一条，避免把历史里引用过的索引误当当前索引）。 */
function indexMessageAt(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = textOfMessage(messages[index]!)
    if (text.includes(INDEX_MARKER) || text.includes(INDEX_HEADER)) return index
  }
  return -1
}

/** 从 agent 上取会话 id；取不到返回 undefined，由调用方跳过需要日志的步骤。 */
function sessionIdOfAgent(agent: Agent): string | undefined {
  const session = (agent as { session?: unknown }).session
  if (typeof session !== 'object' || session === null) return undefined
  const id = (session as { id?: unknown }).id
  return typeof id === 'string' ? id : undefined
}

/** 合并两路产物来源：权威账本在前（带 seq/存在性）、消息面在后（裸路径），去重并封顶。 */
function mergeArtifacts(
  presented: readonly ArtifactPointer[] | undefined,
  fromMessages: readonly string[],
): (string | ArtifactPointer)[] {
  const seen = new Set<string>()
  const out: (string | ArtifactPointer)[] = []
  for (const item of [...(presented ?? []), ...fromMessages]) {
    const path = typeof item === 'string' ? item : item.path
    if (seen.has(path)) continue
    seen.add(path)
    out.push(item)
    if (out.length >= MAX_ARTIFACTS) break
  }
  return out
}

export class ContinuumCompactionEngine extends BasicCompactionEngine {
  /**
   * 惰性取 `ctx.sessionQuery` 的取值器。
   *
   * 必须是取值器：`ctx.inject(['tools'], …)` 只保证 `tools` 就绪，构造那一刻
   * `sessionQuery` 可能尚未注册；在构造期捕获会**永久**拿到 `undefined`。
   * 真实宿主实测过这个症状：工具进了请求、模型也调了，但返回"会话检索面不可用"。
   */
  #sessionQuery: () => SessionQueryLike | undefined = () => undefined

  constructor(ctx: Context, config?: BasicCompactionConfig) {
    super(ctx, config)
    // 工具与引擎同生共死：这个注入作用域销毁时，register 返回的释放函数随之回收。
    ctx.inject(['tools'], (scope) => {
      const sessionQuery = (): SessionQueryLike | undefined =>
        scope.get('sessionQuery') as SessionQueryLike | undefined
      this.#sessionQuery = sessionQuery
      for (const tool of createContinuumTools({ sessionQuery, compaction: this })) {
        scope.tools.register(tool)
      }
    })
  }

  /**
   * 把宿主的缓存友好压缩调用**原样复用**，只增强"这次压缩产出什么"。
   *
   * 之所以用 `super.summarize()` 而不是自己发 `ctx.llm.stream()`：
   * 自己发就得重新实现前缀缓存复用、模型回退与会话关联，等于把宿主已经调好的东西再写一遍；
   * 而 `summarize` 是 `protected`，子类直接调用正是官方设计的扩展点。
   * 追加的指导消息只进入这次辅助调用，不写入会话日志，因此不污染持久历史。
   */
  protected override async summarize(
    input: IndexSummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<BasicCompactionEngine['summarize']>>> {
    const at = indexMessageAt(input.messages)
    const previous = at >= 0 ? textOfMessage(input.messages[at]!) : ''
    const inherited = extractInheritedIndex(previous)
    // 序号由"见过的最高 T"推导，而不是可见条目数：归档之后可见条目数会停增。
    const ordinal = inherited.nextOrdinal
    // 产物只从"索引之后的新区间"里抽，旧区间的产物已经在继承的旧条目里了。
    const region = at >= 0 ? input.messages.slice(at + 1) : input.messages
    const messageArtifacts = extractArtifactPaths(region, MAX_ARTIFACTS)

    // 权威产物账本需要读会话日志；与摘要调用**并发**发起，避免串行等待。
    // 读不到（服务缺失/读取失败）就返回 undefined，由 mergeArtifacts 只用消息面兜底。
    const sessionId = sessionIdOfAgent(agent)
    const presentedPromise: Promise<readonly ArtifactPointer[] | undefined> =
      sessionId === undefined
        ? Promise.resolve(undefined)
        : readPresentedArtifactPointers(this.#sessionQuery(), sessionId, previous, MAX_ARTIFACTS)

    const messages: readonly Message[] = [...input.messages, buildGuidanceMessage(ordinal)]
    const guided: IndexSummarizationInput =
      input.tools === undefined ? { messages } : { tools: input.tools, messages }
    const result = await super.summarize(guided, agent, signal)

    const presented = await presentedPromise
    const { entry, current } = extractNewEntry(blocksToText(result.summary), ordinal)
    const text = assembleIndex(
      {
        ordinal,
        newEntry: entry,
        artifacts: mergeArtifacts(presented, messageArtifacts),
        current,
        inherited,
      },
      MAX_ARTIFACTS,
    )
    const summary: ContentBlock[] = [{ type: 'text', text }]
    return { ...result, summary }
  }
}

export default ContinuumCompactionEngine
