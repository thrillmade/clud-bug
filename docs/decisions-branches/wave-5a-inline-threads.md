← back to [docs/timeline.md](../timeline.md)

## 2026-06-27 17:38 - Wave 5a — D.2.X per-finding inline review threads in npm workflow (rc.7)

**Reasoning:** OSS parity push: bring inline-thread feedback (D.2.X) from clud-bug-app to the npm workflow template path so self-hosted users get per-finding GitHub review threads instead of one bundled summary comment. The pure helpers + GraphQL constants land in clud-bug/core/inline-threads.ts (App can swap to import from core in a future Wave 5c). New CLI verb post-inline-threads --stdin shells out to gh api for the REST createReview + gh api graphql for thread-id lookup. Workflow templates get a new post-step after the existing render step.

**Alternatives considered:** Move inline-thread logic into clud-bug-app (status quo, App-only): rejected because OSS users get strictly less. Plan locked feature-complete-before-Marketplace and OSS pitch promises 'best-in-class single-pass + inline threads + auto-resolve'., Use Redis-backed thread persistence in npm workflow (parallel to App): rejected. npm workflow is stateless; introducing Redis requires customers wire external infra. Stateless-via-GraphQL is the way — query GitHub reviewThreads on demand, re-derive findingId from the <!-- finding-id: ... --> marker we embed in each comment body., Combine D.2.X + D.2.6 in one rc.7 PR: rejected. Two sequential PRs (5a then 5b) keep each reviewable (~700 LOC) and let 5a soak on clud-bug-test before 5b builds on it.

**Implications:**
- Workflow templates now invoke a third CLI verb post-render (post-inline-threads). All 3 variants updated in lockstep. Test count 602 → 647 (+45).

---

