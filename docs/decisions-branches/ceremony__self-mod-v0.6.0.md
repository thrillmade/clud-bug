## 2026-05-27 06:13 - ceremony: self-mod this repo to @v0.6.0 (clud-bug update)

**Reasoning:** PR #83 shipped v0.6.0 to npm but this repo's deployed clud-bug-review.yml was still pinned to @v0.5.15 (skipped the v0.5.16 self-mod). Running node bin/clud-bug.js update applies the canonical refresh: composite ref bump @v0.5.15 → @v0.6.0, template marker v9 → v10, install-version stamps refreshed across AGENTS.md/CLAUDE.md/.cursorrules + .clud-bug.json manifest, and clud-bug-collaboration baseline SKILL.md refreshed from the bundled copy.

**Alternatives considered:** Wait for Dependabot to auto-bump the composite ref — partial only, would miss the marker, the baseline refresh, and the agent-docs stamps, Defer until next release — leaves the canonical repo running an outdated workflow that doesn't dogfood its own latest

**Implications:**
- Self-mod 401 expected: this PR modifies .github/workflows/clud-bug-review.yml which IS the workflow that claude-code-action runs in. Admin-bypass merge required. The bundled #84 (claude-code-review.yml dependabot skip) needs the same bypass path.

---
## 2026-05-27 06:22 - fix(v0.6.1): bump BASELINE_SKILLS_REF SHA to post-org-migration commit + re-run self-mod

**Reasoning:** Baseline review on PR #85 caught the regression: v0.6.0's BASELINE_SKILLS_REF was pinned to a pre-org-migration agent-skills commit (a445597...) whose clud-bug-collaboration/SKILL.md still had thrillmot/<repo> URLs at lines 123-124. loadBaseline prefers the remote at the pinned SHA over the bundled local copy, so every clud-bug update against v0.6.0 wrote the dead-URL version onto disk. Bumped the SHA to 436963e... (thrillmade/agent-skills@main, verified via gh api). Re-ran clud-bug update to regenerate .claude/skills/clud-bug-collaboration/SKILL.md (now correctly thrillmade) plus the composite-pin/marker bumps for v0.6.1.

**Alternatives considered:** Ship v0.6.1 separately from #85's self-mod ceremony — would split the fix into 2 PRs and require redoing the ceremony for v0.6.1 anyway, Make loadBaseline prefer bundled-local over remote — bigger semantic change to skill resolution; the SHA pin contract is intentional so future skills updates can ship without an npm release

**Implications:**
- v0.6.1 is a patch release that completes the org migration end-to-end (the npm package no longer ships dead URLs to consumers). Composite pin lock-step bumped @v0.6.0 → @v0.6.1 across all 3 workflow templates + action.yml header per release-discipline contract. Same admin-bypass merge route as the original ceremony PR — both the v0.6.1 SHA fix AND the self-mod ceremony land together in PR #85.

---
