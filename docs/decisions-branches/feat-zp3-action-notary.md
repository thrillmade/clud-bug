← back to [docs/timeline.md](../timeline.md)

## 2026-07-17 08:52 - ZP3: route the self-hosted GitHub Action through the notary (build-bundle + base-ref-guarded CI notarize step + init installs both surfaces)

**Reasoning:** Local max mode already notarizes (ZP2); the self-hosted Action posted only a self-attested check, so the un-forgeable notary gate never covered the Action path. build-bundle transforms the review's structured_output into a NotaryBundle (verdict derived from critical count to satisfy validateConsistency; coverage from GitHub's ground-truth gh pr diff --name-only) and post-check-run --bundle --source ci submits it. Grounding is now mandated on CI criticals because validateGrounding rejects a bare critical and would notary-reject the whole bundle. init installs both surfaces (hook + Action) by default so a fresh repo gets max-mode review AND the CI enforcer.

**Alternatives considered:** Leave the Action self-attested (rejected: leaves the Action path outside the notary trust boundary ZP2 established for local mode). Derive strictMode from the PR head (rejected: a PR could set strictMode:false/notary:false in its own head to defang the gate — must read from the base ref like strict-mode-gate). Make the notarize step gate the job (rejected: strict-mode-gate is the authoritative backstop; continue-on-error avoids double-gating so a notary outage can't turn a clean review red).

**Implications:**
- Prompt byte/line caps bumped (17500->18700, 365->385) for the ~1.5KB grounding block. init default flip is a behavior change (added --no-hooks opt-out; updated tests). CODEOWNERS + the ::warning:: annotation on notary rejection are deferred to a follow-up.

---

## 2026-07-17 09:22 - ZP3 fix (critical): base-ref-guard the notary toggle — a PR could self-disable independent certification from its own HEAD

**Reasoning:** Adversarial review (opus, triangulated with an orchestrator spot-check) confirmed: the CI Notarize step base-ref-guarded strictMode but NOT the notary toggle — post-check-run resolved 'notary' from readManifest(cwd) (the PR HEAD working tree), so a PR setting notary:false in its own .clud-bug.json skipped /notarize entirely and self-attested a non-blocking neutral check, defeating the notary layer ZP3 adds. Fix mirrors --strict/--no-strict exactly: an explicit --notary/--no-notary flag OVERRIDES the manifest (readNotaryConfig(manifest, override)); the workflow derives NOTARY_FLAG from the BASE ref alongside STRICT_FLAG. Also guards build-bundle against a null/non-object finding entry (adversarial review reproduced a crash), and the workflow comment's '(or disable the notary)' claim is now actually TRUE.

**Alternatives considered:** Change readNotaryConfig precedence so env overrides the manifest opt-out (rejected: breaks the intended LOCAL hard-opt-out semantics; the explicit flag is cleaner and mirrors --strict)

**Implications:**
- Local (non-CI) behavior UNCHANGED — the manifest notary opt-out is only overridden by the explicit flag CI passes from the base ref
- +4 tests (override precedence x3 + build-bundle null-guard); 1009 pass, fixtures 5/5, actionlint clean
- Pulls the notary half of ZP4 (base-ref parity) into ZP3 where it belongs

---

