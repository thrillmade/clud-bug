← back to [docs/timeline.md](../timeline.md)

## 2026-07-25 16:21 - chore: bump to 0.7.0-rc.26 (publishes ZP4 verdict parity, #239/#240 hook coverage, §17 citations)

**Reasoning:** Everything merged after rc.25 is invisible to consumers until published — the exact gap rc.25 existed to close, which reopens on every merge. rc.26 ships three false-green fixes (the hosted check never consulted the critical count; worktree commits escaped review entirely; a limit-killed review looked completed) plus the §17 usage[] emission a downstream lane was idling on. Release discipline requires the strict-mode-gate composite pin in 3 templates + action.yml to move lock-step with package.json, so those bump together and the .ci-rendered goldens regenerate.

**Alternatives considered:** Wait and batch more work into one rc (rejected: consumers including our own dogfood float @next, so unpublished fixes are simply not in effect — the ZP4 false-green in particular is a live correctness issue)

**Implications:**
- BEHAVIOR CHANGE on publish: strict-mode repos will see clud-bug-review FAIL on criticals where it previously passed — correct, but visible, and it will block PRs that used to merge
- After merge, tag v0.7.0-rc.26 triggers OIDC publish -> dist-tag next; then clud-bug update our repos

---

