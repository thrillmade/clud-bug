## 2026-06-02 12:56 - fix(v0.6.34): clud-bug-review emits neutral check-run on transient AI errors (tokenomics-agent Concern 2)

**Reasoning:** Tokenomics agent's v0.6.14 verification cycle surfaced that clud-bug-review concludes FAILURE when Anthropic API errors mid-execution, even though no content critical was found. This blocks the PR's required-checks gate with no remediation path the reviewer can take. Tool failure shouldn't be indistinguishable from 'reviewer found critical content'. Fix: action step gets continue-on-error: true; new step detects 'outcome==failure AND structured_output empty' → emits a 'clud-bug-review' check-run with conclusion=neutral via gh api. Neutral does NOT block required-status-checks. The Layer-6 fallback guard tightened to skip the empty-output case when outcome was failure, avoiding double-emit. Critical-findings path unchanged: structured output present → render comment → strict-mode-gate detects criticals → emits its own failure. Template marker v12 → v13; propagates to 5 consumer repos on next self-update cycle.

**Alternatives considered:** Add workflow_dispatch trigger so admins can manually re-run — declined; GitHub's built-in 'Re-run failed jobs' button already covers this and a custom dispatch needs PR-context plumbing not worth the complexity, Retry the AI call inline with backoff — added complexity for marginal benefit; transient errors are rare enough that the neutral fallback + push-to-retry is sufficient signal, Leave broken (mark as known issue) — declined; the tokenomics agent had to '--admin' bypass the gate which violates the dogfood discipline

**Implications:**
- PRs no longer get jammed by Anthropic API hiccups; tool failures emit neutral, content findings emit failure — the signal is honest
- Propagation cycle to 5 consumer repos picks up v13 template via clud-bug self-update — standard flow
- When the GitHub App (D.2.5+) replaces the workflow, the same neutral-vs-failure distinction needs to live in lib/orchestrator.ts or lib/review-vote.ts

---
