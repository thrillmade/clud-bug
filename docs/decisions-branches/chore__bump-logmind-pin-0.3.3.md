## 2026-05-27 07:10 - chore: bump logmind pin 0.3.1 → 0.3.3

**Reasoning:** v0.3.3 specifically fixes the post-merge hook re-staging bug. Bumping the workflow pin lets CI regenerate the timestamp-less file-structure.md on the next push

**Implications:**
- logmind init already updated the marker; this PR just commits + ships

---
