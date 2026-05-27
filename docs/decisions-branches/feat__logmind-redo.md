## 2026-05-15 11:33 - Initialize logmind decision tracking

**Reasoning:** Starting structured decision logging for this project to maintain clear documentation of architectural choices and provide context for AI agents.

**Alternatives considered:** Manual decision documentation, ADR (Architecture Decision Records)

**Implications:**
- All significant decisions should now be logged using `logmind.log()`
- AI agents will have access to decision history via docs/decisions.md
- Git history will serve as an audit trail for all decisions

---
## 2026-05-15 11:34 - v0.5.0: baseline skills sourced from thrillmade/agent-skills, SHA-pinned (PR 25)

**Reasoning:** Skills were bundled in clud-bug only; not shareable. Moved to canonical home at thrillmade/agent-skills (skills.sh layout: skills/<name>/SKILL.md). Pinned to commit SHA in lib/skills.js (currently 977e439…) — re-couples trust to clud-bug releases so a malicious commit on agent-skills@main can't silently land in users' Claude review steering prompts mid-cycle.

**Alternatives considered:** Stay bundled-only; fetch from main (rejected: supply-chain exposure); ship checksum lock file

**Implications:**
- Bumping baseline skill content requires a clud-bug release that updates BASELINE_SKILLS_REF. Bundled fallback covers offline / 404 / network-error / 5s-timeout / empty-body. Per-user cache at ~/.cache/clud-bug/skills/ keyed by base+name (no cross-base poisoning). Init log surfaces source.

---
## 2026-05-15 11:34 - Strict mode default for new installs (v0.4.0) gated on lastUpdate, not strictMode-undefined

**Reasoning:** Initial fix for strict-default flipped existing v0.3 advisory installs whose strictMode was never written. Reviewer caught: existing manifests already had lastUpdate set by init/update, so isFreshInstall = (manifest.lastUpdate === undefined) is the correct gate. Only truly fresh inits get strictMode: true; existing installs preserved.

**Alternatives considered:** Always set strictMode=true regardless; require explicit --strict flag at init time

**Implications:**
- Existing v0.3.x advisory installs keep advisory behavior on re-init. Self-update workflow PR body announces the new default for repos that want to upgrade. Three regression tests in test/cli.test.js lock the contract.

---
## 2026-05-15 11:34 - Site responsive: stack plate as horizontal masthead at ≤600px instead of left-margin column

**Reasoning:** Desktop layout uses a 16rem left-margin plate column. On small viewports this squeezed the title into a thin strip. Audited at 375/480 with Playwright. Solution: at ≤600px, .plate becomes a flex row above the title block — full-width masthead showing plate label + scuttling bug. plate-gloss hidden as doc-noise on small screens.

**Alternatives considered:** Hide plate entirely on mobile; collapse plate-gloss only; redesign hero structure

**Implications:**
- Two media-query blocks added: ≤600px (single-column flow with masthead, page padding cut, title clamp lowered, footer stacks) and ≤380px (extra-tight tweaks for iPhone SE). Desktop layout pixel-identical above 600px.

---
