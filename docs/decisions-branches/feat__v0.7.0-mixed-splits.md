← back to [docs/timeline.md](../timeline.md)

## 2026-06-08 17:46 - Phase 2 (W2): split lib/audit.js -> src/core/audit.ts + src/cli/audit.ts

**Reasoning:** Bug 9 wave 2 — sever git/FS-touching siblings (gitLines, computeAuditFileSet) from pure helpers (durationToGitSince, renderAuditHeader) so clud-bug-app can consume the latter without dragging child_process. Mirrors Wave 1's prompts.js/review-schema.js core extraction.

**Alternatives considered:** Keep one unified src/cli/audit.ts and re-export the pure helpers — rejected; App consumers would import a CLI module just for renderAuditHeader.

**Implications:**
- Pure audit helpers live in src/core/audit.ts (no FS, no git). CLI-only sibs in src/cli/audit.ts. bin/clud-bug.js points at dist/* (matches Wave 1 prompts pattern). Vitest plugin from Wave 1 ported here verbatim so test/ can resolve '.js' imports of '.ts' files; CTO will merge cleanly with Wave 1's identical copy.

---

