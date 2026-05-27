## 2026-05-26 21:59 - chore: migrate to thrillmade org + update all GitHub-org refs

**Reasoning:** Move 5 of the thrillmade migration. Repo transferred thrillmot/clud-bug → thrillmade/clud-bug via gh api. This PR updates every runtime + historical GitHub-org reference (thrillmot/<repo> → thrillmade/<repo>) across the codebase. Key surfaces: (1) package.json bugs + repository URLs (npm registry uses these for the package page links). (2) lib/skills.js BASELINE_SKILLS_REF — the URL that clud-bug init fetches baseline SKILL.md files from; now points at thrillmade/agent-skills. (3) templates/workflow*.yml.tmpl uses: thrillmade/clud-bug/.github/actions/strict-mode-gate@v0.5.16 — downstream installs pin to the new path. (4) AGENTS.md, README.md, CLAUDE.md, .github/workflows/*, .github/actions/strict-mode-gate/action.yml, CHANGELOG.md, docs/decisions-branches/*, docs/timeline.md, test files, .claude/skills cache. Personal-brand refs (thrillmot.com, @thrillmot user fixtures in tests) intentionally preserved. logmind v0.3.0 refresh installed (.gitattributes merge driver, post-merge hook). All 165 tests pass.

**Alternatives considered:** Preserve historical CHANGELOG + docs/decisions-branches/* as-is (history-accurate at time of writing) — clean uniform diff but technically rewrites historical record. Kept the rewrite because GitHub redirects + the tags exist under thrillmade now too, so links still work either way., Defer the test/skills.test.js regex update — would have left CI failing; bundled into this PR

**Implications:**
- Composite action ref in templates now points at thrillmade/clud-bug — already-tagged v0.5.16 + earlier accessible via GitHub redirect; new tags from this point use thrillmade canonically
- Re-tag a patch (v0.5.17) after merge so the canonical action path lands at the new owner; downstream clud-bug installs pull thrillmade URLs from then on
- tokenomics/clud-bug-review.yml uses: thrillmot/clud-bug ref (changed to thrillmade in Move 2's branch) becomes correct once this lands; tokenomics merge can proceed afterwards

---
