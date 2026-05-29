## 2026-05-29 09:01 - v0.6.17: golden-set regression gate for review prompt (Phase 0.5 / 0.0.E)

**Reasoning:** Gating PR for 0.0.P (prompt trim) and 0.0.O (JSON schema enforcement) — both ship next under this guard. Three categories of structural check on the rendered prompt, all CI-runnable without LLM execution: (1) must-contain — 17 instruction phrases that load-bearing CI relies on (severity tiers, comment format, MAX_*_BYTES budgets, last-reviewed-sha handshake, git merge-base ancestor check, brevity directive, FIX-PUSH FLOW, resolveReviewThread, Skills referenced footer); (2) must-not-contain — 8 anti-pattern filler phrases from LLM token optimization guide §6 ('Please make sure to', 'I would like you to', etc.); (3) byte-budget — 16 KB / 360 lines caps with documented headroom. New test/golden/ directory with 3 JSON fixtures + README explaining the format and when to update. New test/prompts.eval.test.js with 6 tests. Live LLM behavior NOT tested — too expensive for every-PR CI; lives in future 'clud-bug eval --live' flow. The structural check is enough to safely ship 0.0.P + 0.0.O. Composite-pin bumped v0.6.16 → v0.6.17. 256 tests pass.

**Implications:**
- Adding must-contain entries when shipping new load-bearing instructions; adding must-not-contain when finding new filler patterns; bumping byte-budget after major structural changes with CHANGELOG notes. 0.0.P (prompt trim) and 0.0.O (--json-schema) PRs unlock once this lands.

---
