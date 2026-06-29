← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 12:04 - A6a: site Marketplace pages — /pricing, /privacy, /terms (field-guide style)

**Reasoning:** GitHub Marketplace rejects a paid listing whose privacy/terms/pricing URLs 404. Added the three required pages to cludbug.dev in the existing field-guide style (new .doc CSS reusing the paper/ink tokens). Pricing states the locked tiers (Trial 0 / Solo 9 / Team 29 / +1.2x overage) with the cost-plus rationale. Privacy is rewritten ACCURATE to the current system: GitHub-Issues-only contact (CEO decision), Stripe + Browserless added to sub-processors, and the writeback described as the in-place PR comment (the docs/reviews/PR-N.md mechanism is deprecated). Terms is a clearly-marked DRAFT skeleton (not legal advice; [LEGAL REVIEW] placeholders, noindex) for counsel. Dogfooded the design-critic: rendered desktop + mobile, screenshots clean (tier grid stacks, tables reflow, no overflow).

**Alternatives considered:** Redirect /pricing to app.cludbug.dev/pricing — rejected: CEO chose a real page; a redirect is fragile for a Marketplace-required URL, Copy PRIVACY.md verbatim — rejected: it was stale (no Stripe/Browserless, deprecated writeback wording, unresolved contact)

**Implications:**
- [CEO] sign off /terms with counsel before relying on it (DRAFT banner + noindex until then)
- Source docs in clud-bug-app/marketplace/ (PRIVACY/SUPPORT) + a SECURITY.md still need the same accuracy sync — separate clud-bug-app change
- The Solo card is the visually-featured tier — confirm vs featuring Team (the feature-rich upsell)

---

