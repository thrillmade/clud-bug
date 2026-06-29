← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 08:34 - design-critic B1b: the design pass — config, gated recipe step, rc.15

**Reasoning:** Second half of the local design-critic (rc.15). core/design.ts holds the off-by-default config (readDesignConfig) + a pure run-gate (shouldRunDesign: opted-in + kind:design skills + pr trigger). review-prompt partitions code vs design skills and emits an optional '## 3b. Design-critic' step that finds the deploy-preview, renders light/dark via a browser MCP, and critiques screenshots against the design skills — advisory by default, never auto-fix. refresh now preserves installed design skills.

**Alternatives considered:** Make design a builtin default — rejected: it is off by default + cost-gated (config + pr-only + preview-required), Bundle the --with-design installer + Action MCP opt-in here — deferred to a fast-follow to keep rc.15 tight (manual .clud-bug.json opt-in works meanwhile)

**Implications:**
- Bumps version to rc.15 across the 5 lockstep pins + CHANGELOG
- Adversarial review caught + fixed a fail-silent bug: the preview-URL lookup used unset $OWNER/$REPO shell vars (would neuter the pass in local mode); now uses gh's {owner}/{repo} placeholders, with a regression test

---

