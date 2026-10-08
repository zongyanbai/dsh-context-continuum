/**
 * 入口：默认导出即压缩后端类，供 cordis 以「一个插件行 = 一个服务实现」的方式挂载。
 *
 * 挂载契约（与官方 `@deepseek-ai/dsh-compaction-basic`、以及 continuity 的
 * `./compaction-engine` 完全一致）：加载器取 `exports.default ?? exports`，只接受
 * 函数、类或 `{ apply }`；丢掉 default 导出就等于这一行什么也没做。
 *
 * @module @local/dsh-context-continuum
 */

export { ContinuumCompactionEngine, default } from './engine.ts'

export {
  collectCheckpoints,
  blocksToText,
  totalShadowedTokens,
  type CheckpointAnchor,
  type LogEventLike,
} from './anchors.ts'

export {
  assembleIndex,
  buildGuidanceMessage,
  cleanBlankRuns,
  clipTitle,
  extractInheritedIndex,
  extractNewEntry,
  normalizeIndex,
  renderArtifactLine,
  CURRENT_STATE_HEADER,
  EMPTY_CURRENT,
  EMPTY_ENTRY_NOTE,
  EMPTY_INDEX,
  ENTRY_PREFIX,
  GUIDANCE_MARKER,
  INDEX_GUIDANCE,
  INDEX_HEADER,
  INDEX_MARKER,
  MAX_ENTRIES_IN_SURFACE,
  MAX_TITLE_CHARS,
  NO_INHERITANCE,
  ARCHIVE_PREFIX,
  archiveLine,
  highestOrdinal,
  splitEntryBlocks,
  type AssembleIndexInput,
  type InheritedIndex,
} from './indexlog.ts'

export {
  extractArtifactPaths,
  presentedArtifactsFromEvents,
  readPresentedArtifacts,
  MAX_ARTIFACTS,
  type PresentedArtifact,
} from './artifacts.ts'

export {
  extractEventText,
  readOriginalSlices,
  readSessionEvents,
  toEventArray,
  toLogEventLike,
  type OriginalSlice,
  type SessionQueryLike,
} from './trace.ts'

export { createContinuumTools, type ContinuumToolDeps } from './tools.ts'
