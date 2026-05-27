## 2026-05-27 06:11 - fix(baseline-review): skip claude-code-review job for Dependabot PRs

**Reasoning:** Org-level ANTHROPIC_API_KEY (Actions scope) doesn't propagate to Dependabot's secret scope, so the baseline claude-review guard fails on every Dependabot PR (#78-82 all hit this). Baseline review on a dep bump is also pure noise — no code logic to review. Job-level if: github.actor != 'dependabot[bot]' skips the whole job (no red mark, no CI minutes burned).

**Alternatives considered:** Add API key as a Dependabot org secret — works but baseline review on dep bumps is still noise, Patch the existing guard step to silently exit 0 on dependabot[bot] actor — works but still spins up the job and runner for nothing

**Implications:**
- Self-mod ceremony required: this PR edits claude-code-review.yml which IS the workflow that claude-code-action runs in, so Anthropic's action will refuse to run on this PR (401 self-mod block). Admin-bypass merge needed. After merge, Dependabot PRs will show no claude-review check at all (job skipped, not failed).

---
