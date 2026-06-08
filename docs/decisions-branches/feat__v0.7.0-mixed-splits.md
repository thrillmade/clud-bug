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

## 2026-06-08 18:01 - Phase 2 (W2): split lib/skills.js -> src/core/skills.ts + src/cli/skills.ts (+ _internal promotion)

**Reasoning:** Bug 9 wave 2 — split the 749 LOC mixed-domain skills module. Pure pieces (SkillsClient, rankAndCap, frontmatter parsing, comment-extraction helpers, classifier) live in src/core/ so clud-bug-app can ship them server-side without node:fs. CLI install/update helpers (loadBaseline, manifest read/write, removeSkill, listInstalled, diffManifest) stay in src/cli/.

**Alternatives considered:** Keep loadBaseline in core (network only, no FS) — rejected because the cacheDir fallback to ~/.cache/clud-bug/skills uses homedir() + writeFile; lifting it would mean splitting one function into a core 'fetch' + cli 'cacheWrap' and that's more architecture than the App needs right now.

**Implications:**
- Lib/skills.js _internal debug-export removed: MAX_SKILLS + API_BASE + normalizeList are first-class core exports; sanitizeSlug + entryKey + MANIFEST_FILE are first-class cli exports. Tests import directly (no more _internal.X gymnastics). bin/clud-bug.js + lib/update.js point at dist/* (matches audit-split + Wave 1 prompts pattern). Vitest plugin extended to strip ?query cache-busters before .js→.ts resolution (skills.test.js uses '../src/cli/skills.js?base-a' for fresh-import tests).

---

## 2026-06-08 18:04 - Phase 2: complete the render-review.ts conversion (commit 7909aa1 follow-up)

**Reasoning:** Follow-up to 7909aa1, whose title was 'port lib/render-review.js' but whose body landed the other-agent's skills.js W2 split. The actual render-review work landed in this commit. Contents: src/core/render-review.ts (the converted file with Unicode escape literals for SPEC §6 emoji conformance, RenderReviewInput = Partial<ReviewData> & Record<string, unknown> typing on renderReview, type-guard nonEmpty<T>(): arr is T[]), src/core/index.ts gains renderReview + SEVERITY_LABEL exports, test/render-review.test.js imports from src/core/, bin/clud-bug.js runRender() redirected to ../dist/core/render-review.js, lib/render-review.js deleted. Byte-identical to JS source across 14 synthetic test inputs. 361/361 tests pass.

**Alternatives considered:** Rewrite history to fix 7909aa1's misnamed body (rejected: branch is already pushed; rewriting would force-push and clobber the other agent's W2 commit on top)

**Implications:**
- src/core/index.ts now exports renderReview + SEVERITY_LABEL — clud-bug-app's review post-step can do renderReview(parsedJSON) via the clud-bug/core barrel without dragging the CLI bundle

---

## 2026-06-08 18:08 - Phase 2: port lib/detect.js to src/core/detect.ts (+ _internal anti-pattern fix)

**Reasoning:** Fourth of 5 zero-dep core conversions. Removed the _internal namespace anti-pattern per architect guidance: EXT_TO_LANG, DEP_TO_TERM, PY_DEP_TO_TERM are now direct top-level exports, and fileHistogram + firstParagraph are individually named exports (no more _internal.fileHistogram calls — tests import directly). Each constant table is typed `as const satisfies Record<string, string>` so consumers see the literal-string narrowing AND the safety check that all keys are strings. Used structural types: DetectedSignals interface (the public detect return shape: name, description, languages, histogram, searchTerms, primaryLanguage) and DescriptionLineSignals (the wider input shape buildDescriptionLine accepts). Helper-type DetectorResult kept module-private. readJsonSafe made generic so detectFromPackageJson PackageJson narrows correctly. Type-guard `(r): r is DetectorResult => r !== null` lets TS narrow results to non-null. noUncheckedIndexedAccess: line.split(...)[0] returns string | undefined, used `?? ` and trim. Dep-table lookups cast via TABLE as Record to allow runtime variable keys. test/detect.test.js imports fileHistogram directly + drops _internal. 361/361 tests pass.

**Alternatives considered:** Keep _internal namespace for back-compat (rejected: architect explicitly called this an anti-pattern; the fix is part of the migration value), Tight readonly Records (rejected: would force readonly propagation onto every caller; const satisfies gives the narrowing without the readonly contagion)

**Implications:**
- src/core/index.ts now exports detect, buildDescriptionLine, all three dep-tables, fileHistogram, firstParagraph, plus DetectedSignals/DescriptionLineSignals — clud-bug-app can call detect(root) without dragging in any CLI logic

---

## 2026-06-08 18:11 - Phase 2: port lib/render.js to src/core/render.ts (+ package.json path fix for dist depth)

**Reasoning:** Fifth and final of 5 zero-dep core conversions. KEY RISK addressed: lib/render.js used join(__dirname, ..., package.json) which assumed __dirname was lib/ (one level deep). After compile to dist/core/render.js, __dirname is dist/core/ (two levels deep), so the path must walk up TWO levels: join(__dirname, .., .., package.json). Verified at runtime via node -e import dist/core/render.js then DEFAULTS.CLUD_BUG_VERSION → 0.6.35. Types added: RenderDefaults interface (CCA_VERSION, CLUD_BUG_VERSION, REVIEW_SCHEMA — the schema-string forwarded from review-schema.ts), RenderVars = Partial<RenderDefaults> & Record<string, unknown> (callers freely pass non-default tokens like REVIEW_PROMPT), TemplateLanguage union ts | py | generic for templateLanguage() return. PKG_VERSION typed as string via JSON.parse cast. render() callback params explicitly typed: (_match, key: string, offset: number). noUncheckedIndexedAccess effect: leadingWhitespaceMatch[1] gets the ?? guard. lib/update.js + bin/clud-bug.js redirected to ../dist/core/render.js. test/render.test.js, test/prompts.test.js, test/update.test.js, test/cli.test.js all imports updated. 361/361 tests pass. 5/5 conversions complete; reading next from src/core/index.ts barrel.

**Alternatives considered:** Embed __dirname computation in DEFAULTS literal instead of module scope (rejected: loses module-load semantic — DEFAULTS becomes a getter call ratio of runtime cost), Pass package.json path via an env override (rejected: silently hides the depth mismatch — better to fail loudly with the fixed path so a future relocation surfaces fast)

**Implications:**
- src/core/index.ts now exports the full render API (render, renderFile, pickTemplate, templateLanguage, DEFAULTS) + 3 types. 5 of 5 core files converted. lib/ has only the impure CLI helpers left: agents-md.js, branch-protection.js, edit-workflow.js, skill-usage.js, update.js, usage.js. clud-bug-app can pull the entire core/ surface through dist/core/ now: prompts, schema, renderer, detector, template-render — every step of the review flow except the CLI/app glue.

---

## 2026-06-08 18:16 - Phase 2 (W3): port lib/branch-protection.js to src/cli/branch-protection.ts

**Reasoning:** Wave 3 starts with the smallest CLI-only file (113 LOC, gh CLI helpers). Modeled types after the audit/skills wave: discriminated unions for ProtectionState and EnableResult give callers exhaustiveness on switch; GhInvoker is the pluggable shape both runtime and tests use. spawn() stdio streams asserted non-null since we configure 'pipe' for all three.

**Alternatives considered:** Throwing on non-zero gh exit (rejected — existing code intentionally returns discriminated states so runInit can branch on user-facing copy).

**Implications:**
- src/cli/index.ts now exports the branch-protection surface (4 functions + 9 types). bin/clud-bug.js updated to import from dist/cli/branch-protection.js (matches the dist/ pattern audit/skills already use).

---

## 2026-06-08 18:17 - Phase 2 (W3): port lib/edit-workflow.js to src/cli/edit-workflow.ts

**Reasoning:** 47 LOC, smallest file in the wave. spawnSync.{stdout,stderr} are 'string | null' under strict NodeNext — coalesced with ?? '' at each call site to keep semantics identical. .pop() on array-of-string typed as possibly-undefined under noUncheckedIndexedAccess; coalesce + trim guards both.

**Alternatives considered:** Switch to async spawn() and Promise-wrap like branch-protection (rejected — current sync semantics are intentional; getPendingWorkflowEdits is called inline before commit and parallel git status doesn't add value).

**Implications:**
- src/cli/index.ts now exports getPendingWorkflowEdits + isWorkflowFile + makeBranchName + git plus 3 types. bin/clud-bug.js switched to dist/cli/edit-workflow.js.

---

## 2026-06-08 18:20 - Phase 2 (W3): port lib/agents-md.js to src/cli/agents-md.ts

**Reasoning:** 230 LOC of markdown-block management (renderBlock, upsertBlock, removeBlock, applyToRepo). RenderBlockOptions all-optional with explicit undefined per exactOptionalPropertyTypes. hasAgentsMdImport keeps its unknown input type so call sites that flow data from JSON.parse do not have to assert at the boundary. lib/update.js temporarily imports from dist/cli/agents-md.js (will switch to relative src/cli when update.js converts in file 6).

**Alternatives considered:** Make ALWAYS_TOUCH / TOUCH_IF_PRESENT exported readonly tuples (rejected, internal contract).

**Implications:**
- src/cli/index.ts now exports the agents-md surface (6 functions + 2 types). lib/update.js bridge updated to dist/cli/agents-md.js.

---

## 2026-06-08 18:22 - Phase 2 (W3): port lib/skill-usage.js to src/cli/skill-usage.ts

**Reasoning:** 432 LOC of pure data-layer functions (computeSkillUsageDelta, mergeSkillUsage, assessSkillHealth) plus gh-runner-driven artifact fetch (v0.6.30). Typed the discriminated union SkillHealthStatus exhaustively; statusOrder is Record<SkillHealthStatus, number> so future additions are caught at compile time. Input shapes use `unknown` + narrow guards (typeof === object/string) at the boundary to preserve the JS defensive semantics for malformed review JSON. GhRunner is a structural interface so DEFAULT_GH_RUNNER and test mocks share one type.

**Alternatives considered:** Tighten reviewJson to a concrete schema type (rejected — current consumers feed raw structured-output JSON whose shape varies across review-schema versions; coercion at the boundary is the right place).

**Implications:**
- src/cli/index.ts now exports 7 functions + 9 types from skill-usage. bin/clud-bug.js dynamic imports updated to dist/cli/skill-usage.js at all 3 call sites (runUpdateSkillUsage, runUsageHealth, loadUsageFromArtifacts). All 3 test files updated to ../src/cli/skill-usage.js.

---

