← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 14:48 - Extract review engine (review-plan/budget-plan/multi-pass-aggregate) into clud-bug/core — rc.12

**Reasoning:** Wave 6b PR 0: local mode must run clud-bug's FULL review brain (multi-pass tiering, budget gate, aggregation), not a hand-picked subset. That brain was pure logic trapped in clud-bug-app/lib while clud-bug/core (what local consumes) had only the rendering. Extracting to core makes the hosted bot, the npm workflow, and local mode share ONE engine — the Bug-9 single-source-of-truth principle applied to the engine. Behavior-identical: the App's unit suites were ported (77 tests) and pass; 816 total green.

**Alternatives considered:** Reimplement a lighter local-only planner — rejected: divergent logic defeats single-source-of-truth and the CEO 'apply ALL our logic to local' directive.

**Implications:**
- PR 0b re-wires the App onto core. consensus now rides the canonical UnifiedFinding (an adversarial review caught it being erased at the aggregatePasses return boundary) so the App's SPEC 6.10.2 auto-fix gate type-checks against core. rc.12 publish is a USER ACTION.

---

