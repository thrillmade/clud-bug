// Public API surface for `clud-bug` CLI helpers (consumed via the package's
// `.` exports map → `dist/cli/index.js`).
//
// Each line re-exports one CLI module's public symbols. Modules are
// added incrementally as the v0.7.0 TypeScript migration converts each
// lib/* JS file.

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
