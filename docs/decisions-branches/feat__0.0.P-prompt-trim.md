## 2026-05-29 09:54 - 0.0.P: trim review prompt by ~29.6% bytes / ~25% lines without removing must-contain phrases

**Reasoning:** lib/prompts.js trimmed from 17351 bytes / 366 lines to 12211 bytes / 272 lines. Golden gate (0.0.E) catches any must-contain phrase that drops — all pass. Target sections audited for filler-pattern prose (per LLM token optimization guide § 6: imperative reformulations, polite hedging, multi-paragraph rationale for short rules). Major trims: section budgets intro (-3 lines), CRITICAL — identifying the PRIOR SUMMARY (-5 lines), span check (-2 lines), skill routing prose (-8 lines), incremental-diff handshake (-4 lines), INLINE REVIEW THREADS surface (-15 lines), counters bullet block (-9 lines), stats header + per-finding (-15 lines), FIX-PUSH FLOW footer (-8 lines). Each trim preserves: literal example formats (code blocks unchanged), must-contain.json regex anchors, must-not-contain anti-patterns, exit/entry conditions for the surrounding sections. Test updated: test/prompts.test.js line 95 'Section budgets \(token-frugal review\)' → 'Section budgets \(v0\.6\.4\+\)' to match the trimmed header.

**Alternatives considered:** Hold trim until after measurement data shows actual savings — rejected because the prompt was being modified by 0.0.T and 0.0.X concurrently. Stabilizing structure first, measuring after, is cheaper than doing it in reverse., Per-section iterative trim PRs (0.0.P.1, 0.0.P.2, etc.) — rejected because single-PR scope is the prompt and the test coverage. Each trim subsection is small enough that the whole PR is reviewable in one pass.

**Implications:**
- Golden byte-budget caps LOWERED to lock in the savings: max_prompt_bytes 18500 → 14000 (~1.8 KB headroom for 0.0.O); max_prompt_lines 380 → 310 (~38 lines headroom for 0.0.O). Without the lower cap, future additions would invisibly refill the freed budget. Documented in why-field + CHANGELOG.
- Cache-prefix economics: the trimmed system prompt is the new cached prefix. Cache write cost shrinks proportionally (only paid 1× per 5-min window, but smaller is still cheaper). Cache hit cost (10% of standard) drops by the same ~30%.
- Composite-pin lock-step bumps 0.6.18 → 0.6.20 (skipping 0.6.19 since #111's release branch will land first if it hasn't already).

---
