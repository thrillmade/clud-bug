← back to [docs/timeline.md](../timeline.md)

## 2026-08-01 09:30 - Delete probe surface, replace with SPEC 2.0 §4.7 CI evidence (clud-bug#264/#260)

**Reasoning:** SPEC 2.0 §4.7 bans reviewer execution unconditionally ('A reviewer MUST NOT execute code, tests, builds or scripts... so no surface runs one and none is specified'). invariants.ts self-enabled that banned behavior from a single .clud-bug.json config key (readInvariantsConfig: 'declaring at least one valid invariant is the explicit opt-in'). Reading CI results the forge already produced is §4.7's sanctioned substitute, on by default.

**Alternatives considered:** Thread a trust parameter into shouldRunProbes (issue #260's original body) — superseded by the maintainer's own follow-up comment: the probe surface itself is gone, not merely trust-gated, tracked at #264., Leave the probe surface disabled-by-default instead of deleting it — rejected: no disabled flag or commented-out seam that could be switched back on.

**Implications:**
- Deletes src/core/invariants.ts + test, shouldRunProbes, the invariants[].probe config, and every RUN/EXECUTE instruction in both prompts (local recipe cli/review-prompt.ts + Action core/prompts.ts). Adds src/core/ci-checks.ts (readCiChecksConfig/shouldReadCiChecks) + a new ciChecks .clud-bug.json key that only narrows which checks are read (absent = every check; explicit [] = the one way to opt out).
- Reconciled grounding-form docs (review-schema.ts, notary-bundle.ts, check-verdict.ts) and the public docs site (site/app/page.tsx, docs/config, docs/multi-pass, docs) since they described the deleted execution capability as live behavior; the homepage/multi-pass benchmark claims are now captioned as measured under the superseded Phase R (execution-grounded) methodology, pending a fresh run against the CI-evidence recipe.
- Golden review-prompt byte/line caps bumped (18700→19700 bytes, 385→400 lines) for the new CI-evidence instructions in the Action's default prompt; test/golden/{must-contain,must-not-contain}.json gained entries locking the new instruction in and the old command-execution framing out.

---

