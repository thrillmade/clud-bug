## 2026-05-27 00:26 - chore: post-migration cleanup — vercel.json + site URL refs + AGENTS.md v5-slim + dependabot.yml

**Reasoning:** Phase C post-migration cleanup for clud-bug. Bundled changes: (1) root vercel.json with VERCEL_GIT_PREVIOUS_SHA-aware ignoreCommand — stops Vercel from rate-limiting on every non-site PR (recent PRs #74, #75 failed with upgradeToPro=build-rate-limit). Mirror of logmind's v0.2.9 fix. (2) site/app/page.tsx + opengraph-image.tsx GitHub-org refs thrillmot/<repo> → thrillmade/<repo> — 4 refs missed by Move 5's bulk sed (didn't include .tsx in extension list). Personal-brand refs (thrillmot.com, @thrillmot test fixtures) intentionally preserved. (3) logmind v0.3.0 → v0.3.1 refresh via logmind init: AGENTS.md block v4-slim → v5-slim (canonicalizes embedded skill install URL to thrillmade), workflow pins updated to logmind==0.3.1. (4) .github/dependabot.yml present (was untracked locally, npm config covering / and /site).

**Alternatives considered:** Wait for v0.4.0 notify redesign — different scope; these are independent cleanup items that should ship now, Skip vercel.json fix and let Vercel rate-limits stay — recurring failure on every non-site PR is real friction

**Implications:**
- Vercel deploys now skip non-site PRs automatically (no more build-rate-limit failures on routine work)
- AGENTS.md block on this repo now reflects thrillmade canonical URLs; downstream agent runtimes loading the local AGENTS.md see the new install command
- Step 5.5 (AGENTS.md refresh sweep) is now done for clud-bug — bundled here. Remaining: agent-skills, reporulez, tokenomics, rezgen

---
