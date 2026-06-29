← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 13:06 - rc.17: fix the broken max-mode commit hook — type:agent → type:command (+ logmind log trigger + idempotency)

**Reasoning:** Dogfooding revealed clud-bug init --with-hooks NEVER worked for anyone: it scaffolded a Claude Code type:agent PostToolUse hook, but agent hooks get only Read/Grep/Glob (no Bash, not configurable, per the official docs), so the review subagent could never run the clud-bug CLI. Switch to type:command — the command runs review-prompt (which emits a recipe) and surfaces it via asyncRewake/exit-2 so the MAIN agent (Bash + the session subscription) performs the review. async + exit-0-on-failure so a commit is never blocked. Also fire on 'logmind log' (the thrillmade commit primitive — a git-commit pattern never matches its Bash call), and add a HEAD-SHA idempotency marker so a re-fire / amend-no-change doesn't re-review.

**Alternatives considered:** Headless 'claude -p' inside the hook — rejected: nests Claude (recursion/cost/auth), Keep type:agent + pass the diff in the prompt — rejected: agent hooks can't get the diff (no Bash/git)

**Implications:**
- New rc.17 (lockstep bump: package.json + 3 template strict-mode-gate pins + action.yml). isOurHook matches 'command' OR 'prompt' so clud-bug update replaces the old broken agent hook in place
- [CEO] publish the v0.7.0-rc.17 tag; then the auto-fire smoke in a real interactive Max session

---

## 2026-06-29 13:16 - rc.17 hardening (dogfood-found): #-comment marker + stdin gate vs if-less Claude Code

**Reasoning:** Dogfooding the rebuilt hook IN-SESSION caught two real issues. (1) The ': marker' line is sh-fragile — a paren/quote/dollar in the marker text breaks sh (a syntax error stalled the hook in my test). Switched to a '# comment' marker (sh -n validated; isOurHook still finds the marker). (2) The hook over-fired: Claude Code only honors the 'if' arg-gate on >=2.1.85; older CC ignores it and fires on EVERY Bash call — a review recipe after every command would make max mode unusable. Added a belt-and-suspenders stdin gate: command hooks receive the event JSON on stdin, so re-check it and exit 0 unless the command is git commit / logmind log; if stdin is empty (a CC that doesn't pipe it), fall through and trust 'if'. Verified a non-commit event (ls) now exits 0, gated out.

**Implications:**
- Both fixes ship in rc.17. The max-mode hook now fires only on commits regardless of CC version, and the marker can never break sh. This is exactly the value of dogfooding — running max mode on itself surfaced both.

---

## 2026-06-29 13:27 - rc.17 review fixes: correct --with-hooks help text + assert asyncRewake in the integration test

**Reasoning:** F1 adversarial review found two real gaps: (1) the --with-hooks --help text still described the old broken type:agent / 'subagent runs' behavior — corrected to type:command that fetches a recipe and surfaces it via asyncRewake (on git commit / logmind log); (2) the integration test asserted type/if/async/command but NOT asyncRewake — the field that actually surfaces the recipe (exit 2); without it the whole mechanism silently no-ops. Added asyncRewake assertions for both triggers. Review otherwise cleared shell-safety, idempotency, the stdin gate, the merge logic, and the version lockstep.

---

