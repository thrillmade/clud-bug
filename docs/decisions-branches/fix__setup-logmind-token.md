← back to [docs/timeline.md](../timeline.md)

## 2026-09-28 20:06 - The two logmind CI checks pass a token to setup-logmind so the release lookup is never rate-limited (#355)

**Reasoning:** check-derived-docs and check-links called the action unauthenticated, and on PR #354 the anonymous release lookup returned 403 and failed the check. Both call sites now pass github.token in the same form logmind-self-update has used since #329; no permission widens because the token is already scoped to the job. A workflow-shape test asserts every setup-logmind step in this repo carries the token, so a future call site without one fails CI.

**Alternatives considered:** Pin the action to a release asset URL instead of resolving latest (rejected: still an API call, and the action already supports a token)

**Implications:**
- The same fix applies to any other thrillmade repo that calls setup-logmind without a token

---

