## 2026-05-27 06:13 - ceremony: self-mod this repo to @v0.6.0 (clud-bug update)

**Reasoning:** PR #83 shipped v0.6.0 to npm but this repo's deployed clud-bug-review.yml was still pinned to @v0.5.15 (skipped the v0.5.16 self-mod). Running node bin/clud-bug.js update applies the canonical refresh: composite ref bump @v0.5.15 → @v0.6.0, template marker v9 → v10, install-version stamps refreshed across AGENTS.md/CLAUDE.md/.cursorrules + .clud-bug.json manifest, and clud-bug-collaboration baseline SKILL.md refreshed from the bundled copy.

**Alternatives considered:** Wait for Dependabot to auto-bump the composite ref — partial only, would miss the marker, the baseline refresh, and the agent-docs stamps, Defer until next release — leaves the canonical repo running an outdated workflow that doesn't dogfood its own latest

**Implications:**
- Self-mod 401 expected: this PR modifies .github/workflows/clud-bug-review.yml which IS the workflow that claude-code-action runs in. Admin-bypass merge required. The bundled #84 (claude-code-review.yml dependabot skip) needs the same bypass path.

---
