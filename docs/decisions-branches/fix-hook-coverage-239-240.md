← back to [docs/timeline.md](../timeline.md)

## 2026-07-25 15:11 - Fix commit-review hook coverage holes: worktree commits, --no-verify, over-firing (#240) and dead-review markers (#239)

**Reasoning:** clud-bug's central claim is 'every commit gets reviewed'; three #240 vectors and two #239 gaps made it provably false — worktree commits never fired the hook (git-dir is worktree-private), --no-verify silently bypassed mandated hooks with no flag, a text-substring belt-and-suspenders match over-fired on read-only commands (gh issue view, git log), and a marker written BEFORE the review ran made a usage-limit-killed session indistinguishable from a completed review with no way to drain it

**Alternatives considered:** hard-deny --no-verify commits outright (rejected: strands a legitimate rebase/amend flow; ruling calls for flag-not-deny), keep firing on command-text substring match, just narrow the pattern (rejected: still reasons about text instead of git state, the demonstrated root cause of the over-fire), seed the HEAD-moved baseline purely at first-hook-fire with no reflog check (rejected: a brand-new worktree's first commit would hit the same cold-start gap vector 1 complains about)

**Implications:**
- the hook script now shells out to git rev-parse --git-common-dir (shared review-state: fired/done/pending) and --git-dir + git reflog (worktree-local HEAD-moved gate) instead of matching command text; review-prompt gained --flag-no-verify + repoHasMandatedHooks (.logmind/ or AGENTS.md mentioning 'hook'); two new CLI verbs (review-done, review --pending) are now part of the completion contract the recipe instructs agents to follow; clud-bug init --with-hooks seeds .git/clud-bug-last-seen-head at install time to close the primary-checkout cold-start window; .claude/settings.json regenerated via clud-bug update to match the new hook output

---

