← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 19:48 - site/ gets a CI gate and its lockfile advisory is cleared (#337, #334)

**Reasoning:** Nothing typechecked or built site/ on a PR, so a broken import surfaced only at Vercel deploy time. The new site job mirrors test (same triggers, Node 20, the same pinned actions, no path filter so the check never vanishes from a PR) and adds a tsc --noEmit typecheck script. baseline-browser-mapping is bumped lockfile-only to 2.11.24 through npm update, clearing GHSA-w5vr-8v7q-w6rv.

**Alternatives considered:** A paths filter on site/ (rejected: the check would vanish from PRs that do not touch site/, which reads as passing), Wait for dependabot to pick up the advisory (rejected: it had not within the weekly window)

**Implications:**
- Every PR now spends about a minute building site/
- npm 11 dropped libc classifier arrays from about 20 optional platform entries in the lockfile; inert for install, will show in the next dependabot diff

---

