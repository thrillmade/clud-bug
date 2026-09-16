← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 19:48 - logmind-self-update.yml notifies on failure (#333)

**Reasoning:** Six weeks of red on the scheduled self-update went unnoticed because nothing reported it. Ported the Notify on failure step agent-skills already runs: if failure(), dedupes on an HTML-comment marker through gh issue list --search, comments on the existing open issue instead of filing weekly, and filters candidates to github-actions-authored issues so an outsider cannot redirect the notices onto an issue they control. permissions gains exactly issues: write.

**Alternatives considered:** Slack or email notification (rejected: no secret exists and issues are where this repo already tracks work), A fresh issue on every failure (rejected: one issue per failure streak)

**Implications:**
- Targets main directly because scheduled workflows run from the default branch
- dev picks the change up on the next main-to-dev sync

---

