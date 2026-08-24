← back to [docs/timeline.md](../timeline.md)

## 2026-08-24 14:07 - Block a push on a missing or dishonest §6.7 test-suite declaration, with suite detection and an init-time ask step

**Reasoning:** SPEC 2.0 §6.7's declaration matrix has 3 of 6 rows BLOCK (missing declaration, or 'none' contradicted by a detected suite) and #276 shipped only the allow-and-report half, deliberately, to avoid wedging existing installs before a setup flow existed to collect the declaration. This PR builds that setup flow (clud-bug init detects a package.json test script and asks, per 'Setup MUST ask, and MUST NOT complete without an answer') and the detector the block path needs to tell 'none' from a lie ('Detection is what makes none honest'), so the block can ship safely.

**Alternatives considered:** Block unconditionally on any missing declaration, no detection at all — rejected: cannot distinguish an honest 'none' from a lie, and the SPEC's own reason for detection ('Detection is what makes none honest') would be unmet., Keep allow-and-warn forever and never revisit — rejected: SPEC 2.0 §6.7 is explicit that 3 of 6 rows in the table BLOCK; leaving all of them as allow-and-warn is not a partial implementation of the gate, it is a different (advisory-only) gate that never matches the table., Detect via a full per-ecosystem test-runner integration (pytest, cargo test, go test invocations) instead of filename/package.json heuristics — rejected as disproportionate: the block verdict for the 'nothing declared' rows does not depend on detection at all (only the wording does), so a lightweight heuristic is sufficient and the one row where detection DOES gate the verdict ('none') only needs to catch obvious contradictions, not certify absence.

**Implications:**
- Every repo with an already-installed push-trigger pre-push hook and no 'tests' key in .clud-bug.json will BLOCK on its next push once it runs 'clud-bug update' after this ships — clud-bug's own repo was exactly this case; fixed here by adding 'tests': 'npm test' to this repo's own .claude/skills/.clud-bug.json in the same PR.
- The bootstrap exemption (a push touching only .clud-bug.json is always allowed) is load-bearing: without it, the block itself would be unfixable by a normal PR once merged, since the pre-push hook reads the declaration from the base ref, not the branch being pushed.
- clud-bug update cannot prompt (runs unattended in the self-update Action) — it now returns 'advisories' the CLI prints as warnings instead, so an already-installed repo that never re-runs init is warned, not silently left to discover the block by having a push rejected.

---

