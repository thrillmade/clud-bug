← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 01:12 - clud-bug rc.10 (Wave 6a): §6.6 conformance-fixture gate + §3.23.1 configure-github payload

**Reasoning:** Closes two NORMATIVE SPEC v0.5.1 gaps. §6.6: 5 review fixtures + scripts/fixture-check.mjs renders renderReview byte-identical against committed goldens, wired as a CI gate so a comment-shape change fails the build until goldens are reviewed. §3.23.1: the idempotent configure-github no-op now emits alreadyCanonical + rulesetVersion as named fields (+ --json) for machine consumers.

**Alternatives considered:** Vendoring the canonical fixtures in protocol/fixtures/reviews per the SPEC location (deferred — the clud-bug gate is the substance; the protocol copy is a byte-identical follow-up). Hand-writing expected.md (rejected — goldens are generated via --update to guarantee byte-identity).

**Implications:**
- fixture-check.mjs imports from dist/, so CI must build first (it does). configure-github --dry-run --json now reports dryRun:true even on an already-canonical repo (adversarial-review fix). §6.8.3 per-pass cost comment (clud-bug-app) + the protocol canonical-fixtures copy remain as 6a follow-ups.

---

