← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 16:26 - Fix 258: map dependabot secrets explicitly instead of secrets: inherit

**Reasoning:** `secrets: inherit` forwards the caller's secrets under THEIR OWN names, so the reusable workflow's kebab-case inputs (orchestrator-app-id, orchestrator-private-key, both required) were never populated and every Dependabot PR silently failed to auto-merge. Verified against the callee at pinned commit 6e1f9df — its own documented usage example is byte-identical to this mapping.

**Alternatives considered:** Keep secrets: inherit and rename the callee's inputs to SCREAMING_CASE — rejected: clud-bug is the only caller of four using inherit; logmind, agent-skills and reporulez already map explicitly, so changing the shared callee would break three working callers to accommodate one broken one

**Implications:**
- Dependabot PRs auto-merge again, which removes a human from every dependency merge across repos (named as a friction in protocol#83)

---

