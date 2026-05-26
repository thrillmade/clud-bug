## 2026-05-26 11:17 - Opt this repo into strictMode + strictSkills for the 4 baselines (dogfood BB.3)

**Reasoning:** PR #58 just refreshed this repo to v4 templates + composite @v0.5.10, which has BB.3 per-skill check-runs wired up. The manifest was bare so the codepath was a no-op — first chance to actually exercise BB.3 end-to-end in production. Setting strictMode: true (master gate fails on critical findings; gate behavior we already wanted) and strictSkills to the 4 baselines so each baseline emits its own check-run in the PR check list. The per-skill check-runs are visible signal but not required to merge unless added to the reporulez-default ruleset (which we are deliberately not doing in this PR — surfacing the check-runs first, deciding whether to gate on them later).

**Alternatives considered:** Just the 4 baselines as strictSkills (chosen). Smallest blast radius that still tests BB.3 end-to-end. Future PRs can add dedicated-mode skills like brand-voice-review if we install them here later.

**Implications:**
- First in-production exercise of v0.5.10 BB.3 on this repo. Validates: (a) checks: write permission emits check-runs correctly via Checks API, (b) classifyPerSkillOutcome + extractPerSkillLine handle real bot output, (c) the prompt block requiring a Per-skill scan section actually fires. No code change — manifest-only. If anything breaks downstream on installed repos that adopt strictSkills, this PR is the canary.

---
