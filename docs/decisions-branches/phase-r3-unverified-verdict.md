← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 11:39 - Phase R3: add the 'unverified' review verdict — no 'clean' without verification on an invariant-touching change

**Reasoning:** R2's severity rule already leans on this: when a MAJOR can't be reproduced (an untrusted diff the reviewer must not execute) or a probe didn't run, the outcome must NOT be a false-green 'clean'. Add 'unverified' to ReviewVerdict + deriveCheck (→ neutral: never success/false-green, never a hard block/outage on our own inability to verify) + normalizeVerdict + the recipe's post-check-run --verdict options + guidance ('do NOT post clean on an invariant-touching change you did not verify'). unverified defers to the sandboxed CI/Action probe (R6), which resolves it to clean or critical. Mirrors the existing 'failed → neutral' precedent (add signal, not outages).

**Alternatives considered:** unverified → failure/blocking in strict mode (rejected: could deadlock when no local probe + no CI yet; the authoritative gate is the CI probe check, which waits on branch protection — unverified is the transient defer-to-CI signal), Reuse 'failed' for unverified (rejected: 'failed' means the review couldn't RUN; 'unverified' means it ran but couldn't confirm an invariant surface — distinct signals)

**Implications:**
- R6 wires the sandboxed CI/Action probe that turns unverified → clean/critical; the hosted prompt-builder gets a no-shell grounding adaptation next

---

