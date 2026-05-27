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
## 2026-05-27 06:28 - fix(v0.6.1): unblock CI — pin deployed workflow at @v0.6.0 until v0.6.1 tag exists + regen timeline

**Reasoning:** clud-bug-review failed on rebased commits with "Unable to resolve action thrillmade/clud-bug@v0.6.1" — chicken-and-egg: the deployed .github/workflows/clud-bug-review.yml was bumped to @v0.6.1 by node bin/clud-bug.js update, but that tag does not exist yet (it gets created on PR merge via npm-publish). Reverted just the deployed workflow line back to @v0.6.0; templates stay at @v0.6.1 (release-discipline.test.js only enforces templates, not the deployed file). Also regenerated docs/timeline.md to include the v0.6.1 decision (check-derived-docs caught the staleness).

**Alternatives considered:** Cut v0.6.1 npm release in a separate PR FIRST (just lib/skills.js + package.json + templates + CHANGELOG), then do the ceremony in a follow-up — splits one logical change into two admin-bypass PRs, more ceremony for no gain, Leave clud-bug-review.yml at @v0.6.1 and accept the broken CI — defeats the entire purpose of the workflow, would block future ceremony PRs in the same way

**Implications:**
- After this PR merges and v0.6.1 publishes to npm, a tiny follow-up self-mod PR can bump the deployed clud-bug-review.yml from @v0.6.0 → @v0.6.1. That ceremony will succeed because the tag exists. Comment added inline in the workflow file explaining the temporary pin.

---
## 2026-05-27 06:32 - fix(v0.6.1): pin deployed workflow at @v0.5.16 (latest existing tag), not @v0.6.0

**Reasoning:** clud-bug-review continued to fail with Unable to resolve action @v0.6.0 — git ls-remote confirms v0.6.0 tag was never created on origin. PR #83 merged but the npm-publish workflow only fires on a manual tag push, not on merge-to-main. So both v0.6.0 and v0.6.1 do not exist as git tags right now. Pinned the deployed workflow at @v0.5.16 (latest tag that exists) to get CI green. Templates stay at @v0.6.1 (correct lock-step contract for the npm package).

**Alternatives considered:** Manually tag v0.6.0 first to make that ref resolvable — that would publish a buggy version to npm (v0.6.0 has the org-migration regression). Skip straight to v0.6.1., Pin deployed workflow at @v0.6.1 anyway and create the tag pre-merge — same chicken-and-egg, would need force-push the tag after PR rebases

**Implications:**
- After this PR merges, the human/agent needs to (1) git tag v0.6.1 <merge-commit>, (2) git push origin v0.6.1. That triggers npm-publish.yml automatically. THEN a small follow-up self-mod PR can bump the deployed workflow @v0.5.16 → @v0.6.1. Inline comment in clud-bug-review.yml documents the temporary pin and the follow-up step.

---
