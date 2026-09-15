← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 14:29 - Wire the planted-defect benchmark (#270, SPEC §8.2): machine-readable answer keys, a pure scorer, a headless runner mirroring the shipped recipe, one-owner results file with render + drift gate, a weekly workflow — and publish the real score, honestly labelled

**Reasoning:** SPEC 2.0 §8.2 requires a periodic planted-defect test whose failure taints every clean result since the last pass, and §4.9 says a review cut short for cost is unverified, never clean. Before this there was no runner, no workflow, no machine-readable score, and the site hardcoded 100% with no drift check while benchmark/README claimed a workflow that never existed. Now: benchmark/scenarios/<id>/answer.json is the owner of each planted site; src/core/benchmark-score.ts scores deterministically (a catch must be LOCATED at the site; file-less findings credit only on a whole-token file-name match; unverified is never clean); scripts/run-benchmark.mjs runs headless Claude Code with the recipe, tool grants and model read from the SAME template it renders (one contract, drift fails a test), enforces the cost cap BEFORE each call, shuffles by a recorded seed so a cost stop cannot silently drop the decoys, validates the reviewer payload, and refuses to publish a dry run or a run that verified nothing; benchmark/results/latest.json is the single owner of every published number — scripts/render-benchmark.mjs renders README/benchmark docs/site const from it and scripts/check-benchmark-claims.mjs fails CI on drift or on any block that publishes a ratio without naming the unverified remainder; .github/workflows/benchmark.yml runs weekly/dispatch only (never on PRs), skips loudly without ANTHROPIC_API_KEY, opens a PR against dev. latest.json carries the last REAL measurement — the 2026-07-03 manual panel, 14/14, 0 false flags — labelled 'manual panel (pre-automation)', never a fabricated automated score. The committed corpus is fixed and public, so the wording says it measures regression, not §8.2 liveness; the generated-defect half is the next lane. Two refute panels + a final fixer; guards mutation-proven; 59 files / 1356 tests green in the lane tree.

**Alternatives considered:** Publish nothing until an automated run exists (rejected: the CEO ruled publish the real score; the manual panel is a real measurement when labelled), Score a catch as any finding in the scenario (rejected: the right scenario for the wrong reason is not evidence), Keep the site's hand-typed 100% (rejected: two owners of one number)

**Implications:**
- The weekly job needs an ANTHROPIC_API_KEY repo secret (none exists) — it skips loudly until then
- A red benchmark PR is now possible and is the point: a miss means every clean review since the last pass is suspect (§8.2); who acts on that is undecided
- §8.2's 'MUST be generated' is still unmet by construction — tracked for the next lane on #270

---

