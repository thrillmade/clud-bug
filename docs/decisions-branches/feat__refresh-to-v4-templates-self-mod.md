## 2026-05-26 11:00 - Self-mod ceremony: refresh this repo to v4 templates + composite @v0.5.10

**Reasoning:** PR #57 shipped v0.5.10 (per-skill check-runs) and the npm-publish workflow tagged. This repo's own clud-bug-review.yml was still v2 / @v0.5.8 — first opportunity to exercise v0.5.7's refresh-mode in production. `clud-bug update` correctly bumped marker v2 → v4, swapped composite ref @v0.5.8 → @v0.5.10, added the checks: write permission for BB.3 check-runs, and added Bash(cat .claude/skills/*/SKILL.md) to allowedTools so the v0.5.9 per-skill scan prompt actually has the tool it needs. Also installed the clud-bug-collaboration baseline (which this repo predates) and created the bare manifest. Refresh-mode preserved all five workflows correctly — no clobber on customized files.

**Alternatives considered:** Wait for the weekly self-update cron (Mondays 12:00 UTC) — would land the same diff but blocks BB.3 in-production verification by another week with no upside. Rejected: dogfooding is the whole point.

**Implications:**
- First in-production exercise of refresh-mode (v0.5.7), composite-action @v0.5.10, and the v0.5.9 per-skill scan output structure end-to-end. The PR will trigger the expected claude-code-action 401 self-mod guard; merging requires the Repository-admin bypass we set up in PR #55. No code change in clud-bug itself — this is purely the rendered-output sync.

---
