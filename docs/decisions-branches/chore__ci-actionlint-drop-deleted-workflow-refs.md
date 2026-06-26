← back to [docs/timeline.md](../timeline.md)

## 2026-06-25 19:46 - Unblock main CI: drop stale workflow references from actionlint job + relative timestamp in usage fixture

**Reasoning:** Two independent CI failures had silently accumulated on main. (1) ci.yml's actionlint job still hardcoded clud-bug-review.yml + claude-code-review.yml in its lint list 8 days after PR #170 deleted those workflows; under `set -e`, `[ -f missing-file ]` returns 1 and fails the script. (2) test/usage.test.js fixture's hardcoded createdAt '2026-05-25T00:00:00Z' drifted out of the rollup's 30-day current window as the calendar advanced, inverting the 'no prior window' test semantics. Each alone blocks every PR; both must land before the 3 open dependabot PRs (#162/#167/#173) can merge.

**Alternatives considered:** Two separate PRs honoring the locked workflow-isolation rule (deadlocked: each PR would inherit the OTHER failure from main and land CI-red, forcing admin bypass), Convert actionlint job to a glob-based loop (every .github/workflows/*.yml) — wider but auto-self-healing for future workflow deletions; deferred because mixing template-rendered (.ci-rendered/*.yml) with owned workflows needs more thought

**Implications:**
- Time-stable test fixtures need relative timestamps when any rollup window logic depends on Date.now(). Will add a CONTRIBUTING note or lint to catch literal ISO dates in test fixtures over time
- Workflow lint lists should be glob-discovered, not hardcoded; revisit in next workflow refactor wave

---

