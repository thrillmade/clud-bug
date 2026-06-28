← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 15:16 - Add planReview — the shared review-plan entry point (SPEC §11.5), trigger/diff tiered

**Reasoning:** The single planning entry point §11.5 specifies: composes resolveReviewPasses + estimateBudget so every consumer (hosted bot, npm workflow, local mode) plans identically. Applies trigger tiering (commit -> a single fast beetle-tier pass; diff >= LARGE_DIFF_THRESHOLD_BYTES -> auto-tier) so the fast-vs-deep choice falls out of the tier system, never hand-picked per call — the answer to the CEO 'models based on diff' ask. Rides in the still-unpublished rc.12.

**Alternatives considered:** Have each consumer compose resolveReviewPasses + estimateBudget itself — rejected: divergent planning, no single conformant contract.

**Implications:**
- Consumed by the App re-wire (PR 0b) and the review-prompt verb (PR C). Adversarial review caught + fixed an off-by-one (>= threshold) and a tiered-plan cost overestimate (only the running tier is billed); both now have regression tests. 825 tests green.

---

