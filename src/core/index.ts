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
