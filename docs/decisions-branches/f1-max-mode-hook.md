← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 13:06 - rc.17: fix the broken max-mode commit hook — type:agent → type:command (+ logmind log trigger + idempotency)

**Reasoning:** Dogfooding revealed clud-bug init --with-hooks NEVER worked for anyone: it scaffolded a Claude Code type:agent PostToolUse hook, but agent hooks get only Read/Grep/Glob (no Bash, not configurable, per the official docs), so the review subagent could never run the clud-bug CLI. Switch to type:command — the command runs review-prompt (which emits a recipe) and surfaces it via asyncRewake/exit-2 so the MAIN agent (Bash + the session subscription) performs the review. async + exit-0-on-failure so a commit is never blocked. Also fire on 'logmind log' (the thrillmade commit primitive — a git-commit pattern never matches its Bash call), and add a HEAD-SHA idempotency marker so a re-fire / amend-no-change doesn't re-review.

**Alternatives considered:** Headless 'claude -p' inside the hook — rejected: nests Claude (recursion/cost/auth), Keep type:agent + pass the diff in the prompt — rejected: agent hooks can't get the diff (no Bash/git)

**Implications:**
- New rc.17 (lockstep bump: package.json + 3 template strict-mode-gate pins + action.yml). isOurHook matches 'command' OR 'prompt' so clud-bug update replaces the old broken agent hook in place
- [CEO] publish the v0.7.0-rc.17 tag; then the auto-fire smoke in a real interactive Max session

---

