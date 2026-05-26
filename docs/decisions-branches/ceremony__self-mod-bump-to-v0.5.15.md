## 2026-05-26 15:44 - Self-mod ceremony: bump this repo to v9 templates + @v0.5.15 composite

**Reasoning:** Across-repo sweep: ensure all thrillmot repos with clud-bug installed (except logmind) are current at v0.5.15 latest. This repo was at v0.5.14 (v8 templates / @v0.5.13 composite) after the PR #66 self-mod. v0.5.15 added the release-discipline test for composite-pin lock-step and bumped templates v8 -> v9 / composite @v0.5.13 -> @v0.5.15 (no functional change to composite or lib/skills.js — pure mechanical bump per the new lock-step rule).

**Alternatives considered:** Wait for Monday self-update cron to bring this repo to v0.5.15 automatically. Rejected: we are sweeping all repos now to consolidate, and waiting a week defers validation by exactly that long.

**Implications:**
- After merge, this repo is the reference implementation of the v0.5.15 release-discipline contract: composite pin = package.json version. Next PR opened against main will validate v0.5.15 end-to-end (the release-discipline test ran on PR #67 already, so the rule is known to enforce; this self-mod just lands the install state).

---
