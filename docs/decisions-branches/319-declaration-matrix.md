← back to [docs/timeline.md](../timeline.md)

## 2026-08-24 14:07 - Block a push on a missing or dishonest §6.7 test-suite declaration, with suite detection and an init-time ask step

**Reasoning:** SPEC 2.0 §6.7's declaration matrix has 3 of 6 rows BLOCK (missing declaration, or 'none' contradicted by a detected suite) and #276 shipped only the allow-and-report half, deliberately, to avoid wedging existing installs before a setup flow existed to collect the declaration. This PR builds that setup flow (clud-bug init detects a package.json test script and asks, per 'Setup MUST ask, and MUST NOT complete without an answer') and the detector the block path needs to tell 'none' from a lie ('Detection is what makes none honest'), so the block can ship safely.

**Alternatives considered:** Block unconditionally on any missing declaration, no detection at all — rejected: cannot distinguish an honest 'none' from a lie, and the SPEC's own reason for detection ('Detection is what makes none honest') would be unmet., Keep allow-and-warn forever and never revisit — rejected: SPEC 2.0 §6.7 is explicit that 3 of 6 rows in the table BLOCK; leaving all of them as allow-and-warn is not a partial implementation of the gate, it is a different (advisory-only) gate that never matches the table., Detect via a full per-ecosystem test-runner integration (pytest, cargo test, go test invocations) instead of filename/package.json heuristics — rejected as disproportionate: the block verdict for the 'nothing declared' rows does not depend on detection at all (only the wording does), so a lightweight heuristic is sufficient and the one row where detection DOES gate the verdict ('none') only needs to catch obvious contradictions, not certify absence.

**Implications:**
- Every repo with an already-installed push-trigger pre-push hook and no 'tests' key in .clud-bug.json will BLOCK on its next push once it runs 'clud-bug update' after this ships — clud-bug's own repo was exactly this case; fixed here by adding 'tests': 'npm test' to this repo's own .claude/skills/.clud-bug.json in the same PR.
- The bootstrap exemption (a push touching only .clud-bug.json is always allowed) is load-bearing: without it, the block itself would be unfixable by a normal PR once merged, since the pre-push hook reads the declaration from the base ref, not the branch being pushed.
- clud-bug update cannot prompt (runs unattended in the self-update Action) — it now returns 'advisories' the CLI prints as warnings instead, so an already-installed repo that never re-runs init is warned, not silently left to discover the block by having a push rejected.

---

## 2026-08-24 14:56 - PR #321 panel fixes: node-infra fail-open in the §6.7 gate, and an honest accept-all "none"

**Reasoning:** A review panel on #319/#321 found both node-parse call sites in the pre-push hook could not tell a broken/missing node from a legitimately absent declaration (SPEC 6.7: "a broken binary MUST NOT be able to wedge a push" — but it did, misread as "nothing declared" and blocked), and that clud-bug init --accept-all with nothing detected left the manifest undeclared entirely, so the very push that hook installs would go on to block itself (SPEC 6.7: "Setup MUST ask, and MUST NOT complete without an answer"). Both states are now unrepresentable rather than merely avoided: a nodeerror flag forces fail-open before any declaration/exemption branch runs, and the resolveTestsDeclaration accept-all branch always returns a real value ("none" is the honest cell for "no suite detected", per the table). Also widened the bootstrap exemption file allowlist (a real init --hook-trigger both bootstrap writes .claude/settings.json too, not just .clud-bug.json, in the same commit) and replaced a stale SPEC line-number citation in the PR description with the section anchor SPEC.md already uses to reference itself.

**Alternatives considered:** For the node failure: keep the "|| var=" fallback and only check for emptiness — rejected: cannot distinguish a legitimately empty field from node failing to run at all, which is the actual bug., For accept-all-undeclared: leave the null-skips-the-write branch in main.ts and just improve the warning text — rejected: the manifest would still be undeclared and the freshly-installed hook would still block the very next push; the trap is the bug, not the wording., For the bootstrap exemption: widen to all of .claude/ broadly — rejected: would let unrelated skill/workflow content ride along under cover of a declaration fix, defeating the anti-smuggling test #319 already shipped.

**Implications:**
- A broken/missing node now allows the push with a distinct "could not read the tests declaration" message instead of blocking; revert-proofed by removing just the new nodeerror verdict branch (2 tests fail in test/pre-push-hook.test.js), restoring passes them again.
- TestsDeclarationResult.value is now typed string, never null — the dead null-branch in main.ts is gone, so the undeclared state is unrepresentable in the type, not just avoided by convention; revert-proofed across hooks.ts + main.ts together (4 tests fail across two files), restoring passes all 4 again.
- The bootstrap exemption allowlist is a fixed 2 files (.claude/skills/.clud-bug.json, .claude/settings.json), not a directory prefix — an unrelated file anywhere in the diff, including elsewhere under .claude/, still blocks.
- npm test now 55 files / 1224 tests (6 new); npm run build and test:fixtures still clean. The PR #321 description was updated to match: the citation fix plus the two behavior bullets the code now supersedes, and a Panel follow-up addendum.

---

