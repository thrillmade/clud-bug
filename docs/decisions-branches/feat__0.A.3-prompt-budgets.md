## 2026-05-27 22:13 - Add per-section byte budgets to clud-bug's review prompt + workflow env vars

**Reasoning:** Phase A.3 — caps the variable per-PR suffix (diff, comments, skills) that isn't covered by the v0.6.3 caching of the stable prefix. Defaults: 80KB diff, 20KB comments, 4KB per skill. Env-overridable per-repo. Soft enforcement via prompt instructions + Bash(head:*) allowedTool; hard enforcement deferred to Phase 1 RTK rollout.

**Alternatives considered:** Hard allowlist patterns (reject unbounded gh pr diff), Pre-fetch in workflow run: steps with size caps

**Implications:**
- Default 80KB diff covers ~95% of PRs per spike measurement; consumers can raise via MAX_DIFF_BYTES env var
- Bash(head:*) added to allowedTools — small attack surface expansion, mitigated by prompt scope
- Builds on 0.A.2 caching: prompt-level instructions ship in the cached prefix at 10% cost

---
