← back to [docs/timeline.md](../timeline.md)

## 2026-07-26 21:31 - Fix 0.7.NaN on main; cut rc.27; add SemVer validity guard

**Reasoning:** clud-bug#251 (automated skills refresh from agent-skills) bumped package.json with logic assuming X.Y.Z. On the prerelease 0.7.0-rc.26 that yielded a literal 0.7.NaN in package.json AND a CHANGELOG heading. CI went RED (release-discipline caught it) but the PR merged anyway — org-wide required_status_checks were removed 2026-07-24, so a red test no longer blocks. Crucially release-discipline caught it only incidentally, by noticing composite pins no longer matched package.json; a bad bump that also rewrote the pins would have been self-consistent and gone green. So we needed a validity check, not just a consistency check.

**Alternatives considered:** Revert #251 entirely — rejected: its content (skill refresh + BASELINE_SKILLS_REF pin) is correct and wanted; only the version bump was wrong, Rely on release-discipline alone — rejected: it tests consistency, which a uniformly-wrong bump satisfies, Fix upstream only — insufficient: upstream is already fixed (agent-skills no longer assigns versions), but that does not repair the value already on main

**Implications:**
- scripts/check-version.mjs validates package.json + every CHANGELOG '## [x]' heading against the official SemVer grammar; runs before npm ci so it fails in seconds
- Version 0.7.0-rc.27; all four strict-mode-gate composite pins synced (3 templates + action.yml docstring)
- OPEN GOVERNANCE GAP: a red CI check does not block merge anywhere in the org. The guard reports; it cannot stop. Requiring checks is the CEO's deferred Z7 decision.

---

## 2026-07-26 21:33 - check-version: skip fenced code blocks when scanning CHANGELOG headings

**Reasoning:** Self-review of 7c0bcf6 (the commit-review hook) found a false-positive in my own new guard, confirmed by reproduction: the heading scan used /^## \[/gm on raw text, so any '## [x]' line inside a  and ~~~ both handled, unclosed fence swallows the remainder (conservative, matches markdown)

**Implications:**
- Verified with 3 controls that must STILL fail: a real bad heading, a bad package.json, and an unclosed-fence case — the fix does not blind the guard

---

