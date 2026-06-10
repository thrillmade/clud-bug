← back to [docs/timeline.md](../timeline.md)

## 2026-06-10 10:37 - v0.7.0-rc.3: port selectReviewEvent into core w/ author_association + diff-findings + writeback extensions + workflow post-step

**Reasoning:** Phase 7 PR A closes SPEC §1.8.1 + §7.2.1 + §6.7.3 conformance gaps in clud-bug core so clud-bug-app (PR B) can consume via dep bump + npm workflow inherits via new template post-step. Without (1) auto-approves drive-by external PRs (security bug), (2) misses Resolved/Still-open blocks, (3) misses cache comment, (4) workflow path never satisfies required_approving_review_count: 1 floor.

**Alternatives considered:** Keep selectReviewEvent in clud-bug-app only (rejected: workflow path inherits nothing), Skip author_association gate (rejected: drive-by exploit of auto-merge), Server-side gate in App only (rejected: workflow consumers still uncovered)

**Implications:**
- clud-bug-app must bump dep + pass author_association in Phase 7 PR B
- Renderer input shape grows by 3 optional fields (back-compat)
- Template post-step runs Node inline reading clud-bug/core import; needs install step
- All 3 workflow templates + action.yml header bump to v0.7.0-rc.3

---

