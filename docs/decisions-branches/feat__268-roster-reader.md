← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 21:36 - Review passes resolve to dispatched roles from the agent roster; the tier config becomes the deprecated fallback (#268)

**Reasoning:** A pass is a dispatched role from .claude/agents, not a mode of the reviewer. The reader in core parses every entry, reports malformed ones by file and reason instead of dropping them, and never reads a body into a prompt. Resolution runs inside the one shared planner so the hosted App and local mode cannot diverge, an entry wins by exact name and carries its pinned model, and the beetle wasp mantis tiers stay only for a role the roster does not cover, marked deprecated with removal written as the follow-up. The plan renderer prints which file each pass resolved to, including entries that omit a model, and warns on problems. The catalog side is filed as agent-skills#278 with the corrected validator citation.

**Alternatives considered:** Resolve the roster only in the CLI renderer (rejected: SPEC 4.3 requires one shared planner), Delete the tiers now (rejected: no ruling orders it; the roster is empty in every real repo until the catalog ships)

**Implications:**
- Every repo runs on the tier fallback until .claude/agents is seeded
- plan-review.ts gained a roster field as the glue between reader and planner

---

