← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 15:11 - H1: harden the max-mode review recipe to adversarial quality (refute + 3 lenses + ground + tiebreak)

**Reasoning:** The hardening audit found the multi-pass ENGINE is already wired into the local recipe, but the recipe's INSTRUCTIONS weren't adversarial — so clud-bug's own review missed things the ad-hoc adversarial reviewers caught (the goal is to RETIRE those). Rewrote review-prompt.ts recipe text: (1) the cross-check pass is now ADVERSARIAL — Wasp tries to REFUTE pass-1 findings, not just confirm; (2) the baseline skills are framed as three disciplined lenses (correctness/security/regression); (3) verify-and-ground discipline — every finding must quote the exact line + match the line number, else DROP it (default to silence over false positives); (4) the arbiter gets an explicit severity tiebreak. Engine untouched (planReview/multi-pass). New test locks the rigor for single + multi pass.

**Implications:**
- No version bump — batches into rc.19 with the rest of Phase H. The hardened recipe reaches the repos when rc.19 publishes + hooks re-pin (clud-bug update)

---

## 2026-06-29 15:22 - H1 review fixes: skill-agnostic lenses + correct the local arbiter-gate consequence

**Reasoning:** The adversarial review of H1 caught a real conceptual bug: the three lenses were 1:1-mapped to specific skills (Security=evidence-based-review — actually a cross-cutting evidence methodology, not a security-domain skill; Correctness=critical-issues-only — which also covers security+perf), and those names were hardcoded even though a repo may install different skills. Reframed the lenses as skill-AGNOSTIC domain categories, made 'quote the exact line' (evidence) + 'drop what fits no lens' cross-cutting, and said the installed skills (whatever they are) are the authority. Also fixed a contradiction: my tiebreak ('don't suppress') clashed with the pre-existing 'arbiter does not change which findings gate the merge' — that's the HOSTED engine's internal contract (resolveVerdict ignores the marker), but locally the agent IS the arbiter+renderer, so suppressing DOES change the gate. Replaced it with the real local consequence (upheld stays, false-positive dropped). Test asserts lenses reach multi-pass + the local wording.

**Implications:**
- Part of H1 (no version bump). The adversarial-review->fix loop is exactly the dogfood the plan wants

---

