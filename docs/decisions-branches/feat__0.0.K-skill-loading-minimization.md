## 2026-05-29 10:13 - 0.0.K: applies_to frontmatter — skill-filter for non-applicable PRs

**Reasoning:** Skills now carry an optional applies_to: { paths: [glob...], extensions: [ext...] } frontmatter block. lib/skills.js exports readAppliesTo + appliesToPr (12 new tests covering missing frontmatter, both list forms, OR semantics, single/double star, prose-mention-doesn't-fire, degenerate empty rule). lib/prompts.js gets a 10-line Skill applies_to section in the routing block instructing the LLM to scan frontmatter cheap, skip body when match is empty. Back-compat: skills without applies_to apply universally.

**Alternatives considered:** Pre-compute the applicable subset in the workflow and inject only matching skills into the prompt. Rejected: would break caching — the system prompt is the cached prefix, and varying it per-PR defeats the 10% cost cap. Instruction-level filter keeps the cached prefix stable; the LLM does the cheap frontmatter scan., Make applies_to mandatory for dedicated skills. Rejected: agent-skills' existing dedicated skills don't have it yet; making it required would break every installed dedicated skill until propagation.

**Implications:**
- Companion follow-up PR in agent-skills: add applies_to to brand-voice-review (UI paths/extensions), pii-and-compliance (logging/analytics/db paths), api-contract-enforcement (API paths), test-discipline (test files). Generic skills (critical-issues-only, evidence-based-review, respect-existing-conventions) stay un-scoped — universal review baselines.
- Prompt growth: +554 bytes / +10 lines for the applies_to section. Total prompt now 12765 / 282 — still well under the 14000 / 310 cap left after 0.0.P. Net Phase 0.5 trim still ~26.5% bytes vs pre-0.0.T.

---
