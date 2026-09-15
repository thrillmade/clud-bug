← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 14:50 - Fix #291 + #305 + #301 item 1: the gate reads every instruction file from the PR base ref (CLAUDE.md @-imports to the CLI's documented depth, all launch roots, safe deletion), one skill byte cap owned by the library, strict-mode gate fails closed

**Reasoning:** SPEC 2.0 §6.3: a PR must not change the rules that judge it. #288 pinned skills to the base ref; the Action still loaded CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md and every @-imported instruction file from the PR's merge ref. The pin step now discovers the instruction graph from the base ref (inline @-imports too, fenced blocks and code spans stripped, paths normalised lexically,  refused only when it escapes the checkout, recursion to Claude Code's documented four hops), removes each workspace copy safely (realpath inside /private/tmp/claude-501/-Users-ludlow-code-thrillmade-clud-bug/fa95eb9c-9dde-4817-88f1-0993a1b459cb/scratchpad/wt-templates, .git denied unconditionally, rm -f on files only, symlinks as links, a failed delete never aborts the loop, the step declares bash) and restores base bytes; the SECURITY comment names the residuals truthfully (the workflow file itself on pull_request; nested CLAUDE.md elsewhere). #301/#305: MAX_SKILL_BYTES has one owner — the library default (8192) rendered into the templates; the reviewer reads SKILL.md only, documented; #301's items 2-3 (a total prompt budget; per-skill derived from it) remain open there. Defense in depth: .github/actions/strict-mode-gate/action.yml no longer turns a base-ref read failure into 'strict mode disabled' — the ref is resolved first (exit 1 if not), the manifest's presence is asked with git ls-tree (absent → opt-out notice, unreadable → error), and ci.yml now actually lints the composite action through a generated local-uses probe (it never had). Stale §1.10 citations moved to §2.1 (eight sites, two files). Five rounds of refute panels (the round-2 class-fix introduced rm -rf on PR-authored paths — caught and replaced); every guard mutation-proven in private copies; 59 files / 1288 tests green in the lane tree.

**Alternatives considered:** Pin AGENTS.md by name only (rejected: any @-imported file is the same class), Refuse every '..' import (rejected: a '..' that resolves inside the checkout is loaded by the CLI, so refusing it is fail-open), Three hops (rejected: Claude Code's documented resolver depth is four; matching it removes a residual)

**Implications:**
- Repos whose base CLAUDE.md imports files the PR rewrites are now reviewed against the base bytes; a PR-only import is removed for the review
- #331 (npx resolves the CLI from the PR workspace) and #332 (uncapped cat in allowedTools) are the next templates lane

---

