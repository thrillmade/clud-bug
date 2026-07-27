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

**Reasoning:** Self-review of 7c0bcf6 (triggered by the commit-review hook) found a false-positive in my own new guard, confirmed by reproduction: the heading scan ran /^## \[/gm over raw text, so any "## [x]" line inside a fenced code block was read as a release heading. A CHANGELOG that DOCUMENTS a bad version — exactly what rc.27's own entry does about 0.7.NaN — would have red-CI'd a correct file. The guard is meant to catch a bad release, not a correct piece of documentation.

**Alternatives considered:**
- Reword the CHANGELOG to avoid the pattern — rejected: makes prose contort around a tool bug, and the next author hits it again
- Match a stricter heading shape, e.g. require a trailing date — rejected: couples the guard to entry formatting it has no business enforcing

**Implications:**
- Fenced blocks are stripped before scanning; both ``` and ~~~ delimiters handled, and an unclosed fence swallows the remainder (conservative, matches markdown)
- Verified with 3 controls that must STILL fail: a real bad heading, a bad package.json, and an unclosed-fence case — the fix does not blind the guard
- Process note: the original `logmind log` call was mangled by zsh globbing on unquoted parens/backticks in the -r/-a text. Repaired by hand. Quote logmind argument text.

---

## 2026-07-26 21:35 - check-version: honor CommonMark fence length so nested blocks do not close early

**Reasoning:** Adversarial self-review of the previous commit reproduced two edge cases. Case E, a 4-backtick block containing a 3-backtick sample, was a FALSE POSITIVE: the inner delimiter closed the outer fence early, so documentation inside it was scanned and flagged. That is the same red-CI-on-a-correct-file failure the fence-stripping was added to prevent. Case F, an unclosed fence hiding a later bad heading, is a silent miss but is CommonMark-correct behavior and matches how any renderer reads the file, so it is documented rather than worked around.

**Alternatives considered:** Leave it: nested fences are rare in a CHANGELOG. Rejected because the cost is three lines and the failure mode is a false red on a correct file, which erodes trust in the guard itself., Use a real markdown parser. Rejected: this runs before npm ci precisely so it needs zero dependencies.

**Implications:**
- A closing fence must now use the same character as the opening and be at least as long
- Control matrix of 6 cases, including one that must still FAIL, all behave as specified

---

