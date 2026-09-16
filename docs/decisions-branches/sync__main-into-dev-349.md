← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 20:26 - Sync main into dev after #349: self-update failure notification

**Reasoning:** Same squash-only shape as #347: main re-presents dev content as 27 conflicts, all resolved to dev; main contributed the notify-on-failure step and its CHANGELOG line, which was re-inserted under Unreleased by hand because both sides had changed the file. The multi-pass docs page auto-merged main stale sentence again and was forced back to the #341 wording.

**Alternatives considered:** Cut the promotion PR without syncing and resolve the workflow file there instead

**Implications:**
- The promotion PR now carries only dev-side changes
- Every merge to main needs this sync until the branches share an ancestor

---

