## 2026-05-31 13:52 - clud-bug v0.6.29: workflow post-step + update-skill-usage CLI (Component 4)

**Reasoning:** v0.6.28 shipped the dashboard + data layer with no data feeding it. v0.6.29 closes the loop by wiring the workflow to write per-review usage deltas + upload as artifacts (90d retention). Atomic write, idempotent, continue-on-error so usage-tracking flakes never fail a review.

**Alternatives considered:** Commit-back to main via gh api PUT (rejected: requires contents:write expansion → v0.6.23-style trigger-firing risk on private repos + race-handling complexity), Skip Component 4 entirely + ship v0.6.29 as CLI-only (rejected: false-promise dashboard message in v0.6.28 needs a fix; small CLI-only release wastes the version slot)

**Implications:**
- Workspace .clud-bug.json edits are ephemeral — only the artifact persists. v0.6.30 must add cross-review aggregation in clud-bug usage --health to actually read artifact stream + merge
- continue-on-error: true on both new steps — usage-tracking is non-critical telemetry; reviews must never fail because of it
- Artifact name uses PR# — re-uploads on PR sync overwrite prior artifact for that PR. Final usage delta wins per PR, which matches semantics (we want the post-review state, not intermediate)

---
