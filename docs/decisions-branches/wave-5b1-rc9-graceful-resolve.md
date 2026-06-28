← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 00:41 - clud-bug rc.9: graceful PAT-or-fallback auto-resolve + idempotent markers

**Reasoning:** GitHub's Actions GITHUB_TOKEN can't run resolveReviewThread; rc.9 makes the npm workflow graceful (posts a 'verified fixed' reply with no error when no PAT) and adds an opt-in CLUD_BUG_RESOLVE_PAT secret for real auto-close. Each reply carries a hidden verdict+anchor-sig marker so repeat fix-pushes don't re-reply and skip redundant verifier calls.

**Alternatives considered:** Editing the original finding comment to badge it (rejected: needs de-anchoring the finding-id re-match regexes; deferred to a fast-follow). Literal-parity with no dedup (CEO chose the idempotency guard instead).

**Implications:**
- Cached ADDRESSED threads now resolve when a PAT becomes available (adversarial-review fix). Anchor sig widened to 16 hex (findingId parity). Tag + npm publish of rc.9 is a USER ACTION; PAT-path + cached-resolve verified via clud-bug-test smoke only.

---

