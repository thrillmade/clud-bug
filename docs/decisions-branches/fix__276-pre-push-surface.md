← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:45 - Fix #276: build the pre-push local review surface SPEC 2.0 makes the default trigger

**Reasoning:** git grep -inE 'pre-push|prePush|pre_push' origin/main -- src/ templates/ returned 0 hits (control probe PostToolUse -> 2 files, so the search worked) while SPEC 2.0 §4.1 says 'A reviewer MUST support both, and push is the default' and §6.7 names the mechanism ('Git allows one pre-push hook, so ownership follows what is installed'). init now writes a git pre-push hook in §6.7's fixed order: chained foreign hook first (stdin replayed, verdict honoured), then the declared test command read from the DEFAULT BRANCH through a real JSON parser (a failure blocks and the model does not run), then the review directive naming the exact range. Also fixes a live §4.3 violation: --trigger push fell through to the PR recipe, which tells the agent to post a comment

**Alternatives considered:** A Claude Code PreToolUse hook on Bash(git push *) — rejected: §6.7 names 'pre-push' by name, a settings.json hook never fires for a terminal push, and a git hook already reaches the agent because git push is a Bash tool call whose stderr lands in the tool result. Fetching the recipe inside the hook like the commit hook does — rejected: Claude Code runs the commit hook detached (async: true, asyncRewake: true), git offers no equivalent, so a hung registry call would stall the very command §4.1 says must not be blocked; the hook prints the command instead and does zero network I/O

**Implications:**
- init --with-hooks now defaults to the pre-push surface instead of the commit hook (--hook-trigger commit|both restores/adds it), and bare review-prompt defaults to --trigger push. NOT BUILT, deliberately: the rest of §6.7's declaration matrix — suite detection, 'Setup MUST ask and MUST NOT complete without an answer', and the three rows that BLOCK on a missing/contradicted declaration. Shipping block-on-missing before the setup flow that collects the declaration would wedge every repo that upgrades, so a missing declaration allows and REPORTS (§6.5) instead

---

