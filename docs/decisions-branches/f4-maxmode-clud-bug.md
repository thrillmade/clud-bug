← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 14:21 - max mode: init --local-only — /clud-bug-review slash command + commit hook (F4 rollout)

**Reasoning:** rc.18 is published; rolling max mode (the local Claude-subscription review path) to the thrillmade repos via 'clud-bug init --local-only' — installs the /clud-bug-review slash command + the type:command commit hook, and writes NO GitHub Action (no ANTHROPIC_API_KEY). Verified: adds .claude/commands + .claude/settings.json, refreshes the manifest stamp + AGENTS.md, writes zero workflow files, drops no skills.

**Implications:**
- F4 rollout — each repo gets the same install as a reviewed PR. logmind excluded (active shape-up); clud-bug-test keeps its Action fixture

---

