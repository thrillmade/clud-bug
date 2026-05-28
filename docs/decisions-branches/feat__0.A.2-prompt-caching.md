## 2026-05-27 20:58 - Route clud-bug's review prompt into Claude Code CLI's auto-cached system layer via APPEND_SYSTEM_PROMPT env var

**Reasoning:** Phase A.2 — the biggest-ROI PR per research (10% input cost on cache hits). The 215-line prompt is byte-stable per-repo and naturally cacheable. Path: env.APPEND_SYSTEM_PROMPT (read by claude-code-action's run.ts and threaded into SDK's systemPrompt.append). User-message prompt becomes minimal directive.

**Alternatives considered:** Pass appendSystemPrompt via claude_args flag (shell-quote multi-line escaping is painful), Write prompt to a file + reference (no --append-system-prompt-file flag exists), Put prompt content in CLAUDE.md (would pollute user-facing docs)

**Implications:**
- Cache hits depend on byte-stable prefix; CI tests assert byte-equality
- show_full_output: true added to expose cache_*_input_tokens for measurement
- Next downstream PRs (0.A.3 budgets, 0.A.4 comment format) build on this structure

---
