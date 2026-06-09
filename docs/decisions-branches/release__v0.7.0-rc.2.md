← back to [docs/timeline.md](../timeline.md)

## 2026-06-09 17:19 - v0.7.0-rc.2 — add AI-Gateway-shape Zod schema + flat-finding helpers to core

**Reasoning:** Phase 4 of the Bug 9 migration (clud-bug-app deletes ~6,500 LOC of duplicate code by importing from clud-bug/core) was unblockable because the rc.1 core/ exports were CLI-shape-only: plain JSON-Schema REVIEW_SCHEMA, workflow-string reviewPrompt, summary-PR-comment renderReview. The App's runtime needs Zod schemas (AI SDK derives JSON Schema from Zod) and the helper functions that convert wire→internal→wire shape. Ported clud-bug-app/lib/review-schema.ts byte-equivalently into src/core/review-schema-zod.ts as ADDITIVE exports — the CLI-shape exports stay first-class. Wire shape (3 severity arrays per SPEC §1.8.1) is the SAME between Zod and JSON-Schema versions; only the validator differs. Internal-shape Finding (FindingItem + severity) re-exported as ZodFinding to disambiguate from the CLI's ReviewFinding.

**Alternatives considered:** Move the App's Zod schemas verbatim AND retire the CLI-shape JSON-Schema (would break the strict-mode-gate composite which depends on REVIEW_SCHEMA as a JSON-Schema object the Agent SDK validator wants on --json-schema flag), Wait until Phase 4 to define the shape (kicks the can; Phase 4 agent is already blocked, would mean App+core round-trip per design decision)

**Implications:**
- App can now import {reviewSchema, flattenFindings, unflattenFindings, deriveSummaryCounts, deriveSkillsReferenced, buildReviewFromFindings, ZodFinding, CrossCheck} from clud-bug/core. Equivalence test (test/review-schema-zod.test.js) asserts both validators describe the SAME required wire-shape fields — future drift caught in CI.

---

