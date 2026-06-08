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

## 2026-06-08 17:55 - Phase 2: port lib/review-schema.js to src/core/review-schema.ts

**Reasoning:** Second of 5 zero-dep core conversions. Schema is a literal-typed JSON object (FINDING_ITEM, PER_SKILL_SCAN_ITEM, REVIEW_SCHEMA) consumed as raw JSON by the Agent SDK's --json-schema validator — typing every sub-shape would chain-couple downstream tests. Used a single structural alias JSONSchemaObject = Record<string, unknown> for the three constants. Added schema-derived runtime types (ReviewData, ReviewFinding, ReviewSummaryCounts, ReviewStatusHeader, FindingSeverity, PerSkillScanItem, DedicatedSection) that mirror the schema shape — these let render-review.ts type its renderReview(data: ReviewData) signature without re-deriving the types. serializedReviewSchema(): string return-type annotated. Byte-identical to JS source (verified by JSON.stringify diff). lib/render.js redirected to ../dist/core/review-schema.js. Build clean + 361/361 tests pass when other-agent WIP (src/cli/skills.ts) is stashed; --stage scoped commits only my files.

**Alternatives considered:** Inline the schema runtime types into render-review.ts only (rejected: they belong at the schema boundary so callers consuming clud-bug/core get types alongside the schema), Tight literal type for REVIEW_SCHEMA — 'as const' deep-narrowed (rejected: would propagate as-const ripples to consumers, no runtime benefit since the SDK validator only inspects shape)

**Implications:**
- src/core/index.ts now exports REVIEW_SCHEMA + serializedReviewSchema + 7 runtime types; render-review.ts (next commit) can import ReviewData from same-module without re-defining the shape

---

