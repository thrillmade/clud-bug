← back to [docs/timeline.md](../timeline.md)

## 2026-07-25 16:11 - ZP4: verdict-contract parity — publish VERDICT_CONCLUSION_TABLE as the canonical (verdict,strictMode)->conclusion oracle

**Reasoning:** clud-bug-app posts the clud-bug-review check from 3 places (deriveCheck here, deriveNotaryCheck, the webhook route) that must never disagree before Z6 can safely pin the check. deriveCheck's own mapping already matched the target contract; the gap was that nothing made the contract assertable outside this module, so clud-bug-app's notary + webhook paths had silently drifted (notary ignored strictMode entirely; the webhook posted success on any completed review regardless of critical findings).

**Alternatives considered:** Export nothing and rely on prose docs in each repo (rejected: exactly how the drift happened once already), Duplicate the table by hand in clud-bug-app (done as a stopgap, but only this exported table is the source of truth going forward)

**Implications:**
- clud-bug-app cannot import VERDICT_CONCLUSION_TABLE yet — it pins its clud-bug npm dependency to 0.7.0-rc.23, which predates this export; the App-side parity test mirrors the same literal cases until that pin is bumped in a future release
- check-verdict.ts's module doc no longer claims the hosted bot intentionally diverges — that divergence is retired in the companion clud-bug-app PR

---

