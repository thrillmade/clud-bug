← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:01 - SPEC 4.9: unset the default $5 per-PR cost ceiling in core/budget-plan

**Reasoning:** SPEC 2.0 4.9 requires the repository-facing cost ceiling to be 'configurable per install and defaulting to unset - no ceiling until someone chooses one, because a default cap silently truncates reviews nobody asked to truncate'. estimateBudget applied DEFAULT_PER_PR_CAP_USD = 5.0 whenever perPrCapUsd was absent, and no caller ever passes it (neither the CLI's resolveReviewInputs nor the hosted orchestrator), so every install ran under a $5 ceiling it never chose. An omitted perPrCapUsd now means no ceiling; capUsd is number|null and reports null. An explicitly-configured ceiling is unchanged, including 0 (a choice, not unset) and the billingExempt bypass.

**Alternatives considered:** Delete the gate entirely - rejected: an explicitly-configured ceiling is exactly what 4.9 requires a reviewer to EXPOSE, so the machinery must stay. Also rejected: unsetting the neighbouring caps. 4.9 names two distinct limits and there are three mechanisms here - the App's runaway-guard (operator's floor on its OWN spend, $5/PR/24h, applies to every install) is explicitly permitted by 4.9 and is untouched, and estimateVerifierBudget's D.2.6 cap denies into the heuristic fallback rather than truncating a review, so it keeps its default.

**Implications:**
- estimateBudget now returns allow on every default path; the hosted 'clud-bug paused this review' comment can only fire for a repo that asked for a ceiling. DEFAULT_PER_PR_CAP_USD is renamed SUGGESTED_PER_PR_CAP_USD and kept as a deprecated alias so clud-bug-app's lib/budget-gate.ts re-export shim keeps compiling (7.5); removal waits for a major. Two halves of 4.9 remain UNBUILT and are not in this change: nothing maps a .clud-bug.json key onto perPrCapUsd (the 'configurable per install' half), and this gate is a per-attempt pre-flight estimate, not the cumulative-across-attempts actual spend 4.9 describes.

---

