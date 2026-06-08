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

## 2026-06-08 18:01 - Phase 2: port lib/render-review.js to src/core/render-review.ts

**Reasoning:** Third of 5 zero-dep core conversions. SEVERITY_EMOJI uses Unicode escape literals (\u{1F534}/\u{1F7E1}/\u{1F7E3}/\u{1F41B}) for the byte-identical SPEC §6 contract — every step of the TS→JS toolchain preserves exact code points regardless of editor encoding. renderReview() typed as (data: RenderReviewInput | null | undefined): string where RenderReviewInput = Partial<ReviewData> & Record<string, unknown> — the renderer is the last line of defense against malformed JSON and degrades gracefully rather than throwing. Helper signatures locked: renderHeader, renderStatusLine, renderStatsHeader, renderPerSkillScan, renderDedicatedSection, renderFindings, renderSkillsReferenced, sanitizeCounts, numOrZero, locationAnchor, stripTrailingPunctuation. nonEmpty<T>() uses a type-guard return (arr is T[]) so downstream uses get narrowed array typing. SEVERITY_LABEL kept exported even though only SEVERITY_EMOJI is read internally — the JS source exposed the constant via module scope; preserve the public API. Byte-equivalence verified with /tmp/check-render-review.mjs across 14 synthetic ReviewData inputs (clean, critical, mixed, dedicated section, malformed counts, trailing-period summary, etc.) — all cases byte-identical to lib/render-review.js. bin/clud-bug.js runRender() redirected from ../lib/render-review.js to ../dist/core/render-review.js. 361/361 tests pass.

**Alternatives considered:** Throw on malformed JSON (rejected: schema-strict mode catches that upstream; renderer is defensive last-line per the 0.0.O design), Tight Pick<> types for each helper (rejected: would couple internal helpers to ReviewData's exact shape and break under schema bump-without-renderer-update — the JS code's permissive style is intentional)

**Implications:**
- src/core/index.ts now exports renderReview + SEVERITY_LABEL; clud-bug-app can renderReview(parsedJSON) without dragging the CLI bundle

---

