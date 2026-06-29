← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 23:21 - dogfood: populate clud-bug's own .clud-bug.json with the 4 baseline skills

**Reasoning:** The self-review manifest had installed:[] while skill dirs sat on disk, so the commit-review hook loaded 0 skill files. Populate installed[] to match 'clud-bug init' (the 4 baseline) so the dogfood reviews against real discipline.

**Alternatives considered:** Include clud-bug-brand-voice (the 5th on-disk skill) — rejected: it is not baseline and the recipe lists every installed slug, so it would apply naturalist-voice critique to code diffs, Teach the local recipe to honor applies_to and auto-load brand-voice for docs/site only — deferred (separate change)

**Implications:**
- review-prompt --trigger commit now resolves 4 skills (verified)
- Also gitignore .claude/settings.local.json so the local dogfood hook settings never get committed

---

