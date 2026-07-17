← back to [docs/timeline.md](../timeline.md)

## 2026-07-16 23:15 - Phase ZP2: make the notary default-ON for local max mode (opt-out via .clud-bug.json, not opt-in via env var)

**Reasoning:** CEO decision: an env var set at init-time can't reliably reach the agent's LATER independent post-check-run Bash call in a Claude Code session, so env injection was never a viable default-on mechanism; .clud-bug.json is read fresh on every invocation (same pattern as design.ts/invariants.ts/review-context.ts), so it's the robust config surface. New src/core/notary-config.ts::readNotaryConfig(manifest) is the single shared resolver both post-check-run.ts (submit gate) and review-prompt.ts (§5 rendering) call, so policy can't fork between them.

**Alternatives considered:** Keep opt-in (status quo, env-var-only) — rejected, doesn't meet the CEO's default-on requirement and free/no-App installs would just never see a notary, Resolve per-call-site instead of a shared core module — rejected, risked the CLI submit-gate and the review-prompt §5 text disagreeing on whether a repo is notarized, Let review-prompt's rendered §5 keep asking the agent to check CLUD_BUG_NOTARY_URL itself — rejected, replaced with deterministic rendering from the resolved value since the agent has no reliable way to observe the env var an earlier process saw

**Implications:**
- post-check-run.ts now reads the manifest once (readManifest) and reuses it for both readNotaryConfig and strictMode, instead of a second conditional read
- review-prompt.ts's §5 renders exactly one of two forms (notary-submit vs self-attest) based on the caller-resolved notaryUrl, never both and never an agent-inferred branch
- Manifest gains an optional notary?: boolean field (src/cli/skills.ts); only the literal false opts out, and it beats even an explicit CLUD_BUG_NOTARY_URL override
- Free/no-App installs are unaffected end-to-end: the existing entitlement-gated 402 -> fallback -> self-attest path is untouched, so submitting to a notary you're not entitled to still degrades to the labeled self-attested check rather than blocking

---

## 2026-07-17 00:06 - ZP2 fix: a degenerate all-slash CLUD_BUG_NOTARY_URL no longer silently disables the notary

**Reasoning:** Adversarial review found stripTrailingSlash('/') === '' → readNotaryConfig returned an empty string → both call sites (truthiness checks) treated it as the notary:false opt-out, silently self-attesting despite a non-empty env override (reverse-proxy base path / paste slip), violating the documented precedence. Guard: a non-empty env value that normalizes to empty is not a usable origin → fall through to the default-ON hosted notary, never a silent opt-out (only the manifest opts out). +1 regression test.

**Alternatives considered:** Throw on a degenerate URL (rejected: fail-safe toward notarizing beats crashing post-check-run), Return the pre-strip value (rejected: '/' is not a usable origin)

**Implications:**
- Only .clud-bug.json notary:false disables the notary; env values never silently opt out

---

