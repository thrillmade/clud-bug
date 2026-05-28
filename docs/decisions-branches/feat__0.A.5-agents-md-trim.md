## 2026-05-27 22:36 - Trim clud-bug's injected AGENTS.md block; move detail to bundled clud-bug-collaboration skill

**Reasoning:** Phase A.5 — every agent session in every consuming repo reads AGENTS.md at boot. Trim block from ~44 lines (~2.1K chars) to ~10 lines (~720 chars). Full rules move to the bundled skill which auto-loads on review. Compounds across all sessions in all consuming repos.

**Alternatives considered:** Keep block content as-is; rely on caching to make it cheap, Delete the block entirely

**Implications:**
- BLOCK_VERSION bumped v1 → v2 so consumers can detect schema change in their checked-in AGENTS.md
- Strict-mode toggle stays inline (repo-specific, varies per consumer)
- Next clud-bug update on consumers rewrites block to v2 idempotently

---
