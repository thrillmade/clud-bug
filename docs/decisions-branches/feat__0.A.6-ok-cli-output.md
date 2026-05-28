## 2026-05-27 22:50 - Add --quiet / CLUD_BUG_QUIET=1 mode to clud-bug CLI with RTK-style single-line ok output

**Reasoning:** Phase A.6 — agents invoking clud-bug init/update/add/refresh/edit-workflow ingest 5-50 lines of progress chatter today. --quiet suppresses chatter, emits exactly one ok <key-value> line per command. Errors and warnings still print on stderr. Env var route (CLUD_BUG_QUIET=1) recommended for agents — set once per session.

**Alternatives considered:** Total silence on success (loses positive confirmation), Always emit ok regardless of flag (clutters interactive output)

**Implications:**
- ok line ALWAYS prints (positive confirmation chainable on commit-SHA/branch/file-count) regardless of quiet state
- AGENTS.md block updated to mention CLUD_BUG_QUIET=1 hint — agents discover at session boot
- Closes Phase A clud-bug code PRs; ceremony PR + propagation next

---
