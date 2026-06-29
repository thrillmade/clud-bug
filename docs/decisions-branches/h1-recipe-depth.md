← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 15:11 - H1: harden the max-mode review recipe to adversarial quality (refute + 3 lenses + ground + tiebreak)

**Reasoning:** The hardening audit found the multi-pass ENGINE is already wired into the local recipe, but the recipe's INSTRUCTIONS weren't adversarial — so clud-bug's own review missed things the ad-hoc adversarial reviewers caught (the goal is to RETIRE those). Rewrote review-prompt.ts recipe text: (1) the cross-check pass is now ADVERSARIAL — Wasp tries to REFUTE pass-1 findings, not just confirm; (2) the baseline skills are framed as three disciplined lenses (correctness/security/regression); (3) verify-and-ground discipline — every finding must quote the exact line + match the line number, else DROP it (default to silence over false positives); (4) the arbiter gets an explicit severity tiebreak. Engine untouched (planReview/multi-pass). New test locks the rigor for single + multi pass.

**Implications:**
- No version bump — batches into rc.19 with the rest of Phase H. The hardened recipe reaches the repos when rc.19 publishes + hooks re-pin (clud-bug update)

---

