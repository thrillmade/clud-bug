← back to [docs/timeline.md](../timeline.md)

## 2026-06-08 17:46 - Phase 2 (W2): split lib/audit.js -> src/core/audit.ts + src/cli/audit.ts

**Reasoning:** Bug 9 wave 2 — sever git/FS-touching siblings (gitLines, computeAuditFileSet) from pure helpers (durationToGitSince, renderAuditHeader) so clud-bug-app can consume the latter without dragging child_process. Mirrors Wave 1's prompts.js/review-schema.js core extraction.

**Alternatives considered:** Keep one unified src/cli/audit.ts and re-export the pure helpers — rejected; App consumers would import a CLI module just for renderAuditHeader.

**Implications:**
- Pure audit helpers live in src/core/audit.ts (no FS, no git). CLI-only sibs in src/cli/audit.ts. bin/clud-bug.js points at dist/* (matches Wave 1 prompts pattern). Vitest plugin from Wave 1 ported here verbatim so test/ can resolve '.js' imports of '.ts' files; CTO will merge cleanly with Wave 1's identical copy.

---

## 2026-06-08 17:51 - Phase 2: port lib/prompts.js to src/core/prompts.ts

**Reasoning:** First of 5 zero-dep core conversions. Added TypeScript types: ReviewPromptLanguage union ('generic'|'ts'|'py'), ReviewPromptOptions interface (projectDescription required, language optional), internal ReviewPromptInput = Partial<ReviewPromptOptions> so callers can pass {} (test contract preserved — throws 'projectDescription is required' at runtime). LANGUAGE_HINT_BLOCKS typed Record<ReviewPromptLanguage, readonly string[]>. Template literal body byte-identical to JS source. vitest.config.ts gained a pre-resolver plugin so .js tests can import '../src/core/<name>.js' per architect spec — Vite 5's built-in swap only fires when the importer is .ts. bin/clud-bug.js + lib/update.js redirected to '../dist/core/prompts.js' (lib/ is being eliminated). Commit uses --stage scoped to avoid sweeping up the parallel src/{cli,core}/skills.ts WIP from another agent that's currently uncommitted on this branch.

**Alternatives considered:** Use .ts extension in test imports (rejected: deviates from architect's NodeNext-style .js-suffix spec), Keep lib/prompts.js as a re-export shim (rejected: architect's plan is to eliminate lib/ entirely)

**Implications:**
- src/core/index.ts now re-exports reviewPrompt + types; clud-bug/core consumers (via package.json exports map) can pull reviewPrompt from the dist barrel

---

