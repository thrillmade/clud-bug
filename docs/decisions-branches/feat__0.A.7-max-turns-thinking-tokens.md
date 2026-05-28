## 2026-05-28 09:19 - v0.6.8: --max-turns 15 + MAX_THINKING_TOKENS=8000 in workflow templates (Phase 0.A.7)

**Reasoning:** Two Anthropic-recommended cost-control knobs from code.claude.com/docs/en/costs applied to all 3 workflow templates: (1) --max-turns 15 via claude_args — caps the agentic loop, blocks runaway turn-storms. PR review usually finishes in 5-10 turns; 15 is a safe ceiling. (2) MAX_THINKING_TOKENS=8000 env var — caps extended-thinking budget per turn. Anthropic-recommended for review-shaped tasks; default is tens of thousands. Both are opt-out; conservative for the 95% case. Composite-pin bumped v0.6.7 → v0.6.8 in all 3 templates + the strict-mode-gate action.yml header example. +3 tests verify both knobs render in all 3 templates + composite-pin sync. 203 tests pass.

**Implications:**
- All consuming repos pick up both defaults via next composite-pin update. Override per-repo by editing workflow env vars if defaults don't fit (e.g., MAX_THINKING_TOKENS='16000' for a repo with denser architectural decisions in PRs).

---
