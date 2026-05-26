## 2026-05-26 12:14 - Self-mod ceremony: bump this repo from @v0.5.10 (KNOWN-BROKEN) to @v0.5.12 composite

**Reasoning:** PR #61 fixed both strict-mode-gate and BB.3 per-skill check-runs body-start matching bugs. v0.5.12 shipped to npm. This repo own clud-bug-review.yml still pointed at @v0.5.10 since PR #58 last refresh — meaning every PR opened against main since #60 was reviewed by the KNOWN-BROKEN gate. Per-skill check-runs never emitted; strict mode silently passed. Running clud-bug update from the now-current 0.5.12 CLI refreshes the workflow to v6 templates with @v0.5.12 composite and @v1.0.133 CCA pin — exercising both v0.5.11 ({{CCA_VERSION}}) and v0.5.12 (gate + BB.3 fix) end-to-end on this repo own PRs.

**Alternatives considered:** Wait for the Monday cron self-update PR. Rejected: defers the dogfood validation by up to a week. The fix exists in npm latest; this repo should be on it immediately to actually exercise the gate + check-runs in production.

**Implications:**
- First PR after merge will be the real dogfood test — bot should emit a "## 🐛 Clud Bug review" header that the gate correctly reads via selectReviewHeader, AND the 4 per-skill check-runs (critical-issues-only, evidence-based-review, respect-existing-conventions, clud-bug-collaboration) should actually appear in the PR check list via selectReviewBody. If either is silent, the v0.5.12 fix is incomplete. Expects 401 self-mod guard on THIS PR (claude-code-action refuses PRs that edit its own workflow file); merge with admin bypass already set up on the reporulez-default ruleset.

---
