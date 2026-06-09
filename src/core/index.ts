// Public API surface for `clud-bug/core` (consumed via the package's
// `./core` exports map → `dist/core/index.js`).
//
// Each line re-exports one core module's public symbols. Modules are
// added incrementally as the v0.7.0 TypeScript migration converts each
// lib/* JS file.

export { reviewPrompt, type ReviewPromptOptions, type ReviewPromptLanguage } from './prompts.js';
export {
  REVIEW_SCHEMA,
  serializedReviewSchema,
  type ReviewData,
  type ReviewFinding,
  type ReviewSummaryCounts,
  type ReviewStatusHeader,
  type FindingSeverity,
  type PerSkillScanItem,
  type DedicatedSection,
} from './review-schema.js';
export { renderReview, SEVERITY_LABEL } from './render-review.js';
export {
  detect,
  buildDescriptionLine,
  EXT_TO_LANG,
  DEP_TO_TERM,
  PY_DEP_TO_TERM,
  fileHistogram,
  firstParagraph,
  type DetectedSignals,
  type DescriptionLineSignals,
} from './detect.js';
export {
  render,
  renderFile,
  pickTemplate,
  templateLanguage,
  DEFAULTS,
  type RenderDefaults,
  type RenderVars,
  type TemplateLanguage,
} from './render.js';
export {
  durationToGitSince,
  renderAuditHeader,
  type AuditHeaderInput,
} from './audit.js';
// Zod-typed wire-shape review + internal-shape helpers for the
// AI-Gateway consumer (clud-bug-app). The CLI-shape JSON Schema +
// CLI summary-comment renderer above stay first-class; the Zod port
// below is additive.
//
// Naming: the wire-shape `FindingItem` collides with neither CLI nor
// App existing exports. The internal-shape `Finding` (FindingItem +
// severity) is re-exported as `ZodFinding` to disambiguate from the
// CLI's `ReviewFinding`.
export {
  reviewSchema,
  crossCheckSchema,
  findingItemSchema,
  findingSchema,
  perSkillScanItemSchema,
  dedicatedSectionSchema,
  summaryCountsSchema,
  severitySchema,
  statusHeaderSchema,
  crossCheckVerdictSchema,
  severityValues,
  statusHeaderValues,
  flattenFindings,
  unflattenFindings,
  deriveSummaryCounts,
  deriveSkillsReferenced,
  buildReviewFromFindings,
  type Review,
  type CrossCheck,
  type CrossCheckVerdictSchema,
  type Severity,
  type StatusHeader,
  type SummaryCounts,
  type FindingItem,
  type PerSkillScanItem as ZodPerSkillScanItem,
  type DedicatedSection as ZodDedicatedSection,
  type Finding as ZodFinding,
} from './review-schema-zod.js';
// AI-Gateway prompt builder (App's review pass). The CLI-shape
// `reviewPrompt` workflow-string above stays; this is additive.
export {
  buildReviewPrompt,
  buildCrossCheckPrompt,
  buildConsensusPrompt,
  skillMatchesDiff,
  globMatch,
  truncatePatch,
  MAX_PATCH_BYTES_PER_FILE,
  DEFAULT_MAX_SKILL_BYTES,
  type BuildReviewPromptInput,
  type BuildCrossCheckPromptInput,
  type BuiltPrompt,
  type ChangedFile,
  type ChangedFileStatus,
  type PullRequestDiff,
  type PromptAppliesToRule,
  type PromptSkillFrontmatter,
  type PromptLoadedSkill,
} from './prompt-builder.js';
// SPEC §1.8.1 doc-file renderer (`docs/reviews/PR-<n>.md`). Renamed
// from the App's `renderReview` to `renderReviewFile` to disambiguate
// from the CLI's `renderReview` (summary PR-comment shape) above.
export {
  renderReviewFile,
  renderMultiPassMarkdown,
  reviewFilePath,
  reviewCommitMessage,
  PROTOCOL_VERSION,
  WRITTEN_BY,
  SEVERITY_EMOJI as REVIEW_FILE_SEVERITY_EMOJI,
  type RenderReviewFileInput,
  type RenderMultiPassMarkdownInput,
  type MultiPassReview,
  type UnifiedFinding,
  type PassAttribution,
  type PassSource,
  type ReviewPassMode,
  type MultiPassVerdict,
} from './review-writeback.js';
export {
  API_BASE,
  MAX_SKILLS,
  SkillsClient,
  normalizeList,
  rankAndCap,
  readReviewMode,
  readAppliesTo,
  appliesToPr,
  partitionByReviewMode,
  extractPerSkillLine,
  selectReviewHeader,
  extractFirstReviewHeaderLine,
  selectReviewBody,
  extractStatsHeader,
  isCriticalReviewHeader,
  classifyPerSkillOutcome,
  parseFrontmatter,
  stripFrontmatter,
  type SkillDescriptor,
  type RankableSkill,
  type AppliesToRule,
  type SkillWithOptionalContent,
  type PrComment,
  type ReviewStatsHeader,
  type SkillFrontmatter,
  type SkillSource,
  type SkillReviewMode,
} from './skills.js';
