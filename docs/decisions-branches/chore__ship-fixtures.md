← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 10:11 - Ship fixtures/reviews in the npm package so every producer can run the SPEC §4.3 corpus test (#256)

**Reasoning:** SPEC 2.0 §4.3: a shared fixture corpus MUST be rendered by every producer as a release test. The corpus lives in this repo but the package did not ship it (npm pack of 0.7.0-rc.27: 0 fixture entries), so the hosted App — which depends on the package — could not reach it; the App's corpus check lands guarded and turns on at its next pin bump.

**Alternatives considered:** Have the App vendor a copy of the corpus (rejected: two owners of the same fixtures)

**Implications:**
- Tarball grows by the fixture files; nothing at runtime reads them

---

