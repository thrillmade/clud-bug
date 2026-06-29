← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 14:02 - rc.18: clud-bug init --local-only — max mode without the GitHub Action (no API key)

**Reasoning:** Prepping the F4 max-mode rollout caught that a plain 'clud-bug init' always writes the self-hosted GitHub Action workflows (clud-bug-review/audit.yml), which run claude-code-action with ANTHROPIC_API_KEY — per-token cost + double-review with the hosted App. For 'max mode everywhere' across our repos we want ONLY the local subscription path. New --local-only flag installs the slash command + the commit hook (implies --with-local-review + --with-hooks) but SKIPS all 3 Action workflows; the closing instructions + the --commit add-list drop the API-key + workflow references. Also a clean product command: 'clud-bug init --local-only' = clud-bug on your Claude Max subscription, no key, no bill.

**Alternatives considered:** Run plain init then rm the workflows — rejected: fragile, could delete legit workflows. A flag is the correct reusable primitive

**Implications:**
- New rc.18 (lockstep bump). [CEO] publish v0.7.0-rc.18 → then the F4 rollout runs 'npx clud-bug@rc.18 init --local-only' across the 8 Action-free repos

---

