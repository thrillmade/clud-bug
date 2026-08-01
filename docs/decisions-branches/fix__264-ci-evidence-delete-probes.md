← back to [docs/timeline.md](../timeline.md)

## 2026-08-01 09:30 - Delete probe surface, replace with SPEC 2.0 §4.7 CI evidence (clud-bug#264/#260)

**Reasoning:** SPEC 2.0 §4.7 bans reviewer execution unconditionally ('A reviewer MUST NOT execute code, tests, builds or scripts... so no surface runs one and none is specified'). invariants.ts self-enabled that banned behavior from a single .clud-bug.json config key (readInvariantsConfig: 'declaring at least one valid invariant is the explicit opt-in'). Reading CI results the forge already produced is §4.7's sanctioned substitute, on by default.

**Alternatives considered:** Thread a trust parameter into shouldRunProbes (issue #260's original body) — superseded by the maintainer's own follow-up comment: the probe surface itself is gone, not merely trust-gated, tracked at #264., Leave the probe surface disabled-by-default instead of deleting it — rejected: no disabled flag or commented-out seam that could be switched back on.

**Implications:**
- Deletes src/core/invariants.ts + test, shouldRunProbes, the invariants[].probe config, and every RUN/EXECUTE instruction in both prompts (local recipe cli/review-prompt.ts + Action core/prompts.ts). Adds src/core/ci-checks.ts (readCiChecksConfig/shouldReadCiChecks) + a new ciChecks .clud-bug.json key that only narrows which checks are read (absent = every check; explicit [] = the one way to opt out).
- Reconciled grounding-form docs (review-schema.ts, notary-bundle.ts, check-verdict.ts) and the public docs site (site/app/page.tsx, docs/config, docs/multi-pass, docs) since they described the deleted execution capability as live behavior; the homepage/multi-pass benchmark claims are now captioned as measured under the superseded Phase R (execution-grounded) methodology, pending a fresh run against the CI-evidence recipe.
- Golden review-prompt byte/line caps bumped (18700→19700 bytes, 385→400 lines) for the new CI-evidence instructions in the Action's default prompt; test/golden/{must-contain,must-not-contain}.json gained entries locking the new instruction in and the old command-execution framing out.

---

## 2026-08-01 09:42 - Fence CI-check free text; only conclusion enum grounds a finding (coordinator review of f0b5193)

**Reasoning:** The §3c CI-evidence text told the reviewer a failed check was 'trusted machine output, not a claim about the change' and forbade discounting it. But a check's name/description/output text are author-controlled — src/core/review-context.ts:7-16's TWO TRUST TIERS model says untrusted (author-authored) content may only focus attention, never suppress a finding, lower a severity, or relax a skill. A PR touching .github/workflows/** or a script a workflow runs decides what a check is named and what it says, so that free text was admitted into the trusted tier and made strictly more privileged than the fenced <!-- clud-bug: ... --> PR-description marker, which can only focus, not force a severity. Same trust error the execution-ban deletion fixed, one step removed.

**Alternatives considered:** Leave the free text trusted but add a caveat — rejected: a caveat the model can weigh against isn't a fence; fenceUntrustedContext's contract is unconditional (never suppress, never lower severity), and this needed the same unconditional treatment., Drop CI-check evidence back to conclusion-only, no name/description in the prompt at all — rejected: the free text is still useful context for WHICH finding a check relates to, same as the untrusted PR marker is still shown to the reviewer; fencing (not deleting) is the established pattern.

**Implications:**
- src/cli/review-prompt.ts (SEVERITY_RULE + the §3c ciEvidenceStep) and src/core/prompts.ts (the CI-checks fetch bullet + the reproduction grounding-form bullet) now split trust explicitly: state/conclusion (forge's closed enum, un-authorable by the change) grounds/argues a finding; name/description/summary (author-controlled) are fenced like the untrusted PR marker — may focus attention, must never ground, suppress, argue away, or move severity.
- Also closes a command-injection sub-case: prompts.ts no longer instructs a follow-up 'gh api ... --jq select(.name == "<name>")' command that splices an observed, attacker-influenced check name into a new shell invocation (a name containing a stray quote could break out of the outer single-quoted jq argument). Both surfaces now do ONE fetch (name+summary together) instead.
- Golden fixtures updated: test/golden/must-contain.json gained 'the change under review cannot author them' + the fencing-contract phrase; test/golden/must-not-contain.json gained 'trusted machine output' and the select(.name == pattern; byte/line caps bumped again (19700→20800 bytes, 400→415 lines) for the added trust-tier paragraph. test/review-prompt.test.js gained a dedicated fencing assertion.

---

