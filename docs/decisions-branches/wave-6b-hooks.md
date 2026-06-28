← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 16:40 - Add clud-bug init --with-hooks — native type:agent commit-review hook (Wave 6b PR C)

**Reasoning:** The final local-mode piece: scaffolds a native Claude Code type:agent PostToolUse hook into .claude/settings.json that, on every git commit the agent makes, spawns a BACKGROUNDED clud-bug review subagent on the session's OWN subscription (no API key). The hook prompt runs 'clud-bug review-prompt' and follows the engine recipe — dynamic, always current. Implies --with-local-review; clud-bug update refreshes our marked hook; off by default. Both non-negotiables met by construction (native Claude Code primitives + subscription-only).

**Alternatives considered:** Bake the static recipe into the hook (the earlier WIP MVP) — rejected per CEO: ship the hook ONLY in its planReview-driven form, so it reflects the repo's resolved plan and never goes stale.

**Implications:**
- type:agent is experimental (type:command + additionalContext fallback documented). Adversarial + self review caught + fixed: clobbering a malformed settings.json (now read-then-parse + skip), and dropping a user hook co-located in our entry (now preserved). Next: dogfood — install --with-hooks in clud-bug itself (needs a fresh session to load the hook). 841 tests green.

---

