## 2026-05-28 09:32 - v0.6.10: incremental-diff review on fix-push (Phase 0.A.10 — HIGH-VALUE)

**Reasoning:** Highest-value Phase A follow-up per plan. On fix-push re-review, clud-bug fetches only the delta since its prior pass instead of the full PR diff. State lives in prior summary comment as <!-- last-reviewed-sha: <sha> --> HTML marker. Prompt now teaches Claude: (1) grep prior claude[bot] comments for the marker; (2) verify ancestry via git merge-base --is-ancestor (catches force-push/rebase); (3) branch — marker+ancestor → git diff <sha>..HEAD | head -c MAX_DIFF_BYTES; otherwise → gh pr diff full. Marker emission instruction added — every summary comment ends with <!-- last-reviewed-sha:  -->. Workflow templates: HEAD_SHA env var, Bash(git diff:*) + Bash(git merge-base:*) added to allowedTools. v0.6.9 intentionally skipped — reserved for 0.A.8 model-pin spike. Composite pin bumped v0.6.8 → v0.6.10. Existing strict-mode-gate composite-pin test refactored to read package.json (no drift past version bumps). +4 new tests = 207 pass.

**Implications:**
- Estimated savings: 4-push PR (10KB initial + 3×1KB fix-pushes) drops from ~40KB across 4 reviews to ~13KB (~67% diff-section reduction). Larger churny PRs save proportionally more. Edge case: span checks (delta finding might affect unchanged code) — prompt instructs Claude to do a one-time full gh pr diff to verify before flagging.

---
## 2026-05-28 09:54 - PR #100 fix: anchor prior-summary detection to ## 🐛 Clud Bug review header (not LAST claude[bot] body)

**Reasoning:** clud-bug-review caught a real bug on PR #100: claude-code-action posts a [claude]: Claude Code is working… progress comment BEFORE the SDK runs. Telling Claude to find the marker in the LAST claude[bot] body would always hit that progress comment (no marker present), fall through to step 3's 'marker missing' branch, and trigger a full gh pr diff on every fix-push. The headline ~67% savings would never fire. Fix: prompt now instructs Claude to walk claude[bot] comments newest-first and select the FIRST whose body starts with ## 🐛 Clud Bug review (same anchor strict-mode gate uses via selectReviewHeader). Same hazard, same solution as PR #61's BB.3 fix. +2 tests: regression guard asserts the header-anchored selection + explicit progress-comment warning; ordering test asserts sort=created&direction=desc query params + newest-first instruction. 209 tests pass.

**Implications:**
- Tests are still substring-based (prompt is a string, not executable). The clud-bug 🟡 finding about a fixture-based test is valid future work — a Node test that constructs a 2-comment array (progress + summary) and asserts Claude's instructions unambiguously route to the summary would catch behavioral bugs. Out of scope for this fix; tracking as plan note.

---
