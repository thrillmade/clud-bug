## 2026-06-01 08:40 - clud-bug v0.6.31: hotfix — upload-artifact excludes hidden files (v0.6.29-30 silent breakage)

**Reasoning:** Discovered during dogfood validation that ZERO clud-bug-skill-usage artifacts existed across the entire org despite the workflow steps reporting success. Root cause: actions/upload-artifact@v4 excludes hidden files by default; .claude/ and .clud-bug.json are both dot-prefixed. The step printed warning 'No files were found' but continue-on-error: true masked it as success. v0.6.30's cross-review aggregation made the breakage observable — without that dashboard, the bug would have lurked indefinitely. Fix: add include-hidden-files: true to all 3 workflow templates' upload step.

**Alternatives considered:** Move .clud-bug.json out of .claude/ (rejected: breaks existing v0.6.28 dashboard read path + agent-skills SKILL.md path conventions), Use action.yml composite-action wrapper that pre-stages files to a non-hidden path (rejected: heavy refactor for a one-line config change)

**Implications:**
- v0.6.30's dashboard placeholder still says 'no usage data yet' for repos with no successful artifacts — which is now correct since the v0.6.31 hotfix is the FIRST version that actually uploads. After propagation, v0.6.31's reviews will be the first to produce artifact data
- Lesson: continue-on-error: true + warn-not-error is a silent-failure pattern. Consider adding a smoke-test that asserts artifact upload non-empty in v0.6.32+
- v0.6.29 and v0.6.30 are NOT broken-as-shipped — the architecture works. Only the upload step config was wrong. The CLI, the aggregation logic, the dashboard read path all function correctly when given real artifact data

---
