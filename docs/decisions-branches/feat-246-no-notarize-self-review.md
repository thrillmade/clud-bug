← back to [docs/timeline.md](../timeline.md)

## 2026-07-26 21:09 - Delete the §2b trusted-context fold-in from the local review recipe; replace with diff-only, refute-first framing (clud-bug#246 safe half)

**Reasoning:** CEO ruling #246 (scope-corrected): we don't forbid self-review, we stop shipping a recipe that instructs the author to review themselves. The §2b fold-in ('you already know about it... that context is yours and trusted') is the mechanism that made the author the reviewer — dogfooding measured local self-review as clean on ~5/5 commits while an independent panel on the same commits found real criticals (#228).

**Alternatives considered:** Demote the local tier to advisory everywhere (rejected — out of scope per Ruling 4: changes what a required check means, SPEC §7 forbids requiring a check nothing produces; must sequence with the org gate restore, not before it), Dispatch a structurally independent fresh subagent for local review (rejected for this slice — larger change, tracked separately in #246 item 2; this commit only removes the fold-in instruction itself)

**Implications:**
- The local recipe's §2b section now instructs a fresh, skeptical, diff-only read and explicitly forbids folding in session memory of intent/discussion; the trusted .clud-bug.json standing-focus channel and the untrusted PR marker channel are unchanged.
- test/review-context.test.js's H2 §2b assertion (previously pinned the old fold-in text as expected behavior) is updated to assert its absence — this is the deliberate behavior change the ruling requires, not test-weakening.

---

