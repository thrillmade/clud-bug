← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 11:39 - rc.16: clud-bug init --with-design — install the design kit + enable the lens; Action browser-MCP opt-in

**Reasoning:** The design lens shipped in rc.15 but there was no one-command way for a repo to install the 3 kind:design skills and flip the off-by-default design block on. --with-design mirrors --with-hooks: loadDesignKit (bundled-only, no network) writes the kit via writeSkills, then the manifest stamp flips design.enabled:true (preserving any existing gate/themes/viewports). The 3 workflow templates also gain a commented browser-MCP opt-in so the Action reviewer can render natively (Claude drives a real browser; no Browserless). Completes the design-critic everywhere-and-installable story.

**Alternatives considered:** A separate 'clud-bug design enable' command — rejected: --with-design composes with the existing init flags and one bootstrap is simpler, Wiring the browser MCP into the templates live by default — rejected: a commented opt-in keeps the default workflow lean + free (no extra MCP cost)

**Implications:**
- New rc.16 (lockstep bump: package.json + 3 template strict-mode-gate pins + action.yml header). [CEO] push the v0.7.0-rc.16 tag after merge → OIDC publish to npm next
- The Action opt-in is documentation-only (commented YAML); a future PR can wire the browser MCP live

---

