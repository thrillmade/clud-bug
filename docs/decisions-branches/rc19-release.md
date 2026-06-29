← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 16:12 - rc.19: batch Phase H max-mode hardening (H1-H4)

**Reasoning:** Ships the hardened max mode to npm so the 7 repos' hooks can re-pin to it. rc.19 batches: H1 (adversarial recipe depth — refute/3-lenses/verify/tiebreak), H2 (contextual review instructions + the anti-injection fence), H3 (the post-check-run merge-gate verb + the local self-attested clud-bug-review check), H4 (hook retry + diagnostic skip marker). Lockstep bump: package.json + 3 workflow templates + the strict-mode-gate action.

**Implications:**
- [CEO] publish v0.7.0-rc.19 -> next; then re-pin the 7 max-mode repos (clud-bug update refreshes the hook's npx pin). The hardened recipe + merge-gate reach users after the re-pin

---

