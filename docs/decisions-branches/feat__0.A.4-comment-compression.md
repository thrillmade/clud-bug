## 2026-05-27 22:28 - Add stats header + severity-prefix + collapsible-reasoning comment format

**Reasoning:** Phase A.4 — write-time compression for clud-bug review comments. Stats header (Found: N 🔴 / N 🟡 / N 🟣) lets re-review agents short-circuit on zero findings. Severity-prefix per finding + <details> for reasoning halves what next agent re-ingests. Matches Anthropic Code Review's three-tier severity system.

**Alternatives considered:** Keep critical/minor binary split, Use color-only without emoji (worse for grep/scan)

**Implications:**
- Adds extractStatsHeader parser export — strict on emoji, permissive on whitespace
- Per-finding <details> blocks: humans see native render, agents skip token-cheaply
- Compounds with caching (0.A.2) + budgets (0.A.3): compresses third surface

---
