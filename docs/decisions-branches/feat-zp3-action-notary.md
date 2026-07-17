← back to [docs/timeline.md](../timeline.md)

## 2026-07-17 08:52 - ZP3: route the self-hosted GitHub Action through the notary (build-bundle + base-ref-guarded CI notarize step + init installs both surfaces)

**Reasoning:** Local max mode already notarizes (ZP2); the self-hosted Action posted only a self-attested check, so the un-forgeable notary gate never covered the Action path. build-bundle transforms the review's structured_output into a NotaryBundle (verdict derived from critical count to satisfy validateConsistency; coverage from GitHub's ground-truth gh pr diff --name-only) and post-check-run --bundle --source ci submits it. Grounding is now mandated on CI criticals because validateGrounding rejects a bare critical and would notary-reject the whole bundle. init installs both surfaces (hook + Action) by default so a fresh repo gets max-mode review AND the CI enforcer.

**Alternatives considered:** Leave the Action self-attested (rejected: leaves the Action path outside the notary trust boundary ZP2 established for local mode). Derive strictMode from the PR head (rejected: a PR could set strictMode:false/notary:false in its own head to defang the gate — must read from the base ref like strict-mode-gate). Make the notarize step gate the job (rejected: strict-mode-gate is the authoritative backstop; continue-on-error avoids double-gating so a notary outage can't turn a clean review red).

**Implications:**
- Prompt byte/line caps bumped (17500->18700, 365->385) for the ~1.5KB grounding block. init default flip is a behavior change (added --no-hooks opt-out; updated tests). CODEOWNERS + the ::warning:: annotation on notary rejection are deferred to a follow-up.

---

