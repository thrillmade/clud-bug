← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 11:44 - Phase R2-hosted: expand the hosted bot's grounding to named-invariant reasoning (no execution) — #87 across both modes

**Reasoning:** R2 hardened the LOCAL recipe (agent has a shell → reproduction grounding). The hosted bot (clud-bug-app, serverless) has only the patch + no runnable checkout, so it CANNOT reproduce — but it can still catch a no-single-line bug by REASONING a named violated invariant from the diff. Expand Rule 2 in both hosted system prompts (main review + cross-check/consensus): ground in file+line OR a named violated invariant (emergent/combinatorial/cross-cutting), reason it from the patch, name the cross-package file:symbol, don't drop a real defect or soft-pedal a well-reasoned critical just because it maps to no single line. Explicitly 'you cannot execute here' — so no reproduction path, no RCE surface (the R2 panel's critical finding does not apply).

**Alternatives considered:** Mirror R2's reproduction grounding verbatim (rejected: serverless has no shell/checkout — telling it to 'run a reproduction' is both impossible and, for untrusted PRs, the exact RCE the panel flagged)

**Implications:**
- The Action's sandboxed CI job (R6) is where hosted-path probes actually execute; the app bumps to rc.22 to pick this up + the unverified handler

---

