## 2026-05-29 01:21 - v0.6.16: output-token brevity directive in cached prompt (Phase 0.5 / 0.0.X)

**Reasoning:** Per LLM token optimization guide section 6: max_tokens should be capped per call type, but Claude Code CLI doesn't expose it (SDK is agent-shaped, not single-call). Workaround: explicit brevity instruction inside cached system-prompt appendix. New directive in lib/prompts.js (~8 lines): cap total output ~600 tokens; per finding 1-sentence claim + Reasoning ≤80 words + no code quotes >2 lines; omit reasoning that doesn't change verdict. Discipline, not hard cap — verbose review output costs the consuming repo on every review; brevity compounds across the org. +1 test asserts directive present. Composite-pin v0.6.15 → v0.6.16. 250 tests pass.

---
## 2026-05-29 08:56 - PR #108 regen derived docs after rebase

**Reasoning:** Post-rebase regen.

---
