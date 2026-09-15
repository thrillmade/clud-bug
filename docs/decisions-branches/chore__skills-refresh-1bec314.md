← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 09:57 - Refresh the four bundled baseline skills from agent-skills@1bec314 (folds PRs #308 #309 #310 #311)

**Reasoning:** The upstream sync workflow opened one PR per skill against main. dev is the working branch and the repo is squash-only, so the four are combined into one dev-targeted change: each bundled SKILL.md verified byte-identical (shasum) to skills/<name>/SKILL.md at agent-skills 1bec314, BASELINE_SKILLS_REF bumped 2dc8360 → 1bec314 so install-time fetch and the offline fallback resolve identically. docs/file-structure.md kept as dev's: the tree shape is unchanged and the PRs' regens were computed against main's tree.

**Alternatives considered:** Retarget and merge the four PRs one by one (rejected: identical pin edits plus four CHANGELOG insertions at the same spot conflict after the first merge — four CI cycles for one change)

**Implications:**
- Close #302 (older a144454 refresh of clud-bug-collaboration, superseded) and #308–#311 once this merges

---

