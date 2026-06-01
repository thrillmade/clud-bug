## 2026-06-01 10:12 - clud-bug v0.6.32: release-discipline guard for v0.6.31 + stale dashboard text

**Reasoning:** v0.6.31's include-hidden-files: true fix is a single config line easy to lose in future template edits. Without the guard, a regression would silently revert to the pre-v0.6.31 silent-failure state (zero artifacts uploaded, dashboard empty, no error surface). Test asserts the flag is present in all 3 templates with an anchored regex (rejects commented-out occurrences). Smoke-tested: removes flag → test fails with citation; restored → passes. Also drops 'v0.6.30 will add' from the dashboard placeholder (stale now that both ship).

**Alternatives considered:** Wider integration test that uploads a real artifact + checks gh api (rejected: integration tests need GH_TOKEN + a live workflow run; release-discipline tests are pure-source assertions that run on every npm test, much faster feedback), Lint rule via actionlint (rejected: actionlint doesn't know domain-specific 'this flag must be present'; the discipline-test pattern matches our other lock-step assertions like composite-pin)

**Implications:**
- Pattern: release-discipline.test.js is the right home for 'this config must be present' assertions tied to past incidents. Other consumers may want similar guards (logmind side has fewer such gotchas but worth tracking)
- Smoke-test pattern (cp file + sed + revert) verified the guard actually fails on regression. Future test additions in this file should follow the same verify-the-guard-fails pattern

---
