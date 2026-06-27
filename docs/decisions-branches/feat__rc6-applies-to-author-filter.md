← back to [docs/timeline.md](../timeline.md)

## 2026-06-27 16:16 - Wave 4e.2 (rc.6) — extend SkillFrontmatter + appliesToAuthor helper

**Reasoning:** SPEC v0.5.1 §1.10.1 adds applies_to.author for skill filtering by PR author. rc.6 implements the consumer-side surface: SkillFrontmatter type extended with kind + voice_scope + applies_to.author (the Wave 4d reviewer-flagged silent-drops are now first-class), parseFrontmatter populates them, new exported appliesToAuthor helper mirrors appliesToPr signature for callers that need the strict-AND filter combination. Bumps 0.7.0-rc.5 → rc.6. strict-mode-gate pins in 3 workflow templates + action.yml header bumped to match.

**Alternatives considered:** Validate kind/voice_scope strictly (throw on unknown values) — rejected: lenient surface (undefined on unknown) matches the parser's existing pattern + lets unknown future SPEC values degrade gracefully, Add separate appliesToVoiceAuthor / appliesToConventionsAuthor helpers — rejected: the SPEC field is kind-agnostic; one helper is the natural fit, Compose paths + author filtering inside a single appliesToBoth helper — rejected: separate helpers keep the AND composition explicit at the call site (consumer decides ordering + short-circuit)

**Implications:**
- appliesToAuthor reads raw skill content via regex (mirrors appliesToPr/readAppliesTo pattern); doesn't require pre-parsed frontmatter. Caller can use whichever path is convenient.
- v0.5.0 consumers reading a v0.5.1 SKILL.md silently ignore applies_to.author (parser drops unknown keys); rc.6 is the first consumer that enforces the filter
- 16 new tests: 5 for kind/voice_scope frontmatter surface, 3 for applies_to.author parse, 8 for appliesToAuthor helper (matching/non-matching/quoted/no-filter/no-frontmatter/empty-author/non-string-input)

---

