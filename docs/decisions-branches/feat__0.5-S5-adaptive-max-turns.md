## 2026-05-29 14:48 - 0.5 §5: adaptive --max-turns based on PR scope (clud-bug v0.6.23)

**Reasoning:** Tokenomics PR #18 (docs rebrand, 23 files + 6 prior claude[bot] threads) exhausted --max-turns 15 under v0.6.12 AND again under v0.6.22's structured-output flow. Even Phase 0.5 efficiency doesn't help when the bottleneck is FIX-PUSH FLOW enumerating prior threads — each thread costs 1-2 turns regardless. paths-check job (introduced in 0.0.W) now also computes a turn-budget hint forwarded to claude-code-action. 4 buckets: trivial=10 (Haiku), standard=15 (<10 files AND <3 threads), larger=25 (≥10 files OR ≥3 threads), very-large=40 (≥30 files OR ≥6 threads). Computed from gh pr diff --name-only + gh api graphql for unresolved claude-bot thread count. Best-effort: GraphQL failures default to 0. Workflow emits ::notice per run showing the budget + driving inputs. Plus actions: read permission on paths-check enables github_ci MCP server (was being skipped with a noisy warning). All 3 templates updated. Test pinned at test/prompts.test.js asserts adaptive value + all 4 buckets + actions: read permission. 300/300 pass.

**Alternatives considered:** Make max-turns configurable via workflow env var instead of paths-check. Rejected: workflow-level customization is opt-in and rarely happens; the scope-based heuristic should auto-apply correctly for the common case without manual override., Auto-chunk FIX-PUSH FLOW on high-thread PRs (resolve threads in batches across multiple review runs). Rejected: adds complexity (need to persist 'which threads have been checked' across runs); raising the cap is the simpler first step. Defer chunking to v0.6.24 if v0.6.23's cap proves insufficient., Pass max_turns via env var instead of needs.<job>.outputs (cleaner separation). Rejected: needs.<job>.outputs is the standard GH Actions pattern for cross-job data flow and matches how is_workflow_only/model already work.

**Implications:**
- Composite-pin lock-step v0.6.22 → v0.6.23 across all 3 templates + strict-mode-gate/action.yml header. After merge: tag v0.6.23, npm publish. Then propagate to tokenomics (priority — unblocks PR #18) and the other 3 consumers. Their NEXT propagation PR will be workflow-only → 0.0.W skip fires → no admin-bypass needed.
- Workflow self-modification guard fires once on THIS PR (clud-bug's own workflow file changes). Documented per-PR-checklist structural exception.

---
## 2026-05-29 14:49 - fix(0.5 §5): quote $REPO in adaptive max-turns shell (SC2086)

**Reasoning:** actionlint caught unquoted $REPO in two cut invocations inside the gh api graphql query: 'echo $REPO | cut -d/ -f1' and 'echo $REPO | cut -d/ -f2'. shellcheck SC2086 (double quote to prevent globbing and word splitting). Applied 'echo "$REPO" | cut -d/' fix in all 3 templates. 300/300 tests still pass.

---
