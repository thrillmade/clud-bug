## 2026-05-27 06:49 - ceremony: bump deployed workflow @v0.5.16 → @v0.6.1 (follow-up to #85)

**Reasoning:** PR #85 shipped v0.6.1 with the deployed clud-bug-review.yml pinned at @v0.5.16 as a temporary unblock (v0.6.1 tag did not exist yet). Tag was created post-merge (git tag v0.6.1 + push), and the npm-publish workflow succeeded on retrigger after the trusted-publisher config was updated to thrillmade/clud-bug. Now that @v0.6.1 resolves, run node bin/clud-bug.js update on this repo to bump the deployed workflow ref + remove the temporary inline note.

**Alternatives considered:** Wait for Dependabot to auto-bump on its weekly schedule — slower, and it only handles the workflow ref, not the inline note cleanup, Skip the cleanup, leave the workflow at @v0.5.16 — defeats the whole point of the v0.6.1 release (consumers and this repo would not pick up the BASELINE_SKILLS_REF fix that v0.6.1 ships in lib/skills.js via the composite)

**Implications:**
- After this PR merges, this repo dogfoods v0.6.1 end-to-end. Future PRs will run with the corrected BASELINE_SKILLS_REF, so any agent or clud-bug update flow stays on canonical thrillmade URLs. Same admin-bypass merge route as #85 (modifies clud-bug-review.yml, triggers claude-code-action self-mod 401).

---
