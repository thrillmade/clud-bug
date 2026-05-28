## 2026-05-27 20:41 - Extract clud-bug review prompt to lib/prompts.js (single source of truth)

**Reasoning:** Phase A.1 of the token-cost compression roadmap. The 215-line prompt previously lived inline in 3 templates; extracting to a function unlocks v0.6.3 (Anthropic prompt caching via appendSystemPrompt) and v0.6.4 (per-section budgets), both of which need a programmable prompt structure.

**Alternatives considered:** Keep inline + duplicate prompt edits 3x for each downstream change, Use a templating macro instead of a JS function

**Implications:**
- render.js becomes indent-aware for multi-line substitutions (additive; single-line behavior unchanged)
- templates shrink from ~300 lines to ~70-108 (no per-line semantic change)
- next PRs (0.A.2 caching, 0.A.3 budgets, 0.A.4 comment compression) edit one function instead of three templates

---
