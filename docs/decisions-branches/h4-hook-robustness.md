← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 15:45 - H4: harden the commit hook — retry on transient npx failure + a diagnostic skip marker

**Reasoning:** The hardening audit flagged two hook-robustness gaps: (1) a transient npx/network blip made the recipe fetch silently exit 0 — no review, indistinguishable from a clean commit; (2) no way to tell a FAILED review from a CLEAN one. Added one retry (sleep 1 + re-fetch) before giving up, and a .git/clud-bug-review-skipped diagnostic marker written when the fetch ultimately fails, so a silent no-op is detectable. Still never blocks the commit (exit 0). Added a 'sh -n' syntax-validation test — the earlier marker-fragility bug showed shell validity needs a test.

**Implications:**
- Part of H4 (no version bump; batches into rc.19). The retry adds up to ~1s + a second npx on hard failure, but the hook is async/backgrounded so the commit never waits

---

