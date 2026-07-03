← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 13:12 - Phase S: add privacy/terms/pricing pages + fix the pricing-link inconsistency

**Reasoning:** The GitHub Marketplace listing requires privacy, terms, and pricing URLs on the marketing site (cludbug.dev). Ported the three pages from the held origin/a6a-marketplace-pages branch (fresh onto current main, avoiding the stale branch's 11-commit conflict debt) + the 137-line .doc/.tier/.price CSS block they need (reuses existing --mono/--leaf/--display vars). Fixed the pricing-link inconsistency the plan flagged: the landing linked pricing to app.cludbug.dev/pricing, but the Marketplace needs cludbug.dev/pricing — now that the site has its own /pricing page, the landing points there (SITE_PRICING_URL=/pricing). Site builds green; /pricing /privacy /terms all prerender.

**Alternatives considered:** Rebase the stale A6a PR #196 (rejected: 11 behind with conflicts + rebase noise deleting main's newer files; porting the content fresh is clean)

**Implications:**
- Unblocks 3 of the 5 hard Marketplace URL blockers; landing-refresh (max-mode/design/auto-fix/auto-resolve sections) + /docs + screenshots are the remaining Phase S slices

---

