// Public API surface for `clud-bug` CLI helpers (consumed via the package's
// `.` exports map → `dist/cli/index.js`).
//
// Each line re-exports one CLI module's public symbols. Modules are
// added incrementally as the v0.7.0 TypeScript migration converts each
// lib/* JS file.

// The top-level dispatcher main() lives in main.ts; bin/clud-bug.js
// imports it through this barrel and runs it. Keeping main() out of
// this file avoids accidental side effects when consumers
// `import { ... } from 'clud-bug'`.
export { main } from './main.js';

export {
  detectRepo,
  detectDefaultBranch,
  getProtectionState,
  enableConversationResolution,
  type GhResult,
  type GhOptions,
  type GhInvoker,
  type DetectRepoOptions,
  type DetectedRepo,
  type DetectDefaultBranchOptions,
  type ProtectionState,
  type GetProtectionStateOptions,
  type EnableConversationResolutionOptions,
  type EnableResult,
} from './branch-protection.js';

export {
  getPendingWorkflowEdits,
  isWorkflowFile,
  makeBranchName,
  git,
  type PendingWorkflowEdits,
  type GitOptions,
  type GitResult,
} from './edit-workflow.js';

export {
  renderBlock,
  detectSkillRelPath,
  upsertBlock,
  hasAgentsMdImport,
  removeBlock,
  applyToRepo,
  type RenderBlockOptions,
  type ApplyToRepoResult,
} from './agents-md.js';

export {
  computeSkillUsageDelta,
  mergeSkillUsage,
  assessSkillHealth,
  formatHealthDashboard,
  DEFAULT_GH_RUNNER,
  fetchUsageArtifacts,
  aggregateUsageStream,
  type SkillDelta,
  type SkillUsageEntry,
  type SkillDeltaMap,
  type SkillUsageMap,
  type SkillHealthStatus,
  type SkillHealthRow,
  type GhRunResult,
  type GhRunner,
  type FetchUsageArtifactsOptions,
  type UsageArtifactRecord,
} from './skill-usage.js';

export {
  PRICING,
  computeReviewCost,
  costPerLOC,
  cacheHitRate,
  extractTokensFromLog,
  rollup,
  formatRollup,
  type ModelPricing,
  type TokenCounts,
  type CostParts,
  type ReviewCost,
  type ExtractedTokens,
  type ReviewRecord,
  type RollupGroupStats,
  type RollupTotal,
  type RollupTrend,
  type RollupOutlier,
  type UnknownModelReview,
  type Rollup,
  type FormatRollupOptions,
} from './usage.js';

export {
  runUpdate,
  type RunUpdateOptions,
  type UpdateChangeRecord,
  type UpdateSkippedRecord,
  type RunUpdateResult,
} from './update.js';
