← back to [docs/timeline.md](../timeline.md)

## 2026-06-25 22:10 - Migrate clud-bug toolchain from TypeScript 5.5 to TypeScript 6.0

**Reasoning:** Dependabot opens TS bumps every minor; without a migration in place each one trips on TS5107 (esModuleInterop=false deprecation) AND on the TS6 @types auto-discovery removal. Slot in the migration as a small CTO-curated PR rather than waiting for a Wave 2 cleanup. Closes held dependabot #162.

**Alternatives considered:** Wait for Wave 2 — defers a known dependabot pain point indefinitely, Full esModuleInterop:true migration with import audit — bigger sweep deferred to TS7 timeframe (~12 months)

**Implications:**
- ignoreDeprecations:6.0 is a blanket suppressor; future contributors adding other deprecated tsconfig keys will get errors silently suppressed (mitigated by inline comment naming the scope + re-evaluation trigger)
- types:[node] minimal surface; future test/build tool additions may need explicit type names

---

