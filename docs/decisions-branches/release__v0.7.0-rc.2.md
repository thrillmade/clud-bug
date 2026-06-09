← back to [docs/timeline.md](../timeline.md)

## 2026-06-09 17:19 - v0.7.0-rc.2 — add AI-Gateway-shape Zod schema + flat-finding helpers to core

**Reasoning:** Phase 4 of the Bug 9 migration (clud-bug-app deletes ~6,500 LOC of duplicate code by importing from clud-bug/core) was unblockable because the rc.1 core/ exports were CLI-shape-only: plain JSON-Schema REVIEW_SCHEMA, workflow-string reviewPrompt, summary-PR-comment renderReview. The App's runtime needs Zod schemas (AI SDK derives JSON Schema from Zod) and the helper functions that convert wire→internal→wire shape. Ported clud-bug-app/lib/review-schema.ts byte-equivalently into src/core/review-schema-zod.ts as ADDITIVE exports — the CLI-shape exports stay first-class. Wire shape (3 severity arrays per SPEC §1.8.1) is the SAME between Zod and JSON-Schema versions; only the validator differs. Internal-shape Finding (FindingItem + severity) re-exported as ZodFinding to disambiguate from the CLI's ReviewFinding.

**Alternatives considered:** Move the App's Zod schemas verbatim AND retire the CLI-shape JSON-Schema (would break the strict-mode-gate composite which depends on REVIEW_SCHEMA as a JSON-Schema object the Agent SDK validator wants on --json-schema flag), Wait until Phase 4 to define the shape (kicks the can; Phase 4 agent is already blocked, would mean App+core round-trip per design decision)

**Implications:**
- App can now import {reviewSchema, flattenFindings, unflattenFindings, deriveSummaryCounts, deriveSkillsReferenced, buildReviewFromFindings, ZodFinding, CrossCheck} from clud-bug/core. Equivalence test (test/review-schema-zod.test.js) asserts both validators describe the SAME required wire-shape fields — future drift caught in CI.

---

## 2026-06-09 17:20 - v0.7.0-rc.2 — port AI-Gateway prompt builder + doc renderer + skill frontmatter parser to core (Phase 4 unblock)

**Reasoning:** rc.1 core/ shipped CLI-shape-only exports. Phase 4 of Bug 9 migration (App deletes ~6,500 LOC by importing from clud-bug/core) needs App-shape equivalents: Zod schemas for the AI SDK, {system, prompt} prompt builders that include byte-capped skill bodies, SPEC §1.8.1 'docs/reviews/PR-#.md' renderer, and SKILL.md frontmatter parser. All ported byte-equivalently from clud-bug-app/lib/{review-schema,prompt-builder,review-writeback,skills-loader}.ts as ADDITIVE exports — CLI shape stays first-class. Equivalence tests (91 new) pin the contract so the App's eventual swap can't drift silently.

**Alternatives considered:** Wait for the App swap to land first and copy back to core post-hoc (kicks the can; Phase 4 agent already escalated with realistic LOC deletable = ~50-100 against rc.1, vs 6,500 target), Move both consumers to a single shared shape and break either CLI or App immediately (would require lockstep PRs across 2 repos + a stop-the-world coordination on the strict-mode-gate composite Agent SDK validator path), Ship Zod schemas only without the helper ports (App still has to duplicate flattenFindings/unflattenFindings/deriveSummaryCounts/deriveSkillsReferenced/buildReviewFromFindings/buildReviewPrompt/renderReviewFile — defeats the purpose; the LOC delete target collapses to ~200)

**Implications:**
- Net +1212 LOC added to src/core/ across 3 new files + 252 LOC into existing skills.ts + 84 LOC barrel rewrite. App can now: (a) import {reviewSchema, crossCheckSchema, flatten/unflatten/derive*, buildReviewFromFindings} for the Zod validation path; (b) import {buildReviewPrompt, buildCrossCheckPrompt, buildConsensusPrompt, MAX_PATCH_BYTES_PER_FILE, DEFAULT_MAX_SKILL_BYTES} for the AI-Gateway call; (c) import {renderReviewFile, renderMultiPassMarkdown, reviewFilePath, reviewCommitMessage, PROTOCOL_VERSION, WRITTEN_BY} for SPEC §1.8.1 doc-file writeback; (d) import {parseFrontmatter, stripFrontmatter, type SkillFrontmatter} for SKILL.md loading. Octokit-side writeback STAYS App-side (depends on Octokit which we don't pull into core).
- Naming: ZodFinding (FindingItem + severity) disambiguates from the CLI's ReviewFinding (never carries severity). renderReviewFile (doc-file shape, H1) disambiguates from renderReview (PR-comment shape, H2). REVIEW_FILE_SEVERITY_EMOJI re-export aliases SEVERITY_EMOJI so callers know which renderer's emoji table they're getting.
- Zod runtime dependency added (zod@^4.4.3 matches the App's pin). Audit clean for production deps.
- Template + composite action pins bumped: strict-mode-gate@v0.7.0-rc.1 → v0.7.0-rc.2 in 3 templates + action.yml header. Release-discipline test enforces lockstep.

---

## 2026-06-09 17:32 - v0.7.0-rc.2: fix clud-bug-review #158 critical + 2 minor on first pass

**Reasoning:** PR #158 clud-bug-review fired 1 critical + 2 minor. Per gate #8 (clud-bug-review CLEAN, non-negotiable) the critical must be fixed before merge. CRITICAL: buildReviewFromFindings defaulted to 'critical findings' for ANY non-empty list (minor-only and preexisting-only included) — wrong per SPEC §1.8.1. The App's original helper had the same bug; fixed on port to core (derive from severity, not emptiness). MINOR #1: UTF-8 byte-cap discrepancy (slice by code units, measure by bytes) in sliceUtf8Bytes (new helper) + truncatePatch (existing) + skill-body slicer. Extracted byte-correct slicer that uses Buffer.subarray then strict-decodes with replacement-char strip. MINOR #2: f.file is z.string().optional() so renderFinding + renderUnifiedFinding + renderPass1FindingsBlock would emit literal 'undefined' on findings without a file field — added (unknown file) fallback in all 3 sites.

**Alternatives considered:** Wait for App swap and let the App-side review catch these (unacceptable — gate #8 is non-negotiable, and silent behavior divergence would surface as runtime regression instead of test failure), Skip the byte-cap fix because skill files are conventionally English ASCII (low-cost defensive fix, the cap contract should hold for arbitrary content, and the test now covers CJK + 4-byte emoji), Skip the f.file guard because the model is instructed to always provide it (the schema permits omission, so a single model slip yields user-visible 'undefined' in a committed docs/reviews/PR-N.md file)

**Implications:**
- buildReviewFromFindings is a TEST HELPER — the production AI-Gateway path constructs reviews directly from AI output. So the behavior fix is observable only in the equivalence test harness; production semantics unchanged. App's own test-helper had the same bug; App's swap inherits the fix.
- sliceUtf8Bytes added to barrel for callers that need byte-correct slicing outside the prompt builder. 11 new tests cover ASCII-equivalence, CJK 3-byte content, 4-byte emoji, zero-cap, and the patch + skill-body call sites.
- 470 tests pass (459 + 11 new). No workflow file changes. Template + action.yml pins still at v0.7.0-rc.2.

---

