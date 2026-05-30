## 2026-05-29 23:45 - feat(v0.6.27): Smart Budget Phase 3 — Layer 3 mid-review self-check-in

**Reasoning:** Adds the [budget] heartbeat rule to the system prompt. AI must emit a one-line budget heartbeat every 5 tool_uses showing files_reviewed=X/N, turns_used=Y/M, pace=ok|behind. When pace=behind, immediately pivot to one-sentence verdicts and cover every remaining file — silent skipping non-negotiable. Lands in action's streaming output for Layer 1 coefficient calibration. L5 auto-retry deferred to v0.6.28 because the workflow's job-dependency-graph restructuring is its own concern.

**Alternatives considered:** Bundle L3 + L5 in one release per original plan — rejected: user direction 'small changes over and over' + L5 has bigger surface (cross-job orchestration). L3 alone is a 5-second behavior addition with no schema or workflow changes.

**Implications:**
- Bumps to v0.6.27. strict-mode-gate composite pin v0.6.26→v0.6.27. byte-budget caps relaxed 16000→17500 + 340→365 (Layer 3 added ~600 bytes / ~26 lines). 312/312 tests pass. v0.6.27 propagation will be the FIRST cycle that requires zero admin-bypass on consumers — v0.6.26's 0.0.W² is live on consumer mains now, so the v0.6.27 propagation PR (mostly workflow + AGENTS.md changes) auto-skips clud-bug-review.

---
