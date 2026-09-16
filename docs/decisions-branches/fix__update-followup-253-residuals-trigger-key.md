← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 20:34 - Update follow-up: one tests resolver, config-command messaging, review.trigger written and reconciled, #253 residuals closed

**Reasoning:** The pre-push hook carried hand-copied versions of the suite detector and the tests declaration parser, so the two could drift; it now renders the core patterns at generation time with a byte-equality parity test. Every message that told a user to hand-edit the manifest now names clud-bug config set, and the strict-mode line says humans-only. review.trigger is written by init and reconciled by update through one shared precedence primitive (manifest wins, hook files are a fallback guess), after a bare init re-run was found to silently revert a config-set value; init also removes the old surface when the trigger switches. AGENTS.md updates now ignore markers quoted in inline code, reject spans that straddle a fence, emit one separator per gap, and collapse duplicate live blocks to one with a notice.

**Alternatives considered:** Embed the resolver functions by toString into the hook script (rejected: their single quotes break the node -e embedding convention), Let a config-only edit install the first hook surface (rejected: off unless asked for), Delete the provably unreachable straddle guard (rejected: it is the literal residual the ruling names; documented as a rail)

**Implications:**
- Two shared primitives now own trigger precedence and hook removal for both init and update
- A file with several live blocks is repaired on the next update with a printed notice

---

