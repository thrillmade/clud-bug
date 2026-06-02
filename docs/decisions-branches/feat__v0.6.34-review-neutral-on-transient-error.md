## 2026-06-02 12:56 - fix(v0.6.34): clud-bug-review emits neutral check-run on transient AI errors (tokenomics-agent Concern 2)

**Reasoning:** Tokenomics agent's v0.6.14 verification cycle surfaced that clud-bug-review concludes FAILURE when Anthropic API errors mid-execution, even though no content critical was found. This blocks the PR's required-checks gate with no remediation path the reviewer can take. Tool failure shouldn't be indistinguishable from 'reviewer found critical content'. Fix: action step gets continue-on-error: true; new step detects 'outcome==failure AND structured_output empty' → emits a 'clud-bug-review' check-run with conclusion=neutral via gh api. Neutral does NOT block required-status-checks. The Layer-6 fallback guard tightened to skip the empty-output case when outcome was failure, avoiding double-emit. Critical-findings path unchanged: structured output present → render comment → strict-mode-gate detects criticals → emits its own failure. Template marker v12 → v13; propagates to 5 consumer repos on next self-update cycle.

**Alternatives considered:** Add workflow_dispatch trigger so admins can manually re-run — declined; GitHub's built-in 'Re-run failed jobs' button already covers this and a custom dispatch needs PR-context plumbing not worth the complexity, Retry the AI call inline with backoff — added complexity for marginal benefit; transient errors are rare enough that the neutral fallback + push-to-retry is sufficient signal, Leave broken (mark as known issue) — declined; the tokenomics agent had to '--admin' bypass the gate which violates the dogfood discipline

**Implications:**
- PRs no longer get jammed by Anthropic API hiccups; tool failures emit neutral, content findings emit failure — the signal is honest
- Propagation cycle to 5 consumer repos picks up v13 template via clud-bug self-update — standard flow
- When the GitHub App (D.2.5+) replaces the workflow, the same neutral-vs-failure distinction needs to live in lib/orchestrator.ts or lib/review-vote.ts

---
## 2026-06-02 13:42 - fix(v0.6.34): bump strict-mode-gate pins + heredoc in neutral-checkrun body

**Reasoning:** CI on PR #140 surfaced two issues: (1) release discipline tests 116/149/150 — strict-mode-gate@v0.6.33 pins in workflow templates weren't bumped alongside package.json 0.6.34; (2) actionlint SC2016 — printf with single-quoted multi-line body flagged because shellcheck mistakes the single-quoted literal for an unexpanded expression

**Alternatives considered:** suppress SC2016 via shellcheck disable directive — rejected: heredoc is cleaner + signals intent better, use double-quoted printf with explicit \n escapes — rejected: every ${VAR}-style placeholder in BODY would need escaping

**Implications:**
- PR #140 CI should now go green; auto-merge will fire once clud-bug-review re-evaluates the diff
- strict-mode-gate pin bump pattern is now exercised — next release cycle will catch missed pin updates via the same test

---
## 2026-06-02 14:12 - fix(v0.6.34): keep canonical workflow self-pin one release behind

**Reasoning:** PR #140 CI failed because .github/workflows/clud-bug-review.yml self-pinned at strict-mode-gate@v0.6.34, but that tag doesn't exist until after this PR merges. Historical pattern (#93, #115, #119, #126, #128, #130, #132): canonical self-pin lags by one release and gets bumped in a follow-up 'chore: self-propagate' PR after the tag exists. Templates + action.yml header carry forward to v0.6.34 (consumer-facing future state, no chicken-and-egg). Release-discipline tests only check templates + action.yml, not the canonical workflow, so this is correct

**Alternatives considered:** admin-merge as-is and let the next push self-heal — rejected: admin-merge as a routine release mechanism is fragile; should be reserved for emergencies, use @main for self-references — rejected: supply-chain risk, audit-trail loss, and diverges from the established pattern

**Implications:**
- after v0.6.16 merges + v0.6.34 tag is created, open a follow-up 'chore: self-propagate v0.6.34' PR to bump line 800 back to @v0.6.34
- added an explanatory comment in the workflow so future contributors see the convention without git-archaeology

---
