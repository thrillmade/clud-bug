← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 17:39 - rc.20: floating @next hook + update notifier + fix update re-adding the Action in local-only repos

**Reasoning:** Three 'effortless update' improvements per CEO direction. (1) The max-mode commit hook floats to the @next dist-tag (buildCommitReviewCommand defaults to 'next') instead of an exact version — every repo auto-fetches the latest recipe, so no per-release re-pin rollout (this is the LAST re-pin); the pin stays overridable for a frozen version. (2) An update notifier (brew/gh/vercel pattern): on an interactive run, a cached daily check prints an 'update available -> clud-bug update' nudge; the cache is refreshed by a detached background process so it never adds latency, and it's skipped for machine verbs + non-TTY (the hook's review-prompt stays silent). (3) Fixed a dogfood-caught bug: 'clud-bug update' created clud-bug-review.yml even in --local-only repos (maybeRefreshVersioned creates-when-absent) — now gated behind pathExists like audit/self-update, so update refreshes what's installed and never adds the API-key Action.

**Alternatives considered:** Keep exact pins + re-pin every release (rejected — recurring friction, fights max-mode-everywhere); a full update-notifier npm dep (rejected — zero-dep lightweight version is enough)

**Implications:**
- [CEO] publish v0.7.0-rc.20. Then ONE final re-pin rollout (init --local-only rc.20) moves the 7 repos to the floating @next hook — after which they auto-update forever

---

