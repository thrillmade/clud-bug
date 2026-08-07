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
  sliceUtf8Bytes,
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
  type RenderedFindingRef,
  type CacheStats,
  type RenderMultiPassMarkdownInput,
  type Consensus,
  type MultiPassReview,
  type UnifiedFinding,
  type PassAttribution,
  type PassSource,
  type ReviewPassMode,
  type MultiPassVerdict,
} from './review-writeback.js';
// SPEC §7.2.1 formal-review event selector. Pure rule-table half of
// clud-bug-app's `lib/formal-review.ts`; the Octokit-side IO wrapper
// (`postFormalReview`) stays App-side. v0.7.0-rc.3 adds the
// `authorAssociation` extension so a clean review on an external
// contributor's PR routes to COMMENT (not APPROVE) — the canonical
// ruleset's `required_approving_review_count: 1` floor then requires
// a human reviewer.
export {
  selectReviewEvent,
  type FormalReviewEvent,
  type AuthorAssociation,
  type SelectReviewEventInput,
} from './formal-review.js';
// SPEC §1.8.1 Resolved / Still-open block helpers. `parsePriorReviewFile`
// reads a prior `docs/reviews/PR-<n>.md`; `diffFindings` splits prior vs
// current into resolved + still-open lists that `renderReviewFile`
// emits as the §1.8.1 blocks. Identity scheme is shareable with future
// inline-thread anchoring in clud-bug-app.
export {
  parsePriorReviewFile,
  diffFindings,
  findingIdentity,
  type ParsedFinding,
  type ParsedReview,
} from './diff-findings.js';
// Wave 5a — D.2.X per-finding inline review threads. Pure helpers
// (anchor detection, comment rendering, plan partitioning) + the GraphQL
// constants the CLI's `post-inline-threads` verb invokes via `gh api`.
// `findingId` returns the SHA-256[:16] hash and is distinct from the
// plain-string `findingIdentity` above (both serve different matchers).
//
// Wave 5b additions: `parseThreadBody` (inverts renderThreadBody) +
// `ADD_REPLY_MUTATION` (for posting the auto-resolve marker reply
// before resolving a thread).
export {
  findingId,
  parseHeadLines,
  findingAnchorable,
  extractAnchorContext,
  renderThreadBody,
  extractFindingIdFromBody,
  parseThreadBody,
  planInlineThreads,
  REVIEW_THREADS_QUERY,
  REVIEW_THREADS_STATE_QUERY,
  RESOLVE_THREAD_MUTATION,
  ADD_REPLY_MUTATION,
  type Severity as InlineThreadSeverity,
  type FindingForThread,
  type DiffFile,
  type InlineCommentPlan,
  type PlanInlineThreadsResult,
} from './inline-threads.js';
// Wave 5b — D.2.6 auto-resolve on fix-push. Pure rule tables + config
// merge + marker rendering. The CLI's `resolve-threads` verb owns the
// Anthropic Messages call + GraphQL mutations; `runAutoResolve` is
// pure modulo the injected verifier callback.
export {
  resolveAutoResolveConfig,
  readAutoResolveConfigFromCludBug,
  runAutoResolve,
  applyResolutionRules,
  renderAutoResolveMarker,
  DEFAULT_AUTO_RESOLVE_CONFIG,
  type AutoResolveConfig,
  type PriorThread,
  type PriorFinding,
  type ThreadAction,
  type AutoResolveInput,
  type AutoResolveResult,
  type VerifyOutcome,
} from './auto-resolve.js';
export {
  VERIFIER_SYSTEM,
  buildVerifierSystem,
  buildVerifierPrompt,
  parseVerifierResponse,
  type VerifierOutputMode,
  type VerifySingleFindingInput,
} from './resolve-verifier.js';
// SPEC §7 canonical-ruleset applier. Pure diff + idempotent-PATCH logic;
// CLI side wraps `gh api` in an Octokit-like adapter and the App passes
// its real Octokit instance. Shipped in v0.7.0-rc.4 for Marketplace prep
// (Phase 6 task #227).
export {
  applyCanonicalRuleset,
  loadCanonicalV1,
  loadPreset,
  isPresetName,
  PRESET_NAMES,
  DEFAULT_PRESET,
  CANONICAL_REPO_CONVENIENCES,
  type CanonicalRuleset,
  type PresetName,
  type RepoConveniences,
  type OctokitLike,
  type ApplyCanonicalRulesetParams,
  type ApplyResult,
} from './configure-github.js';
// Wave 6b — review-planning "brain" ported from clud-bug-app/lib. Three pure
// modules: the multi-pass config resolver (`review-plan`), the Layer-1 cost
// gate (`budget-plan`), and the multi-pass aggregator (`multi-pass-aggregate`).
//
// `ReviewPassMode` is intentionally NOT re-exported here — `review-writeback`
// above already owns that name in the barrel (both declarations are the same
// `'cross-check' | 'consensus' | 'independent'` union). Likewise the
// aggregator's result types (`MultiPassReview`, `UnifiedFinding`,
// `PassAttribution`, `PassSource`) come from `review-writeback` and are NOT
// re-declared by the aggregator module — it imports them.
export {
  readReviewPassesConfig,
  extractSkillReviewPassesOverride,
  resolveReviewPasses,
  roleForPass,
  anyMultiPass,
  totalPassCount,
  REVIEW_PASS_MODES,
  MAX_PASSES,
  MIN_PASSES,
  BUILTIN_DEFAULT,
  BUILTIN_ROLES,
  type ApplyTo,
  type ReviewPassesEntry,
  type ReviewRoleTier,
  type ReviewRole,
  type ResolvedReviewPasses,
  type ReviewPassesConfig,
  type SkillReviewPassesFrontmatter,
  type ReviewPlanSkill,
  type ResolveReviewPassesInput,
  type ResolveReviewPassesResult,
} from './review-plan.js';
export {
  perCallCeiling,
  estimateBudget,
  estimateVerifierBudget,
  __setModelCeilingForTests,
  DEFAULT_PER_PR_CAP_USD,
  DEFAULT_VERIFIER_PER_PR_CAP_USD,
  type BudgetEstimateInput,
  type BudgetEstimate,
  type BudgetVerdict,
  type VerifierBudgetInput,
  type VerifierBudgetEstimate,
  type VerifierBudgetVerdict,
} from './budget-plan.js';
export {
  planReview,
  LARGE_DIFF_THRESHOLD_BYTES,
  type PlanReviewInput,
  type ReviewPlan,
  type ReviewTrigger,
  type TierDownReason,
} from './plan-review.js';
export {
  aggregatePasses,
  deriveConsensus,
  resolveVerdict,
  shouldEscalate,
  type CrossCheckVerdict,
  type CrossCheckPassResult,
  type AggregateInput,
  type EscalationInput,
} from './multi-pass-aggregate.js';
export {
  readDesignConfig,
  shouldRunDesign,
  BUILTIN_DESIGN_CONFIG,
  type DesignConfig,
  type DesignGate,
} from './design.js';
// Phase ZP2: default-on notary config resolver — the shared brain for
// `post-check-run` (submit path) and `review-prompt` (§5 recipe rendering)
// so both resolve the same notary origin (or opt-out) the same way.
export { readNotaryConfig, DEFAULT_NOTARY_URL } from './notary-config.js';
// SPEC 2.0 §4.7 — CI evidence: config + in-scope gate. Replaces the deleted
// executable-probe surface (Phase R / clud-bug-app #87, `invariants.ts`) —
// §4.7 bans reviewer execution unconditionally, so the reproduction form is no
// longer a command the reviewer runs; it is a CI check the repository's own
// forge already ran, read rather than executed. ON by default; `ciChecks`
// only narrows which checks are read (clud-bug#264).
export {
  readCiChecksConfig,
  shouldReadCiChecks,
  BUILTIN_CI_CHECKS_CONFIG,
  type CiChecksConfig,
} from './ci-checks.js';
export {
  readReviewContext,
  extractPrContext,
  fenceUntrustedContext,
  EMPTY_REVIEW_CONTEXT,
  MAX_REVIEW_CONTEXT_BYTES,
  type ReviewContextConfig,
} from './review-context.js';
export {
  deriveCheck,
  normalizeVerdict,
  CLUD_BUG_CHECK_NAME,
  VERDICT_CONCLUSION_TABLE,
  type ReviewVerdict,
  type CheckConclusion,
  type CheckSource,
  type DerivedCheck,
  type DeriveCheckInput,
} from './check-verdict.js';
// Phase Z3 — the NOTARY. `notary-bundle` owns the attestation-bundle shape (the
// contract Z4's `/notarize` consumes) + a tolerant parser; `notary-validate` owns
// the pure deterministic ③④⑤ checks (coverage / grounding / consistency) both the
// local CLI and the server re-run. SPEC §10.3.3.
export {
  buildBundle,
  parseBundle,
  notaryResponseIsRejection,
  NOTARY_BUNDLE_VERSION,
  NOTARY_PROTOCOL_VERSION,
  type NotaryBundle,
  type NotaryFinding,
  type NotarySeverity,
  type GroundingKind,
} from './notary-bundle.js';
export {
  validateBundle,
  validateCoverage,
  validateGrounding,
  validateConsistency,
  spanAppearsInDiff,
  splitUnifiedDiff,
  type BundleValidation,
  type CoverageResult,
  type GroundingResult,
  type GroundingViolation,
  type ConsistencyResult,
} from './notary-validate.js';
export {
  API_BASE,
  MAX_SKILLS,
  SkillsClient,
  normalizeList,
  rankAndCap,
  readReviewMode,
  readAppliesTo,
  appliesToPr,
  appliesToAuthor,
  partitionByReviewMode,
  extractPerSkillLine,
  selectReviewHeader,
  extractFirstReviewHeaderLine,
  selectReviewBody,
  extractStatsHeader,
  isCriticalReviewHeader,
  classifyPerSkillOutcome,
  parseFrontmatter,
  resolveSkillKind,
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
  type SkillKind,
} from './skills.js';
