/**
 * 面向模型/用户的两个只读工具 + 一个手动压缩工具。
 *
 * `context_anchors` / `context_read` 是需求(c)的入口：先看锚点账本，再按锚点 seq
 * 取回逐字原文，而不是靠摘要正文里的记忆重建。
 *
 * @module @local/dsh-context-continuum/tools
 */

import { ManualCompactionError, type CompactionResult, type ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { collectCheckpoints, totalShadowedTokens, type LogEventLike } from './anchors.ts'
import { readOriginalSlices, readSessionEvents, type SessionQueryLike } from './trace.ts'

/**
 * 压缩服务的最小结构面。
 *
 * 只声明 `compactNow`：手动压缩是"就地压缩当前会话"，与自动路径共用官方事务。
 */
export interface CompactionPort {
  compactNow(agent: ManualCompactAgentContext, signal: AbortSignal): Promise<CompactionResult | null>
}

/** 工具运行所需的最小依赖。 */
export interface ContinuumToolDeps {
  /**
   * **惰性**取 `ctx.sessionQuery` 的取值器。
   *
   * 必须是取值器而不是值：压缩引擎构造时 `ctx.inject(['tools'], …)` 只保证 `tools` 就绪，
   * 那一刻 `sessionQuery` 可能尚未注册；在构造期捕获会**永久**拿到 `undefined`。
   * 真实宿主实测（continuum-test profile）正是这个症状：工具确实进了请求的 tools 数组、
   * 模型也确实调用了 `context_anchors`，但一调用就返回"会话检索面不可用"。
   */
  readonly sessionQuery?: (() => SessionQueryLike | undefined) | undefined
  /** `ctx.compaction`，即本插件自己提供的后端。 */
  readonly compaction?: CompactionPort | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** 从执行上下文里取会话 id；取不到返回 undefined，由调用方如实报错。 */
function sessionIdOf(exec: unknown): string | undefined {
  const record = asRecord(exec)
  const agent = record === undefined ? undefined : asRecord(record['agent'])
  const session = agent === undefined ? undefined : asRecord(agent['session'])
  const id = session === undefined ? undefined : session['id']
  return typeof id === 'string' ? id : undefined
}

/**
 * 取可安全用于手动压缩的 agent 上下文。
 *
 * 宿主 0.2.0-rc.2 的 `Agent` 已声明 `session`（runtime-types.d.ts:143）、`options`(:141)
 * 与 `runMaintenance`(:174)，恰好满足 `ManualCompactAgentContext`。这里仍做运行时形状检查，
 * 而不是硬转：`runMaintenance` 的真实语义是"只在 agent 空闲时执行维护任务"，
 * 少了它就地压缩会在回合中途悄悄踩坏并发假设。
 */
function compactContextOf(exec: unknown): ManualCompactAgentContext | undefined {
  const record = asRecord(exec)
  const agent = record === undefined ? undefined : record['agent']
  const candidate = asRecord(agent)
  if (candidate === undefined) return undefined
  if (typeof candidate['runMaintenance'] !== 'function') return undefined
  if (candidate['session'] === undefined) return undefined
  return agent as ManualCompactAgentContext
}

function renderAnchors(sessionId: string, anchors: ReturnType<typeof collectCheckpoints>): string {
  if (anchors.length === 0) {
    return `会话 ${sessionId} 尚无压缩记录：本次会话没有被压缩过，历史全在上下文里。`
  }
  const lines: string[] = [
    `会话 ${sessionId} 的压缩锚点账本（共 ${anchors.length} 次，累计压掉约 ${totalShadowedTokens(anchors)} tokens）：`,
  ]
  for (const anchor of anchors) {
    const range =
      anchor.shadowedSeqs.length > 0
        ? `seq ${anchor.shadowedSeqs[0]}…${anchor.shadowedSeqs[anchor.shadowedSeqs.length - 1]}（${anchor.shadowedSeqs.length} 个事件）`
        : '锚点缺失'
    const label = anchor.ordinal === undefined ? '（无条目：该次未产出摘要）' : `T${anchor.ordinal}`
    lines.push(
      `- ${label}｜${anchor.compactionId}｜被压区间 ${range}｜约 ${anchor.shadowedTokenCount ?? '未知'} tokens`
        + `｜摘要由 ${anchor.provider ?? '未知'}/${anchor.model ?? '未知'} 写`
        + (anchor.error === undefined ? '' : `｜该次失败：${anchor.error}`),
    )
  }
  lines.push('')
  lines.push('要看被压掉的逐字原文，用 context_read 传 compactionId（或直接传 seqs）。')
  return lines.join('\n')
}

/** 锚点加载结果：把"服务压根没注入"与"读了但失败"分开，错误信息才会指向真正的原因。 */
type AnchorLoad =
  | { readonly ok: true; readonly anchors: ReturnType<typeof collectCheckpoints> }
  | { readonly ok: false; readonly reason: 'no-service' | 'read-failed' }

/** 构造三个工具（两个只读 + 一个手动压缩）。 */
export function createContinuumTools(deps: ContinuumToolDeps): ToolDefinition[] {
  const loadAnchors = async (sessionId: string): Promise<AnchorLoad> => {
    // 取值器在**调用时**才求值，因此不受注册顺序影响。
    const query = deps.sessionQuery?.()
    if (query === undefined) return { ok: false, reason: 'no-service' }
    const events: LogEventLike[] | undefined = await readSessionEvents(query, sessionId)
    if (events === undefined) return { ok: false, reason: 'read-failed' }
    return { ok: true, anchors: collectCheckpoints(events) }
  }

  /** 统一的失败话术：明确区分"宿主没给服务"与"服务读不到这个会话"。 */
  const anchorFailure = (sessionId: string, reason: 'no-service' | 'read-failed', suffix: string): string =>
    reason === 'no-service'
      ? `会话检索面未注入（ctx.sessionQuery 不可用），${suffix}`
      : `会话检索面无法读出会话 ${sessionId} 的事件日志，${suffix}`

  const anchorsTool = defineTool({
    name: 'context_anchors',
    description:
      '列出本会话历次上下文压缩的锚点账本：每次压缩压掉了哪些原始事件（seq）、省了多少 token、'
      + '摘要由哪个模型写成。条目序号 T<n> 与上下文里索引条目的 T<n> 一一对应，用于判断"哪些历史已被压出上下文"以及取得回原文所需的锚点。',
    parameters: {
      sessionId: {
        type: 'string',
        description: '目标会话 id；省略时用当前会话。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const sessionId = args.sessionId ?? sessionIdOf(exec)
      if (sessionId === undefined) return '无法确定会话 id：请显式传入 sessionId。'
      const anchors = await loadAnchors(sessionId)
      if (!anchors.ok) {
        return anchorFailure(sessionId, anchors.reason, '因此无法给出锚点账本。')
      }
      return renderAnchors(sessionId, anchors.anchors)
    },
  })

  const readTool = defineTool({
    name: 'context_read',
    description:
      '按锚点取回被压缩掉的**逐字原文**。传 compactionId 可一次取回该次压缩遮蔽的全部原始事件；'
      + '也可直接用 seqs 指定事件序号。原文来自 append-only 日志，不受摘要改写影响。',
    parameters: {
      compactionId: {
        type: 'string',
        description: '要展开的某次压缩事务 id；与 seqs 二选一。',
      },
      seqs: {
        type: 'array',
        items: { type: 'integer' },
        description: '要取回的原始事件 seq 列表。',
      },
      sessionId: {
        type: 'string',
        description: '目标会话 id；省略时用当前会话。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const sessionId = args.sessionId ?? sessionIdOf(exec)
      if (sessionId === undefined) return '无法确定会话 id：请显式传入 sessionId。'

      let seqs: readonly number[] = args.seqs ?? []
      if (seqs.length === 0) {
        if (args.compactionId === undefined) {
          return '请提供 compactionId 或 seqs 之一。'
        }
        const loaded = await loadAnchors(sessionId)
        if (!loaded.ok) {
          return anchorFailure(sessionId, loaded.reason, '无法解析 compactionId。')
        }
        const anchor = loaded.anchors.find((item) => item.compactionId === args.compactionId)
        if (anchor === undefined) {
          return `会话 ${sessionId} 中没有压缩事务 ${args.compactionId}。`
        }
        seqs = anchor.shadowedSeqs
        if (seqs.length === 0) return `压缩事务 ${args.compactionId} 没有记录被遮蔽的事件 seq。`
      }

      const slices = await readOriginalSlices(deps.sessionQuery?.(), sessionId, seqs)
      if (slices === undefined) {
        return deps.sessionQuery?.() === undefined
          ? '会话检索面未注入（ctx.sessionQuery 不可用），无法取回原文。'
          : `会话检索面无法读出会话 ${sessionId} 的事件日志，无法取回原文。`
      }
      if (slices.length === 0) {
        return `在会话 ${sessionId} 中未找到 seq 为 ${seqs.join(', ')} 的事件。`
      }
      const lines: string[] = [`会话 ${sessionId} 的逐字原文（${slices.length} 个事件）：`]
      for (const slice of slices) {
        lines.push('')
        lines.push(`### seq ${slice.seq} · ${slice.type}`)
        lines.push(slice.text === '' ? '（该事件没有可读文本）' : slice.text)
      }
      return lines.join('\n')
    },
  })

  const compactTool = defineTool({
    name: 'context_compact',
    description:
      '就地压缩当前会话的历史：把选定的旧区间替换成一个「会话索引」（不可变条目，只追加），被替掉的原文仍可经 '
      + 'context_read 取回。**不新建会话**。若当前回合正在进行，官方引擎会以 busy 拒绝——'
      + '回合边界的压力压缩会自动发生，无需手动调用。',
    parameters: {
      reason: {
        type: 'string',
        description: '为什么现在要压缩（会记入日志便于事后回看）。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      const compaction = deps.compaction
      if (compaction === undefined) return '宿主当前没有压缩后端，无法就地压缩。'
      const context = compactContextOf(exec)
      if (context === undefined) {
        return '当前执行上下文没有可用的 agent 会话（缺 session 或 runMaintenance），无法就地压缩。'
      }
      try {
        const result = await compaction.compactNow(context, exec.signal)
        if (result === null) {
          return '没有可安全压缩的区间：历史已经足够短，本次未写入任何内容（无操作不留痕）。'
        }
        return `已压缩：遮蔽 ${result.shadowedSeqs.length} 个事件`
          + `（seq ${result.shadowedRange.start}…${result.shadowedRange.end}），`
          + `约省 ${result.shadowedTokenCount} tokens。原文可用 context_read 按锚点取回。`
      } catch (error: unknown) {
        if (error instanceof ManualCompactionError) {
          if (error.code === 'busy') {
            return '当前回合进行中，官方引擎拒绝了就地压缩（busy）；回合边界的自动压力压缩会接管。'
          }
          return `压缩未完成（${error.code}）：${error.message}`
        }
        const message = error instanceof Error ? error.message : String(error)
        return `压缩失败：${message}`
      }
    },
  })

  return [anchorsTool, readTool, compactTool]
}
