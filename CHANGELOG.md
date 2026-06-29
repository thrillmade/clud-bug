# Changelog

All notable changes to clud-bug. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0-rc.15] — 2026-06-29

Design-critic lens (B1) — the skill-driven review thesis pointed at pixels. OPTIONAL and
off by default.

### Added

- **`kind: design` skills** (`core/skills.ts`) — a third skill lens alongside `rule` /
  `voice`. Design skills review the *rendered* surface (screenshots) rather than the diff
  text; they need no `voice_scope`. Ships a 3-skill design baseline kit under
  `templates/skills/design/` (`design-system-consistency`, `visual-polish`, `frontend-a11y`)
  encoding an elite bar (token/color discipline, optical centering & spacing, glyph/pattern
  quality, light/dark parity, contrast/focus/tap-target a11y) and told to flag
  "fine but not elite," not only broken.
- **`core/design.ts`** — `readDesignConfig` (the `.clud-bug.json` `design` block; default
  `{ enabled: false, gate: 'advisory', themes: ['light','dark'], viewports: ['desktop'] }`)
  and `shouldRunDesign` (pure gate: opted-in + design skills present + `pr` trigger). A typo
  can never silently *enable* the cost-bearing pass.
- **`review-prompt` design-critic step** — when the gate passes, the local recipe emits an
  optional "## 3b. Design-critic" step: find the deploy-preview URL, render the changed
  routes (light + dark) via a browser MCP, and critique the screenshots against the design
  skills (`<!-- pass: design -->`). Defers to runtime — no preview URL or no browser MCP →
  skipped silently. Code (`kind != design`) and design skills are partitioned: code skills
  drive the multi-pass plan, design skills drive this step.
- `refresh` now preserves installed `kind: design` skills (like baseline), so a re-sync
  can't drop a repo's design kit.

### Notes

- v1 is **local + advisory**. A repo opts in via the `design` block + installed design
  skills. The `clud-bug init --with-design` installer and the hosted Vercel-Sandbox render
  path (which feeds screenshots to AI-Gateway vision) are follow-ups. rc.15 → `next`.

## [0.7.0-rc.14] — 2026-06-28

6c — the conditional Mantis arbiter (the decision lives in `core`; consumers wire the pass).

### Added

- **`shouldEscalate(...)` in `core/multi-pass-aggregate.ts`** — a pure gate that returns true
  only when a 2-pass `cross-check` disagreed on a `critical` or `minor` Pass-1 finding (the
  SPEC §6.10.1 `arbitrated` case). It reads the verdicts Pass 2 already produced — no I/O, no
  AI call. Scope: cross-check only, exactly `passCount === 2` (a statically-configured 3-pass
  plan already runs Mantis as pass 3 via the loop), severity `critical | minor` (a
  `preexisting` dispute can't flip the merge gate, so it doesn't earn an Opus arbiter).
  Authority is marker-only — the arbiter sets the disputed finding's consensus marker +
  rationale; it does not change which findings gate the merge (that stays `resolveVerdict`).
  Exported from `core` so the hosted bot and the local recipe share one decision (SPEC §11.5).
- **`review-prompt` recipe describes the arbiter.** A 2-pass cross-check plan now appends a
  conditional "dispatch a 3rd Mantis arbiter on disagreement" paragraph, gated to
  `cross-check` + exactly 2 passes so 3-pass / consensus plans don't get redundant prose.

### Notes

- The 2-pass cross-check default ships as a **Team-tier repo default in the hosted app**, not a
  `BUILTIN_DEFAULT` flip — OSS / free / Solo keep the 1-pass floor (small commits/diffs still
  tier down to 1). rc.14 publishes to the `next` dist-tag.

## [0.7.0-rc.13] — 2026-06-28

Wave 6b — SPEC render conformance + the hook version-pin.

### Fixed

- **SPEC §6.8.1 / §6.10.1 markers (NORMATIVE) now rendered.** `renderMultiPassMarkdown`
  emits a `<!-- pass: <id> -->` attribution comment (the originating pass, lowercased) and,
  for gated findings, a `<!-- consensus: 1-of-N | 2-of-2 | arbitrated -->` comment immediately
  before each finding's bullet. The auto-fix gate (§6.10.2) was already safe (reads
  `finding.consensus` directly); this closes the auditable/dashboard-parseable output gap.
- **`init --with-hooks` pins the clud-bug version** in the commit-review hook prompt
  (`npx clud-bug@<version> review-prompt`). A bare `npx clud-bug` resolves to the `latest`
  dist-tag, which can predate the `review-prompt` verb while v0.7 is prerelease on `next` —
  pinning guarantees the verb resolves. `clud-bug update` refreshes the pin in place.

## [0.7.0-rc.12] — 2026-06-28

Wave 6b (PR 0) — shared review engine extracted into `core` (single source of truth).

### Added

- **`core/review-plan.ts`, `core/budget-plan.ts`, `core/multi-pass-aggregate.ts`** —
  clud-bug's review-planning brain now lives in the shared package, ported behavior-identically
  from `clud-bug-app/lib` (the App's unit suites ported alongside; 77 new tests):
  - `resolveReviewPasses` — per-skill multi-pass resolver with the `.clud-bug.json` perSkill →
    SKILL.md `review_passes` → repo-default → builtin precedence chain and the `MAX_PASSES=3` cap.
  - `estimateBudget` — Layer-1 pre-flight cost gate (`Σ(skill_loads × passes) × worst-case ceiling`).
  - `aggregatePasses` + `resolveVerdict` — cross-check / consensus / independent aggregation and
    the §1.8.5 APPROVE/REQUEST_CHANGES table; `consensus` rides the canonical `UnifiedFinding`.
  This is the foundation the hosted bot, the npm workflow, and local mode all consume. Adds a
  `beetle | wasp | mantis` `tier` on `ReviewRole` (concrete model binding stays consumer-side).
  Additive — no existing consumer behavior changes; `resolveReviewPasses` is decoupled from the
  App's `LoadedSkill` (takes a minimal `{ slug, frontmatter }`).
- **`core/plan-review.ts` — `planReview`** (SPEC §11.5): the single shared entry point that
  composes `resolveReviewPasses` + `estimateBudget` and applies trigger / diff-size tiering —
  `trigger: 'commit'` (or a diff over `LARGE_DIFF_THRESHOLD_BYTES`) tiers down to a single fast
  (`beetle`-tier) pass; otherwise the full multi-pass plan. Every consumer plans through this one
  function, so the fast-vs-deep choice falls out of the tier system — never hand-picked per call.
- **`clud-bug review-prompt [--trigger commit|push|pr]`** — emits the local-review *recipe*:
  the structured prompt a Claude Code agent (or a `type: agent` hook) runs to review the current
  diff on the session's own subscription. It loads the repo's skills + `.clud-bug.json`, plans via
  `planReview`, and renders a plan-aware recipe — a single fast pass on `commit`, the full
  multi-pass fan-out (with the resolved tiers + aggregation mode) on `push`/`pr`. The dynamic,
  engine-driven counterpart of the rc.11 static `/clud-bug-review` slash command.
- **`clud-bug init --with-hooks`** (off by default) — scaffolds a native Claude Code `type: agent`
  commit-review hook into `.claude/settings.json` (merged non-clobbering, preserving existing
  settings + hooks). On every `git commit` the agent makes, a **backgrounded** (`async`) review
  subagent runs on the session's **own subscription** — its prompt simply runs `clud-bug
  review-prompt` and follows the engine recipe, so it's always current. Implies `--with-local-review`;
  `clud-bug update` refreshes our marked hook in place. (`type: agent` is experimental; a `type:
  command` + `additionalContext` fallback reaches the same outcome on stable primitives.)

## [0.7.0-rc.11] — 2026-06-28

Wave 6b — local review mode (slash-command MVP).

### Added

- **`clud-bug init --with-local-review`** scaffolds `.claude/commands/clud-bug-review.md`,
  so `/clud-bug-review` works inside a Claude Code session: the agent loads the repo's
  review skills, fetches the PR diff via `gh`, reviews against the skills using **that
  session's own tokens** (Max or API), and posts/updates a clud-bug-format comment — no
  hosted App, no new auth. The local-mode comment carries a `written-by: @<login>
  (clud-bug local-mode)` marker so the bot's auto-resolve never treats it as `clud-bug[bot]`.
- `templates/clud-bug-review.md.tmpl` (new); `clud-bug update` refreshes a scaffolded
  command in place when it carries the `<!-- clud-bug-local-version: -->` marker, and
  leaves a user-customized (markerless) copy untouched.

### Notes

- This is the slash-command MVP; the optional `clud-bug-mcp` structured-tool package and
  the pre-push hooks are designed but pending CEO sign-off (package location, hook
  cache-skip behavior, conformance-level naming) and ship in follow-up PRs.

## [0.7.0-rc.10] — 2026-06-28

Wave 6a — SPEC v0.5.1 conformance closure.

### Added

- **§6.6 conformance-fixture gate** — `fixtures/reviews/<scenario>/{input.json,
  expected.md}` for 5 canonical scenarios (clean, critical-only, mixed-severities,
  resolved-from-prior, dedicated-section). `scripts/fixture-check.mjs` renders each
  `input.json` through `renderReview` and asserts byte-identity with the committed
  golden (`--update` regenerates). Wired into CI as `npm run test:fixtures`, so a
  renderer change that alters the comment shape now fails the build until the
  goldens are reviewed + regenerated.

### Changed

- **§3.23.1 `configure-github` status payload** — the idempotent no-op now prints
  `alreadyCanonical: true rulesetVersion: v1` as named fields (was embedded prose),
  satisfying the NORMATIVE §3.23.1 contract. New `--json` flag emits the payload as
  JSON for machine consumption across all outcomes.

## [0.7.0-rc.9] — 2026-06-28

Graceful PAT-or-fallback auto-resolve (Wave 5b.1). The `resolveReviewThread`
GraphQL mutation can't run under the Actions `GITHUB_TOKEN` ("Resource not
accessible by integration"); rc.9 makes that path graceful and adds an opt-in
PAT for true auto-close.

### Added

- **`CLUD_BUG_RESOLVE_PAT` secret (optional)** — workflow templates pass it to
  the `resolve-threads` step. Present → the step closes verified threads like the
  hosted App; absent → graceful "verified fixed" reply only. The CLI reads
  `CLUD_BUG_RESOLVE_PAT` (alias `RESOLVE_PAT`) and scopes it to just the resolve
  mutation; all other `gh` calls keep `GH_TOKEN`.
- **`selectResolveAuth` / `anchorSignature` / `renderResolveMarkerTag` /
  `parseResolveMarkerTag` / `latestResolveMarker`** pure helpers in
  `src/core/auto-resolve.ts` (unit-tested).

### Changed

- **`src/cli/main.ts::runResolveThreads`** — the no-PAT path posts an accurate
  "✅ Verified fixed — not auto-closed" reply (instead of claiming
  "Auto-resolved") and skips the resolve mutation; the PAT path resolves with the
  PAT scoped to that one call.
- **Idempotency** — each auto-resolve reply carries a hidden
  `<!-- clud-bug-resolve v=… sig=… -->` marker. On later fix-pushes a thread whose
  anchor is unchanged is skipped (no re-verify, no re-reply), so multi-push PRs
  don't get repeat replies and verifier spend is saved. A cached ADDRESSED thread
  is still resolved if a PAT becomes available (no-PAT→PAT upgrade, or a prior
  transient resolve-failure) without re-posting. `REVIEW_THREADS_QUERY` now fetches
  `comments(first: 100)` to see prior replies; the anchor signature is 16 hex chars
  (matching `findingId`).

### Why

Wave 5b smoke confirmed the verifier core works but `resolveReviewThread` is
blocked for the Actions token. PAT-optional + always-graceful keeps the default
install zero-config and regression-free while giving power users full auto-close.

## [0.7.0-rc.5] — 2026-06-26

Build-time version bake — eliminates the runtime `readFileSync(package.json)`
in `src/core/render.ts` that's a Next.js bundling fragility source.

### Changed

- **`src/core/render.ts`** — drops `readFileSync(__dirname + '/../../package.json')`
  + path-walking imports. Reads `PKG_VERSION` from `./version.js` instead.
- **`scripts/gen-version.mjs`** NEW — prebuild script that reads `package.json`
  version and writes `src/core/version.ts` exporting `PKG_VERSION` as a baked
  constant. Wired via `prebuild` + `pretest` + `predev` script hooks in
  `package.json` so every build / test / dev run regenerates it.
- **`src/core/version.ts`** is git-ignored — pure codegen. The compiled
  `dist/core/version.js` is included in the npm tarball (generated by
  `prepublishOnly` → `npm run build` → `tsc`).
- **Templates** (`workflow.yml.tmpl`, `workflow-py.yml.tmpl`,
  `workflow-ts.yml.tmpl`) + `.github/actions/strict-mode-gate/action.yml` —
  `strict-mode-gate@v0.7.0-rc.4` → `@v0.7.0-rc.5` (release-discipline tests
  enforce lockstep).

### Why

Phase 5.1 hotfix on `clud-bug-app` (PR #50) had to add `'clud-bug'` to
`serverExternalPackages` in `next.config.js` because Next.js bundling
collapsed `import.meta.url` resolution and broke the path-walk-and-read
pattern. Codegen at build time removes the fs lookup so no consumer
needs that workaround. Same pattern as `clud-bug-app`'s
`lib/baseline-skills/skills.gen.ts` (PR #51).

Closes plan task #234.

## [0.7.0-rc.4] — 2026-06-17

Marketplace prep — three SPEC-aligned core enhancements bundled for the
v0.7.0 ship train. All three live in `src/core/` so the App's Phase 4
re-import lands them in one wave; clud-bug-app consumption is a follow-up
PR dispatched AFTER this version is tagged + published. See plan §Phase 6
and tasks #224 + #227 + #228.

### Added — `clud-bug configure-github <owner>/<repo>` (Phase 6 task #227)

External users installing the App expect "best-practice branch protection"
applied automatically. This CLI lets them opt in BEFORE the App's auto-setup
runs server-side.

- **`src/core/configure-github.ts`** — pure diff + idempotent-PATCH module.
  Exports `applyCanonicalRuleset(octokit, params)` taking a structural
  `OctokitLike` interface (no `@octokit/rest` runtime dep — App passes its
  real instance; CLI passes a `gh api`-backed adapter). Returns
  `{ changes: string[], alreadyCanonical: boolean, ruleset: 'canonical-v1' }`.
  Hard idempotency contract: `apply(); apply()` converges and the second
  call reports `alreadyCanonical: true` with zero PATCH side effects.
- **`src/cli/configure-github.ts`** — `clud-bug configure-github
  <owner>/<repo>` with `--dry-run` and `--branch <name>`. Auth ladder:
  `GITHUB_TOKEN` env first, then `gh auth token`. Helpful exit-1 message
  if neither produces a token.
- **`data/canonical-v1.json`** — bundled copy of the protocol repo's
  canonical-v1 ruleset (`thrillmade/protocol#rulesets/canonical-v1.json`),
  so the CLI works offline. Loaded once per process by `loadCanonicalV1()`
  with memoization.
- Behavior on partial mismatch:
  - `required_status_checks.contexts` are treated as a **superset** —
    repos that legitimately require extra CI gates keep them.
  - `required_approving_review_count` is a **floor** — never lowered.
  - All other booleans converge exactly.

### Added — SPEC §6.7.3 cache telemetry comment in review doc-files (task #224)

`renderReviewFile()` now accepts an optional `cacheStats: { cachedInputTokens,
cacheCreationInputTokens }` input. When present, emits a
`<!-- cache: <read> read · <created> created -->` HTML comment immediately
below `<!-- review-sha: ... -->` in the SPEC §1.8.1 doc-file. Absent input
renders nothing (backwards-compat). Lights up post-hoc cost analysis on
the committed doc-files — a single `grep '<!-- cache:'` over
`docs/reviews/PR-*.md` produces the cache-hit-rate time series without
re-walking workflow logs.

### Added — SPEC §1.8.1 Resolved this round / Still open blocks (task #228)

`renderReviewFile()` now accepts optional `resolvedFindings: Finding[]`
and `stillOpenFindings: Finding[]` lists. When non-empty, emits the SPEC
§1.8.1 named blocks (`**Resolved this round:**` and `**Still open:**`)
AFTER the severity buckets and BEFORE the trailing `---` separator. Each
bullet carries the (was 🔴 Critical / 🟡 Minor / 🟣 Preexisting) suffix so
severity changes across rounds are visible without diffing the two doc
files. Wired to `diffFindings()` from `./diff-findings.ts` (G7.t feedback —
"1 resolved from prior" status line now backed by the named finding list).

### Tests

- `test/core/configure-github.test.js` — 19 new tests covering fresh repo
  (404 protection), already-canonical no-op, partial mismatch (single-field
  PATCH), superset preservation for required_status_checks.contexts,
  raise-only floor for required_approving_review_count, dry-run skips
  PATCH, idempotency contract, branch override, non-404 error propagation,
  CLI wrapper missing-token / malformed-target / already-canonical /
  dry-run / apply paths.
- `test/review-writeback.test.js` — already covers the cache comment +
  resolved/still-open block paths (v0.7.0-rc.3 infrastructure landed
  alongside the parsePriorReviewFile + diffFindings port).

### Version bumps

- `package.json`: 0.7.0-rc.3 → 0.7.0-rc.4.
- All 3 workflow templates + `.github/actions/strict-mode-gate/action.yml`:
  `strict-mode-gate@v0.7.0-rc.3` → `@v0.7.0-rc.4` (release-discipline
  guard enforces this).

### Architectural lock

Per Bug 9 / Phase 2-4 architecture: clud-bug npm is the **single source
of truth**. clud-bug-app will consume the new `applyCanonicalRuleset` +
`renderReviewFile` extensions via the `clud-bug@0.7.0-rc.4` import in a
follow-up wave AFTER this version is tagged + published. No App-side
changes ship in this PR.

## [0.6.34] — 2026-06-02

### Fixed — `clud-bug-review` emits `neutral` on transient Anthropic API errors (Concern 2 from tokenomics-agent v0.6.14 verification report)

Until now, a transient Anthropic API hiccup (`Claude encountered an error after 1m 45s`) during `clud-bug-review` exited the workflow with `failure` conclusion, blocking the PR's required-checks gate with no remediation path the reviewer could take other than waiting for someone with admin rights to bypass. The merge was effectively held hostage by a tool failure that produced no content concerns.

v0.6.34 fix:
- `anthropics/claude-code-action` step now sets `continue-on-error: true`. The action's failure no longer kills the job.
- NEW step `Emit neutral check-run on transient tool failure` fires when `steps.clud-bug-review.outcome == 'failure' && steps.clud-bug-review.outputs.structured_output == ''`. It creates a `clud-bug-review` check-run with `conclusion: neutral` via `gh api repos/.../check-runs -X POST`. GitHub treats `neutral` as passing for required-status-checks, so the PR is no longer blocked.
- A PR comment is also posted (de-duplicated by SHA to avoid spam on webhook redeliveries) explaining the transient nature + retry options.
- The Layer-6 fallback step's guard tightened to skip when the action's outcome was failure — avoids double-emit on top of the neutral notice.

**Critical-findings path unchanged**: when the action succeeds with critical content, `structured_output` is non-empty, the renderer posts the review comment, and the existing `strict-mode-gate` composite action reads the comment + emits its own check-run failure if strict mode is on. PRs with genuine critical content still block as designed.

Re-run mechanism: GitHub's built-in "Re-run failed jobs" button on every workflow run covers manual retry. No `workflow_dispatch` trigger added.

Files:
- `.github/workflows/clud-bug-review.yml` — bump `# clud-bug-template-version: v12 → v13`; add `continue-on-error` + neutral-emit step + fallback-guard tightening
- Existing strict-mode-gate composite (`.github/actions/strict-mode-gate/`) — unchanged; its critical-findings detection runs on the latest review comment which the neutral path doesn't post, so it correctly passes when the tool errored

### Propagation

Standard `clud-bug self-update` cycle picks up v13 template in consumer repos. The 5 thrillmade consumers (tokenomics, agent-skills, logmind, reporulez, rezgen) refresh on next release window.

## [0.6.33] — 2026-06-01

### Added — `clud-bug init --with-skdd` (unified install, Node entry)

Symmetric mirror of logmind v0.6.8's `--with-skdd` flag. Node-first
users who run `npx clud-bug init` can pull in logmind in the same
breath:

```bash
npx clud-bug init --with-skdd   # clud-bug + logmind, one command
```

Same one-command bootstrap as the Python entry point, just from the
other ecosystem. Whichever side of the toolchain a user starts on,
the unified install brings them to the same end state.

#### Behavior

- Default (no flag): `clud-bug init` unchanged.
- With `--with-skdd` + pip available: subprocesses to
  `pip install logmind && logmind init`. Tries `pip`, `pip3`, `python -m pip`,
  `python3 -m pip` in order — first one that responds to `--version` wins.
- With `--with-skdd` + no pip: clear warning with recovery command,
  exit code unchanged (clud-bug init still succeeds).
- Subprocess failure: warning surfaced; clud-bug side unaffected.

#### Anti-loop guarantee

Invokes `logmind init` (NOT `logmind init --with-skdd`). Mirror of
v0.6.8's same guarantee. Each opt-in flag only goes one level —
mutual recursion impossible.

#### Implementation

- `bin/clud-bug.js`: new `--with-skdd` opt-in flag (parseArgs entry +
  switch case + handler) + `installLogmindViaPip()` + `findPipCommand()`
  helpers. Pip command resolution mirrors the Node side's `which npx`
  check with broader fallback chain since Python install names vary.
- `test/init-with-skdd.test.js`: new tests covering flag parsing,
  help-text inclusion, and graceful no-Python warning path.

## [0.6.32] — 2026-06-01

### Added — release-discipline guard locks in v0.6.31's upload fix

The v0.6.31 hotfix added `include-hidden-files: true` to the upload
step in all 3 workflow templates. That flag is a single line easy
to lose during a future template edit — and if it's lost, we go back
to silent artifact-drop with no error surface (per the v0.6.31
incident report).

This release adds a release-discipline test that asserts the flag is
present in every template. Any future edit that removes it fails CI
with a message pointing back to v0.6.31's CHANGELOG entry. The fix
is now self-policing.

### Changed — dashboard placeholder text post-v0.6.30

`formatHealthDashboard` previously read "v0.6.30 will add cross-review
aggregation" when no data was available. v0.6.30 has shipped + v0.6.31
fixed the upload — text is stale. New message tells the user
artifacts accumulate from the next substantive PR review (workflow-only
PRs auto-skip via 0.0.W²).

### Tests

`test/release-discipline.test.js` gains one new assertion
(release discipline: Upload skill-usage artifact step must set
`include-hidden-files: true`). Smoke-tested by temporarily removing
the flag — test fails with the citation message. No other behavior
changes.

## [0.6.31] — 2026-06-01

### Fixed — workflow upload step silently dropped every artifact

Critical hotfix. v0.6.29's `Upload skill-usage artifact` workflow
step has been silently dropping **every** artifact across the entire
org since 2026-05-31. Root cause: `actions/upload-artifact@v4`
excludes hidden files by default, and both `.claude/` and
`.clud-bug.json` are dot-prefixed.

The step reported `success` (because no files were found is a
warning, not an error). The CLI's `update-skill-usage` ran
successfully, wrote a usage block to `.claude/skills/.clud-bug.json`,
and the upload step then **uploaded nothing**.

Verified by inspecting v0.6.30 propagation cycle artifacts via
`gh api repos/THRILLMADE/$repo/actions/artifacts` — every workflow
that should have produced a `clud-bug-skill-usage-pr-N` artifact
returned an empty list. Run logs confirm:

> `##[warning]No files were found with the provided path:
> .claude/skills/.clud-bug.json. No artifacts will be uploaded.`

### Fix

Add `include-hidden-files: true` to the upload step in all three
workflow templates (`workflow.yml.tmpl`, `workflow-ts.yml.tmpl`,
`workflow-py.yml.tmpl`). The flag opts the artifact upload into
including dot-prefixed paths.

Composite-action pin bumped 0.6.30 → 0.6.31 + `package.json`
version bump + CHANGELOG. Propagation cycle to follow so the
hotfix reaches every consumer's workflow.

### Lesson

`continue-on-error: true` + a step that warns-but-succeeds is a
silent-failure pattern. The next dashboard run surfaced the issue
when artifacts didn't materialize. v0.6.30's aggregation dashboard
made the problem observable — without it the breakage would have
gone unnoticed indefinitely.

## [0.6.30] — 2026-05-31

### Added — cross-review aggregation closes the SkDD usage loop

`clud-bug usage --health` now reads accumulated org-wide data from the
per-PR artifacts uploaded by v0.6.29's workflow post-step. The
deterministic dashboard goes from "placeholder waiting for data" to
"live signal for which skills earn their place."

#### `lib/skill-usage.js` additions

- `fetchUsageArtifacts({owner, repo, since?, ghRunner?})` — lists
  `clud-bug-skill-usage-pr-*` artifacts via `gh api repos/owner/repo/actions/artifacts`,
  downloads each to a tmp dir via `gh run download`, parses the
  `.clud-bug.json` payload, returns `{prNumber, artifactId, usage, fetchedAt}`
  records. Filters expired artifacts + non-matching names. Tmp dirs
  cleaned up after every artifact (no disk leak).
- `aggregateUsageStream(artifacts)` — left-fold via `mergeSkillUsage`,
  ordered by `fetchedAt` ascending so `last_cited` reflects the most
  recent citing artifact. Pure function; commutative for `loads` +
  `citations` counts, so out-of-order input produces identical output.
- `DEFAULT_GH_RUNNER` — exported runner contract (`{json, run}`) that
  tests can inject a mock against. Spawns local `gh` by default.

#### `bin/clud-bug.js` wiring

- `runUsageHealth` now picks read source in this priority:
  1. `--no-artifacts` flag → force local `.clud-bug.json` (v0.6.28 behavior).
  2. `--repo owner/name` flag → use artifacts from that repo.
  3. Otherwise infer `owner/name` from `gh repo view` of the current dir.
  4. Fall back to local file if artifact path returns nothing.
- New `--no-artifacts` arg; existing `--repo` reused.
- The `ok` line now reports the source so users see whether the
  dashboard is showing local or org-wide data.

#### Tests

`test/skill-usage-aggregation.test.js` (new, 16 tests):
- `aggregateUsageStream` — empty / single / multi-artifact / out-of-order /
  partial-skill-overlap / `last_cited` timestamp semantics.
- `fetchUsageArtifacts` — required-args / empty-list / null-runner /
  malformed-name skip / valid-record / failed-download skip / since-filter /
  malformed-json skip / missing-usage-field default-empty.
- `ghRunner` is injected; no `gh` binary or `GH_TOKEN` required.

#### Version bumps

`package.json` 0.6.29 → 0.6.30 + composite-action pin in 3 templates +
strict-mode-gate action header. Release-discipline test enforces.

## [0.6.29] — 2026-05-31

### Added — Component 4 of the pragmatic SkDD pivot (workflow integration)

Closes the loop on v0.6.28's data layer + CLI. The `update-skill-usage`
subcommand + workflow post-step now auto-populate the skill-usage
block from every review's structured output, so `clud-bug usage
--health` has live data to surface instead of waiting on consumers
to run anything manually.

#### `clud-bug update-skill-usage --stdin` (new subcommand)

Reads structured-output JSON from stdin, computes the per-skill
delta via `computeSkillUsageDelta`, merges into
`.claude/skills/.clud-bug.json` via `mergeSkillUsage`, and writes
atomically (temp file + rename). Returns exit 0 on no-op cases
(empty stdin, no skills in payload, missing .clud-bug.json) so the
workflow post-step never fails the review on usage-tracking issues.
Exits 2 only on hard input errors (`--stdin` missing, malformed JSON).

#### Workflow post-step (all 3 templates)

`workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`
gain two new post-steps after the existing render step:

1. **Update skill-usage tracking** — pipes `STRUCTURED` through
   `npx clud-bug@<pin> update-skill-usage --stdin`. Bootstraps an
   empty `{"version": 1}` shell if the workspace lacks one (so a
   fresh consumer repo doesn't no-op forever). `continue-on-error:
   true` — usage-tracking flakes never fail a review.
2. **Upload skill-usage artifact** — uploads the workspace
   `.clud-bug.json` as a 90-day-retained workflow artifact named
   `clud-bug-skill-usage-pr-<N>`. v0.6.30 will add cross-review
   aggregation logic so `clud-bug usage --health` reads the artifact
   stream and accumulates real org-level data over time.

**Why artifact instead of committing back to main**: committing
would require `contents: write` permission expansion (v0.6.23
regression risk on private-repo triggers) + race-handling logic.
Artifacts are GitHub-native persistence with zero permission
expansion + zero commit noise.

#### Tests

`test/update-skill-usage.test.js` — 7 CLI-level tests covering
required `--stdin` flag, empty stdin, malformed JSON, payload with
no skills, first-write, idempotent accumulation, missing-file
skip-with-warning. All green alongside existing 333 tests (340
total).

## [0.6.28] — 2026-05-30

### Added — Components 1+2 of the pragmatic SkDD pivot

Strategic pivot (2026-05-30) away from speculative recursive-meta-skill
direction toward **deterministic usage tracking + human-gated skill
approval**. This release ships the data layer + CLI. Workflow
integration (auto-population of usage data after every review) lands
in v0.6.29.

#### `lib/skill-usage.js` — pure data layer (Component 1)

Three pure functions:
- `computeSkillUsageDelta(reviewJson)` — extract per-skill `loads` +
  `citations` from one review's structured-output JSON. Multiple
  findings from the same skill = 1 citation (per-review counting).
- `mergeSkillUsage(existing, delta, timestamp)` — accumulate deltas.
  `last_cited` updates only on citation.
- `assessSkillHealth(usage, now)` — apply deterministic thresholds:
  - **archive-candidate**: `citations == 0 + loads >= 5`
  - **stale**: last cited > 60 days ago
  - **new**: `loads < 5` (still bedding in; don't judge)
  - **healthy**: cited within 60 days
- `formatHealthDashboard(rows)` — render the 3-column read-only table.

21 tests in `test/skill-usage.test.js` covering every branch + boundary.

#### `clud-bug usage --health` — read-only dashboard (Component 2)

New flag on the existing `usage` command. Reads
`.claude/skills/.clud-bug.json` usage block, applies thresholds,
renders 3-column table (status / slug / loads / citations / last cited).

**No automation acts on the output.** Humans decide which skills to
prune. CI gates should NOT block on this.

### Maintenance

- Composite-action pin bumped: `strict-mode-gate@v0.6.27` → `@v0.6.28`
  across `templates/workflow.yml.tmpl`, `workflow-py.yml.tmpl`,
  `workflow-ts.yml.tmpl`, and `.github/actions/strict-mode-gate/action.yml`
  (release-discipline test enforces this).

### Upstream context

- Pairs with logmind v0.6.0 (`logmind skill new/test` CLI — already
  shipped) + agent-skills' new-skill issue template (in flight).
- The hard non-recursion line: **one** meta-skill exists
  (`skill-frontmatter-quality`). No autonomous skill generation;
  no AI judging AI's skill work; no recursion beyond depth 1.

### Coming in v0.6.29

- Workflow post-step integration (auto-populate usage block after every review)
- L5 auto-retry on cap-hit (demoted from v0.6.28 per the pivot)
- L4 permission-to-continue

## [0.6.27] — 2026-05-30

### Smart Budget Phase 3 — Layer 3 mid-review self-check-in (prompt-only)

Adds a one-line `[budget]` heartbeat that the AI must emit every 5
tool_uses:

```
[budget] files_reviewed=X/N, turns_used=Y/M, pace=ok|behind
```

When `pace = behind` (file-coverage rate trailing budget after
reserving the last 5 turns for emit), the AI is directed to:

1. Stop deep-dive analysis on the current file.
2. Switch to one-sentence verdicts for every remaining file.
3. Keep going through the whole diff — silent skipping is
   non-negotiable.

Two purposes: (a) forces internal pacing so the AI can't drift past
budget unnoticed, (b) the heartbeat lands in the action's streaming
output for post-hoc calibration of Layer 1's per-line cost
coefficients.

L5 auto-retry deferred to v0.6.28 because the workflow's
job-dependency-graph restructuring is its own concern.

### Composite pin

`strict-mode-gate@v0.6.26` → `@v0.6.27` lock-step bump.

### Migration

`npx --yes clud-bug@0.6.27 update` re-renders the workflow. Purely
additive prompt rule; no schema changes. Backward-compatible with
v0.6.26 calibration markers.

## [0.6.26] — 2026-05-30

### Smart Budget Phase 2a — 0.0.W² widen skip allowlist + Layer 6 fallback render-from-inlines

**0.0.W² — widen the workflow-only-skip allowlist (paths-check).**
Every prior `clud-bug update` propagation cycle required admin-bypass merge
because the App-side guard refuses workflow-modifying PRs and v0.6.14's 0.0.W
only skipped pure-workflow PRs. `clud-bug update` produces HYBRID PRs so
0.0.W never fired → admin-bypass every cycle. 6 such bypasses across the
v0.6.24 + v0.6.25 cycle.

Fix widens 0.0.W's allowlist to: workflow/strict-mode-gate files (existing),
AGENTS.md, .cursorrules / .clinerules / .windsurfrules / .continuerules,
.github/copilot-instructions.md, .claude/skills/.clud-bug.json,
.claude/skills/{critical-issues-only,evidence-based-review,respect-existing-conventions}/SKILL.md,
docs/timeline.md / docs/file-structure.md / docs/decisions.md,
docs/decisions-branches/*.md. Skip fires when EVERY changed file is in the
allowlist AND HAS_WORKFLOW_CHANGE=true (workflow-file or strict-mode-gate
change present). The HAS_WORKFLOW_CHANGE signature distinguishes
`clud-bug update` output from a user editing AGENTS.md by hand —
naked AGENTS.md edits still go through normal review, guarding the
prompt-injection-via-AGENTS.md attack surface.

Safety: workflow file still App-guard-protected. Non-executable files
in the allowlist can't grant code execution. strictMode read from base
ref so a PR can't disable strict-mode on itself.

**Layer 6 — fallback render-from-inlines (clud-bug-review post-step).**
When `structured_output` is empty BUT inline findings were posted before
the action gave up (tokenomics #21 pattern), the post-step scrapes
`gh api pulls/N/comments` for claude[bot]'s comments on the current SHA,
counts them by 🔴 / 🟡 / 🟣 emoji prefix, and synthesizes a structured
summary that cites the real counts. Comment labeled "**Synthetic summary**
(v0.6.26 §5.5 Layer 6 fallback)" so readers know it's reconstructed.
Strict-mode gate anchor matches; gate falls open advisory.

If NO inline findings either, falls through to legacy bare-H2 advisory.

L6 is the safety net; L5 (auto-retry on cap-hit) ships in v0.6.27 because
it restructures the workflow's job-dependency graph (separate concern).

### Composite pin

`strict-mode-gate@v0.6.25` → `strict-mode-gate@v0.6.26` lock-step.

### Template version

`v11` → `v12` to reflect the 0.0.W² classifier change.

### Migration

`npx --yes clud-bug@0.6.26 update` re-renders the workflow. Existing
v0.6.25 workflows continue to function — additive changes are
backward-compatible (is_workflow_only output retained with widened
semantic).

## [0.6.25] — 2026-05-30

### Smart Budget System — Phase 1 (Layers 1 + 1.5 + 2)

Tokenomics PR #21 exhausted v0.6.23's adaptive `--max-turns=25` while
emitting a structured-output summary on a 26-file docs PR. Posted one
inline finding, ran 4 minutes, exited fail before structured-output
emit. Root cause: file count is a crude proxy; pre-flight can't predict
review complexity without lines + edit type + file class. This ships
Phase 1 of the long-term Smart Budget System architecture (full
7-layer design in
`/Users/ludlow/.claude/plans/ok-here-is-recent-distributed-chipmunk.md`
§5.5; remaining 5 layers ship in v0.6.26 / v0.6.27 / v0.6.28 / v0.7.0).

**Layer 1 — Smart pre-flight estimation** (paths-check, all 3 templates):
the §5 4-bucket if-elif (10 / 15 / 25 / 40) is replaced with a
line-based formula:

```
per_file_cost = 0.3 + added × tw × 1.0
                    + modified × tw × 1.5      # context-heavy
                    + deleted × tw × 0.1       # trivial

type_weight tw (turns per line):
  code (.ts/.py/.js/.go/.rs/...) : 1/50
  docs (.md/.txt/.rst/.adoc/...) : 1/150
  tests (.test.*/.spec.*/__tests__/...) : 1/100
  config (.yml/.toml/.json/.cfg) : 1/100
  derived (timeline.md/file-structure.md/decisions.md): 0  # skip

estimated_turns = 5                                    # emit overhead
                + sum(per_file_cost for f in diff)
                + 1.5 × prior_unresolved_claude_threads

max_turns = max(estimated × 1.2, 15)  # 20% safety margin
max_turns = min(max_turns, 60)        # ceiling; Layer 5 retry above
```

Inline python3 estimator runs on the existing ubuntu-latest runner;
`gh pr view --json files` already returns per-file `additions`/`deletions`.

**Layer 1.5 — Calibration measurement**: the Render-and-post step
appends a hidden HTML marker to the summary comment:

```html
<!-- clud-bug-calibration: turns_estimated=N, max_turns=M, files=F, lines_added=A, lines_deleted=D, threads=T -->
```

Aggregator script ships in v0.6.26 (`clud-bug usage --calibration`);
data collection starts immediately. Calibration target: 90th-percentile
reviews fit in `max_turns × 1.0` (no Layer 5 retry needed).

**Layer 2 — In-prompt budget awareness**: the static system prompt
(cache-friendly) carries a new "Turn budget self-rationing" section
with the rules. The per-PR `prompt:` block injects the live values
(`max_turns`, `estimated`, `files`, `+added/-deleted`, `prior_threads`).
The AI is directed to:

- Reserve the LAST 5 turns for structured-output emit (non-skippable).
- Self-ration: ~1 turn per 50 lines code, ~1 turn per 150 lines docs.
- Switch to broader+shallower coverage if behind pace.
- **Never silently skip a file** — every file gets at least a
  one-sentence verdict in `per_skill_scan`.

### Cleanups (ride the same propagation cycle)

**Workflow concurrency group**: hit live on tokenomics #21 where my
merge-of-main push and logmind's auto-regen-derived-docs follow-up
fired two concurrent clud-bug-review runs (each posted its own
in-progress todo comment). Standard GH fix added at workflow level:

```yaml
concurrency:
  group: clud-bug-review-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Newer pushes auto-cancel older in-flight runs on the same PR.

**Issue #89** `buildDescriptionLine` newline sanitization: when
`signals.description` comes from a multi-paragraph source (README
first paragraph, etc.), literal `\n` characters used to break the
rendered YAML's `APPEND_SYSTEM_PROMPT` value. Fixed via
`.replace(/\s+/g, ' ').trim()` before further processing in
`lib/detect.js`.

**Gotcha #2 — publisher SKILL.md path detection**: every prior
propagation cycle required manual fixup in agent-skills's AGENTS.md
because `clud-bug update` rendered the consumer-install path
(`.claude/skills/clud-bug-collaboration/SKILL.md`) into a repo that
hosts the skill SOURCE at `skills/clud-bug-collaboration/SKILL.md`.
New `detectSkillRelPath(cwd)` in `lib/agents-md.js` checks for the
publisher path first; `renderBlock({ skillRelPath })` uses it.
End of manual fixup.

### Composite pin

`strict-mode-gate@v0.6.24` → `strict-mode-gate@v0.6.25` (lock-step
bump across `templates/*.tmpl` + `action.yml` header).

### Migration

`npx --yes clud-bug@0.6.25 update` re-renders the workflow with the
smart-budget paths-check + Layer 2 prompt + Layer 1.5 calibration
post-step. Existing v0.6.24 workflows continue to function — the
output schema is additive (new outputs land alongside the unchanged
`max_turns`).

## [0.6.24] — 2026-05-29

### Hotfix — back out `permissions: actions: read` from v0.6.23

The new `actions: read` permission added to the `clud-bug-review` job
in v0.6.23 (for the bundled `github_ci` MCP server) broke
`pull_request` trigger firing on **private** consumer repos. After
v0.6.23 propagation, clud-bug-review stopped scheduling on every PR
push event on tokenomics (private) and rezgen (private); agent-skills
(public) and logmind (public) continued firing normally. The workflow
file is byte-identical across all four repos; the only material
difference is visibility.

Validated diagnosis: removed `actions: read` from `clud-bug-review`'s
permissions block in all three templates (`workflow.yml.tmpl`,
`workflow-py.yml.tmpl`, `workflow-ts.yml.tmpl`). Test
`test/prompts.test.js` flipped to a `doesNotMatch` guard so the
permission can't be re-added without an explicit out-of-band fix
for the private-repo trigger-registration regression.

**User-visible impact**: `claude-code-action` will warn about not
being able to introspect recent CI runs via `github_ci` MCP. Reviews
themselves run identically; only the MCP-server-mediated CI awareness
is missing.

**Migration**: `npx --yes clud-bug@0.6.24 update` re-renders the
workflow without `actions: read`. Existing v0.6.23 workflows continue
to function on public repos but are recommended to upgrade so the
template stays in sync.

**Re-introducing `actions: read`**: deferred to a future version once
we understand the private-repo trigger semantics. Options under
consideration: (a) document a manual one-time consumer approval
workflow, (b) ship a separate opt-in `github_ci_mcp:` workflow env
var, (c) request `actions: read` at workflow level (not job level)
and verify trigger behavior is unaffected.

### Composite pin

`strict-mode-gate@v0.6.23` → `strict-mode-gate@v0.6.24` (lock-step
bump across `templates/*.tmpl` + `action.yml` header).

## [0.6.23] — 2026-05-29

### Added — Adaptive `--max-turns` for high-scope PRs (Phase 0.5 / §5)

Concrete failure that motivated this: **tokenomics PR #18** (docs
rebrand, 23 modified files + 6 unresolved prior `claude[bot]` threads
to walk in FIX-PUSH FLOW) exhausted `--max-turns 15` under v0.6.12
AND again under v0.6.22's structured-output flow. Even Phase 0.5's
efficiency improvements don't help when the bottleneck is FIX-PUSH
enumerating + validating prior threads — each thread costs 1-2 turns
no matter how efficient the surrounding flow is.

**Solution:** the `paths-check` pre-flight job (introduced in 0.0.W)
now also computes a turn-budget hint forwarded to claude-code-action
as `--max-turns ${{ needs.paths-check.outputs.max_turns }}`.

| PR scope | `max_turns` | Trigger |
|---|---|---|
| Workflow-only | n/a | 0.0.W skips the LLM entirely |
| Trivial (Haiku class) | 10 | dependabot/renovate OR ≤ 2 KB dep-manifest diff |
| Standard (default) | 15 | < 10 files AND < 3 prior unresolved claude threads |
| Larger | 25 | ≥ 10 files OR ≥ 3 prior unresolved claude threads |
| Very large | 40 | ≥ 30 files OR ≥ 6 prior unresolved claude threads |

Computed in shell from `gh pr diff --name-only` (file count) +
`gh api graphql` for unresolved claude-bot thread count. Best-effort:
GraphQL rate-limit / auth failures default to 0 (no escalation, fall
back to file-count tier). Workflow emits a `::notice` line per run
showing the chosen budget + the inputs that drove it.

### Added — `actions: read` permission on paths-check

Small enabler — lets `claude-code-action`'s bundled `github_ci` MCP
server install correctly (it requires `actions: read` to introspect
recent CI runs). Without this, every review run emits "github_ci
MCP server requires 'actions: read' permission. Skipping CI server
installation." in the logs. Harmless but noisy.

### Files

| File | Change |
|---|---|
| `templates/workflow{,-py,-ts}.yml.tmpl` | paths-check: add `actions: read` permission + `max_turns` output + bucket logic. clud-bug-review: `--max-turns ${{ needs.paths-check.outputs.max_turns }}` instead of hard-coded `15`. |
| `test/workflow.test.js` | + 3 fixture tests: trivial → 10, small/standard → 15, ≥10 files → 25, ≥30 files or ≥6 threads → 40. |
| `package.json` + `.github/actions/strict-mode-gate/action.yml` header + 3 templates | Composite pin v0.6.22 → v0.6.23. |

### Tests

256 → 259 pass (+3 paths-check bucket fixtures).

### Composite pin

v0.6.22 → v0.6.23 across `templates/workflow{,-py,-ts}.yml.tmpl` and
`.github/actions/strict-mode-gate/action.yml` header docs.

## [0.6.22] — 2026-05-29

### Added — `--json-schema` structured output enforcement (Phase 0.5 / 0.0.O)

The review prompt now instructs the LLM to emit the summary as
structured JSON via Claude Code CLI's `--json-schema` flag (a
first-class CLI flag, verified live against `anthropics/claude-code-action`).
A workflow post-step reads the action's `outputs.structured_output`,
renders to the existing GitHub-markdown summary shape, and posts via
`gh pr comment`. The LLM no longer writes the summary comment itself.

### Schema

`lib/review-schema.js` exports `REVIEW_SCHEMA` +
`serializedReviewSchema()`. Flat top-level object,
`additionalProperties: false` on every nested object (schema-strict
mode per Anthropic's structured-outputs guidance). Word/char caps
embedded in `description:` fields — advisory but signal-preserving
alongside the prompt's existing 0.0.X brevity directive.

### Renderer

`lib/render-review.js` exports `renderReview(data)` that returns the
markdown body for `gh pr comment`. New `clud-bug render --stdin`
subcommand pipes structured JSON from stdin to the renderer (the
workflow post-step calls it via `npx --yes clud-bug@<pinned> render
--stdin`). 17 fixture-based tests cover: clean / critical-findings /
bare-header variants, per-skill scan, dedicated sections, all three
severity tiers + emoji prefixes, diagnostics, anchor-without-line,
cross-cutting findings, defensive coercion on bad counts.

### Workflow changes

`templates/workflow{,-py,-ts}.yml.tmpl`:

- `--json-schema '{{REVIEW_SCHEMA}}'` added to `claude_args` (schema
  embedded at template render time via `lib/render.js`'s new
  `REVIEW_SCHEMA` + `CLUD_BUG_VERSION` defaults).
- New `clud-bug-review` step `id` so subsequent steps can read
  `steps.clud-bug-review.outputs.structured_output`.
- New "Render + post structured review" step (guarded on non-empty
  structured output) calls `npx --yes clud-bug@<pinned> render
  --stdin` and posts via `gh pr comment`.
- New "Fallback summary" step posts a bare-H2 advisory comment when
  the schema-validation retries exhaust (empty `structured_output`).
  Strict-mode gate sees the bare header and falls open rather than
  panicking on a missing summary.
- Removed `Bash(gh pr comment:*)` from `--allowedTools` — the LLM no
  longer posts the summary; only the post-step (workflow-level shell)
  does, with the workflow's GITHUB_TOKEN.

### Library API

- `serializedReviewSchema()` — `JSON.stringify(REVIEW_SCHEMA)` for
  embedding in workflow templates.
- `renderReview(data)` — pure markdown renderer.
- `lib/render.js` DEFAULTS now includes `REVIEW_SCHEMA` (from
  `review-schema.js`) and `CLUD_BUG_VERSION` (read from package.json
  at module-load time).

### Golden gate

Two new must-contain entries:

- `Emit the summary as structured JSON output`
- `Do NOT post the summary yourself`

### Regression test (out of band)

`appliesToPr` (0.0.K, v0.6.21) now has an explicit test pinning the
`endsWith()` contract for compound suffixes like `.test.ts` /
`_test.py`. Caught by the clud-bug-review on agent-skills#51 — without
the test, a future refactor to `path.extname()` would silently break
the test-discipline skill's applies_to.

### Identity contract — `claude[bot]` → `github-actions[bot]`

Moving the summary post from claude-code-action to a workflow step
changes the comment author from `claude[bot]` to `github-actions[bot]`
(the GITHUB_TOKEN identity). Three downstream consumers depend on the
author and are migrated this release:

- **Strict-mode gate**: each rendered template now passes
  `bot-login: 'github-actions[bot]'` to `strict-mode-gate`. The
  composite default stays `claude[bot]` for v0.6.21- back-compat.
- **Prior-summary detection (incremental-diff handshake)**: the
  prompt now walks `github-actions[bot]` comments first; falls back
  to `claude[bot]` for pre-v0.6.22 summaries so mid-version repos
  still find the prior SHA marker.
- **Skip-advisory dedup query** (Guard step): the jq filter now
  selects `github-actions[bot]` so `pull_request: synchronize` on
  long-running fork/bot PRs without `ANTHROPIC_API_KEY` doesn't
  stack duplicate "Clud Bug skipped" advisories.
- **PR-comments fetch**: the LLM's per-PR comment scan now excludes
  BOTH `claude[bot]` AND `github-actions[bot]` so the LLM doesn't
  read back its own summary as PR context.

Inline review threads stay `claude[bot]`-authored (the MCP tool
routes through claude-code-action).

### User-visible header behaviour preserved via `status_header: "bare"`

The schema's `status_header` enum is `['critical findings', 'clean',
'bare']`. Non-strict-mode repos (the default) emit `'bare'` and the
renderer produces an unsuffixed `## 🐛 Clud Bug review` H2 — matches
the v0.6.21- visible behaviour. Without `'bare'`, every non-strict
install would silently start seeing `— clean` / `— critical findings`
suffix after merge.

### Shell hardening

Render + post + fallback steps now lead with `set -euo pipefail` and
use `printf '%s\n'` instead of `echo` for `$STRUCTURED` (defensive
against payloads beginning with `-n` / `-e` / `--`). Failure
attribution stays honest when `npx` or the renderer exits non-zero —
the failing step is the one that actually failed, not the downstream
`gh pr comment "must specify body"`.

### Tests

300 pass (+23 vs v0.6.21: 17 render-review + 1 endsWith + 5 identity-
contract pins).

### Composite pin

v0.6.21 → v0.6.22 across `templates/workflow{,-py,-ts}.yml.tmpl` and
`.github/actions/strict-mode-gate/action.yml` header docs.

### Byte budget

Cap bumped 14000 → 14500 (deliberate; 0.0.O adds ~1.8 KB of
structured-output + status_header instructions). Still ~22% below the
18500 pre-0.0.P cap.

## [0.6.21] — 2026-05-29

### Added — Skill `applies_to:` filter (Phase 0.5 / 0.0.K)

Skills can declare an optional `applies_to:` block in their SKILL.md
frontmatter listing paths/extensions the skill cares about. The review
prompt now instructs the LLM to scan frontmatter first; if the skill
declares applies_to AND the PR's changed files match NONE of the
declared paths/extensions, the body is skipped entirely.

```yaml
---
name: brand-voice-review
review_mode: dedicated
applies_to:
  paths:
    - "src/ui/**"
    - "lib/components/**"
  extensions: [".tsx", ".jsx", ".css"]
---
```

**Match semantics**: paths OR extensions — any single hit wins. Path
globs use the minimal set (`*` non-slash, `**` cross-slash, `?` single
char). Skills without applies_to load unconditionally (back-compat).

**Savings**: for a repo with N installed skills where only K care
about a given PR's paths, the review skips ~(N-K) × MAX_SKILL_BYTES
of skill-body fetch. A UI-only PR no longer pays for the
`pii-and-compliance` body; a backend-only PR no longer pays for
`brand-voice-review`.

### Library API

Two new helpers exported from `lib/skills.js`:

- `readAppliesTo(skillContent)` — parses the frontmatter block.
  Returns `{paths: string[], extensions: string[]}` or `null` if
  absent (or if both lists are empty — the degenerate "no rule" case).
  Hand-rolled YAML parser scoped to the exact shape; no new deps.
- `appliesToPr(skillContent, prPaths)` — boolean. Skills without
  applies_to ALWAYS apply (back-compat).

The CLI doesn't use these helpers itself (the filter runs in the
LLM's prompt). They're exported for: (1) test coverage, (2) the v0.6
GitHub App's planned pre-filter step that will compute the applicable
subset BEFORE the API call so the prompt can list only matching skills.

### Golden gate

Two new must-contain entries lock the prompt section against future
0.0.P-style trim regression:

- `Skill applies_to`
- `SKIP that skill's body`

### Tests

277 pass (+12 new in `test/skills.test.js`). Cover: missing
frontmatter, missing applies_to, block-list + inline-array forms,
paths-only / extensions-only, prose mention does NOT fire, degenerate
empty-lists rule returns null, back-compat without applies_to, glob
single-star vs double-star semantics, paths OR extensions.

### Composite pin

v0.6.20 → v0.6.21 across `templates/workflow{,-py,-ts}.yml.tmpl` and
`.github/actions/strict-mode-gate/action.yml` header docs.

## [0.6.20] — 2026-05-29

### Changed — Review prompt trim (Phase 0.5 / 0.0.P)

Cleanup pass over `lib/prompts.js`. The rendered prompt is **down
~29.6% in bytes** (17351 → 12211) and **~25% in lines** (366 → 272)
without removing any load-bearing instruction. Gated by the 0.0.E
golden set (PR #109) — every must-contain phrase still passes.

Targeted compressions:

- **Section budgets intro**: 7 lines → 4. Removed prose paraphrase of
  "cached prefix is free at 10%."
- **CRITICAL — identifying the PRIOR SUMMARY**: 11 lines → 6. The
  detection rule survives; the worked walk-through compresses.
- **Span check edge case**: 5 lines → 3.
- **Tee-hint Diagnostics block**: kept exact `### Diagnostics`,
  `Tee-hint on cap fire`, and "Attempt ONE targeted re-fetch with
  double the cap" must-contain phrases; trimmed the surrounding
  "auditable event in the review trail" prose.
- **Skill routing**: 21 lines → 13. Bullet explanations collapse to
  one sentence each.
- **Output-token budget**: kept exact "Keep total output under ~600
  tokens"; trimmed surrounding "Verbose output costs the consuming
  repo on every review" sentence to one clause.
- **Incremental-diff handshake**: 12 lines → 8. Kept the SHA marker
  literal and the "next review falls back to full \`gh pr diff\`"
  signal.
- **Tone block**: 4 lines → 3.
- **INLINE REVIEW THREADS surface**: 26 lines → 11. The
  required_review_thread_resolution rationale + `confirmed: true`
  carve-out are preserved; the "this is what creates *resolvable
  conversations*" prose collapses.
- **Counters bullet block**: 14 lines → 5 (one line per counter
  rather than indented multi-line definitions).
- **Stats header + per-finding format**: 18 + 17 lines → 8 + 12.
- **Per-skill scan + dedicated**: 26 lines → 22 (mostly intact —
  the worked examples ARE the spec).
- **FIX-PUSH FLOW footer**: 21 lines → 13.

### Golden-budget bump DOWN

`test/golden/byte-budget.json`:

- `max_prompt_bytes`: 18500 → 14000 (locks in the ~5 KB savings;
  leaves ~1.8 KB headroom for the upcoming 0.0.O schema directive).
- `max_prompt_lines`: 380 → 310 (locks in the ~90-line savings;
  leaves ~38 lines headroom for 0.0.O).

Caps DOWN is deliberate — without it, a future addition could refill
the freed budget invisibly.

### Tests

265 pass (same as [0.6.19] — 0.0.P doesn't add or remove tests).
Updated `test/prompts.test.js` to assert the trimmed
"Section budgets (v0.6.4+)" header instead of the prior
"token-frugal review" phrasing.

### Composite pin

v0.6.19 → v0.6.20 across `templates/workflow{,-py,-ts}.yml.tmpl` and
`.github/actions/strict-mode-gate/action.yml` header docs.

## [0.6.19] — 2026-05-29

### Changed — `clud-bug init` / `clud-bug update` skip CLAUDE.md (etc.) block install when `@AGENTS.md` import is present (Phase 0.5 / 0.0.I.1)

Companion behaviour for the 0.0.I rollout. With `@AGENTS.md` eagerly
imported at the top of consuming repos' CLAUDE.md (Q4 refinement
landed in PR #106 + downstream rollout), the AGENTS.md clud-bug block
becomes the canonical source and the same block in CLAUDE.md is
eagerly-inlined duplicate content. This release:

- **Skips block installation** in tool-stub files (`CLAUDE.md`,
  `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`,
  `.windsurfrules`, `.clinerules`, `.continuerules`, and any
  `.cursor/rules/*.md`) when the file already contains `@AGENTS.md`
  at start-of-line.
- **Removes any pre-existing block** in those files when the import
  is present — migration path for repos installed under older
  clud-bug versions.
- **AGENTS.md is unaffected** — still the canonical source and always
  receives the block.

The detection is line-anchored: a prose mention like "See @AGENTS.md
for rules" does NOT trigger the skip. Only the literal import
directive (`@AGENTS.md` alone on its line) qualifies.

### Tests

`test/agents-md.test.js` adds 9 new tests covering: `hasAgentsMdImport`
line-anchor edge cases, `removeBlock` idempotence + preserved
surrounding content, skip-on-import for CLAUDE.md, stale-block cleanup
on CLAUDE.md with import, back-compat install when no import,
`.cursor/rules` walk respects the same rule. Suite: 265 pass, 0 fail.

### Composite pin

v0.6.18 → v0.6.19 across `templates/workflow{,-py,-ts}.yml.tmpl` and
`.github/actions/strict-mode-gate/action.yml` header docs.

## [0.6.18] — 2026-05-29

### Added — RTK-inspired tee-hint on cap fire (Phase 0.5 / 0.0.T, clud-bug side)

The review prompt now teaches the LLM to treat any `head -c "$MAX_*"`
cap fire as an auditable event, not a silent confidence loss. Two
required behaviours:

1. **Targeted re-fetch with doubled cap** on the specific truncated
   section. The prompt names the section that fired (diff / skill /
   comments), the file or query affected, and the exact `head -c
   $((MAX_* * 2))` re-fetch command.
2. **`### Diagnostics` block** at the bottom of the summary comment
   listing each cap that fired, the section affected, and the
   re-fetch outcome (recovered / still truncated / deferred).

This is the producer-side half of RTK's `force_tee_tail_hint`
(`src/cmds/python/ruff_cmd.rs:214-219`): never elide without naming
what was elided. Pattern lifted from MIT-licensed code; RTK is not a
dependency.

### Golden gate updates

`test/golden/must-contain.json` adds three entries to lock in the new
section:

- `Tee-hint on cap fire`
- `Attempt ONE targeted re-fetch with double the cap`
- `### Diagnostics`

A future 0.0.P trim that drops any of these fails the gate, exactly
as designed in 0.0.E.

### Golden-budget bump

`test/golden/byte-budget.json`:

- `max_prompt_bytes`: 16000 → 18500 (rendered prompt now 17080 bytes;
  0.0.T added ~1.1 KB).
- `max_prompt_lines`: 360 → 380 (rendered prompt now 362 lines).

Both bumps are intentional and the new caps still leave headroom for
0.0.O. Each `why` field in `byte-budget.json` is updated to point at
this CHANGELOG entry for the bump rationale.

### Composite pin

v0.6.17 → v0.6.18 across `templates/workflow{,-py,-ts}.yml.tmpl` and
`.github/actions/strict-mode-gate/action.yml` header docs.

## [0.6.17] — 2026-05-29

### Added — golden-set regression gate for the review prompt (Phase 0.5 / 0.0.E)

Cheap, deterministic CI gate for the rendered review prompt. **Gates
0.0.P (prompt trim) and 0.0.O (JSON schema output) — both ship next
under this guard.** Three categories of structural check, all
runnable on every PR without LLM execution:

1. **`must-contain`** — instruction phrases the prompt MUST include
   (17 entries today: severity tiers, comment format, budgets,
   incremental-diff handshake, brevity directive, FIX-PUSH FLOW, etc.).
   Catches over-aggressive trims dropping load-bearing instructions.
2. **`must-not-contain`** — anti-pattern filler from the May 2026
   LLM token optimization guide § 6 ("Please make sure to…",
   "I would like you to…", etc.). Locks in cleanups against
   regression.
3. **`byte-budget`** — UTF-8 byte and line caps on the rendered
   prompt. 16 KB / 360 lines today, with documented headroom.
   Catches the case where a trim PR cuts in one place but adds
   bytes elsewhere.

### What this gate does NOT test

Live LLM behavior. That's expensive for every-PR CI; lives in a
separate manual `clud-bug eval --live` flow (future). The structural
check is enough to safely ship 0.0.P + 0.0.O.

### Updating the golden set

See `test/golden/README.md`. Add `must-contain` entries when shipping
new load-bearing instructions; add `must-not-contain` entries when
finding new filler to ban; bump `byte-budget` after major prompt
structural change with a CHANGELOG note explaining why.

### Net diff

`test/golden/` NEW (4 fixtures + README). `test/prompts.eval.test.js`
NEW (~120 lines, 6 tests). Composite-pin v0.6.16 → v0.6.17.

## [0.6.16] — 2026-05-29

### Added — output-token brevity directive (Phase 0.5 / 0.0.X)

Tiny prompt addition. Per the May 2026 LLM token optimization guide
(section 6), `max_tokens` should be capped per call type — but the
Claude Code CLI doesn't expose it (the SDK is agent-shaped, not
single-call). Workaround: an explicit brevity instruction inside the
cached system-prompt appendix.

The new directive tells Claude:

- Keep total output under ~600 tokens
- Per finding: one-sentence claim + `<details>` reasoning ≤ 80 words
- No code quotes > 2 lines
- Omit reasoning details that don't change the verdict

Discipline, not a hard cap. Verbose review output costs the consuming
repo on every review; brevity compounds across the org.

### Net diff

`lib/prompts.js`: +8 lines. Composite-pin v0.6.15 → v0.6.16.

## [0.6.15] — 2026-05-29

### Added — model routing for trivial PRs (Phase 0.5 / 0.0.R)

When a PR is a dep bump (Dependabot/Renovate author) OR a small
manual lockfile/manifest fix, route the review to Haiku 4.5
($0.80/MTok input) instead of Sonnet 4.6 ($3/MTok) — another **~75%
cost reduction** on this PR class.

### Classifier (in paths-check)

A PR is "trivial" if EITHER:

1. The author is `dependabot[bot]` or `renovate[bot]` (regardless of
   diff size — dep-bump bots open shallow PRs even when lockfile
   churn is large).
2. The diff is < 2 KB AND every changed file matches the
   dep-manifest allow-list:
   `package.json` / `package-lock.json` / `pnpm-lock.yaml` /
   `yarn.lock` / `requirements*.txt` / `pyproject.toml` /
   `poetry.lock` / `uv.lock` / `Gemfile(.lock)` /
   `go.mod` / `go.sum` / `Cargo.toml` / `Cargo.lock`.

Otherwise: Sonnet (the current default).

### Wiring

`paths-check` job (introduced in v0.6.14) now also emits a `model`
output. The `clud-bug-review` job's `claude_args` uses
`--model ${{ needs.paths-check.outputs.model }}` so the SDK picks up
the routed model dynamically.

### Override

To force a specific model for a specific repo, edit the rendered
workflow to hard-code `--model claude-sonnet-4-6` (or any other valid
ID) in place of the expression. The classifier is opt-out by
construction — any non-trivial diff (real code change, large dep
bump, mixed paths) defaults to Sonnet.

### Net diff

3 templates × ~30 lines (triviality classifier in `paths-check` +
`--model` expansion in `claude_args`). Composite-pin v0.6.14 → v0.6.15.

## [0.6.14] — 2026-05-28

### Added — workflow-only PR review skip (Phase 0.5 / 0.0.W)

Eliminates the structural admin-bypass merges we did ~6 times during
Phase 0 propagation. When a PR ONLY touches `clud-bug-*.yml` workflow
files OR `.github/actions/strict-mode-gate/**`, the LLM review skips
entirely — and the strict-mode gate skips with it.

### Why

`anthropics/claude-code-action` refuses to run on PRs that modify its
own workflow file (security guard against self-neutering edits).
Phase 0 hit this on every propagation cycle — the only path was
admin-bypass merge. v0.6.14 makes the right thing automatic: the LLM
call doesn't happen, the strict-mode gate has nothing to fail on,
branch protection is satisfied by the skip, and the org saves the
per-skipped-review cost (~$0.20–$0.30 × ~50–80 propagation PRs/year).

### How

New `paths-check` pre-flight job classifies the PR diff. If ALL
changed files match the allow-list (`.github/workflows/clud-bug-*.yml`
or `.github/actions/strict-mode-gate/**`), it sets
`outputs.is_workflow_only=true`. The `clud-bug-review` job carries
`needs: paths-check` + `if: needs.paths-check.outputs.is_workflow_only != 'true'`.

### Security guarantee

The classifier requires EVERY changed file to match the allow-list. A
mixed PR (workflow + code) still runs the review normally — no path
to sneak unrelated changes through by bundling them with a workflow
tweak.

### Net diff

3 templates × ~30 lines (new `paths-check` job + `needs:` / `if:` on
`clud-bug-review`). Composite-pin v0.6.13 → v0.6.14.

## [0.6.13] — 2026-05-28

### Added — `clud-bug usage` $/LOC dashboard (Phase 0.5 / 0.0.M.1)

Internal Q7-clud-bug enforcement dashboard. New subcommand reads recent
clud-bug-review run JSON and normalizes cost by lines-of-code reviewed.

```
$ clud-bug usage --since 30d
ok: 47 reviews, 30-day $/LOC trend: ↓ -38% MoM
  per-repo $/LOC (most → least expensive):
    thrillmade/logmind     $0.0021/LOC  · 18 reviews · 89% cached
    thrillmade/reporulez   $0.0017/LOC  · 12 reviews · 73% cached
    …
  org median $/LOC: $0.0015 · 3-month low: $0.0011 (Sonnet pin landed)
  outliers (>2× median):
    thrillmade/logmind#73 ($0.0086/LOC — low cache hit)
```

### Why $/LOC, not $/PR

PRs vary wildly in size. A per-PR cost cap is silly — a 5-line typo fix
and a 500-line refactor get reviewed for very different amounts. **Cost
per line of code reviewed** is repo-agnostic, comparable across time,
and the right normalized metric for Q7-clud-bug enforcement.

### How

- New `lib/usage.js`: pricing table (Sonnet 4.6, Haiku 4.5, Opus 4.7);
  per-review cost compute; cache hit rate; log parser; rollup with
  30-day rolling trend + outlier detection.
- New `usage` subcommand: orchestrates `gh run list` + `gh api .../jobs/<id>/logs`
  + `gh pr view --json additions,deletions`, joins, computes, prints.
- New CLI flags: `--repo <owner/name>`, `--pr <N>`, `--limit <N>`, `--json`.
  `--since <30d>` already existed; reused.
- `test/usage.test.js`: 24 fixture-driven tests for the pure-compute paths.

### Q7-clud-bug enforcement

The rolling 30-day $/LOC trend must monotonically decline (or stay at a
structural floor). If it stops trending down, the next Phase 0.5 PR
targets the biggest contributor. **No fixed cap** — the gradient must
always point down until we hit the floor.

### Net diff

- `lib/usage.js` NEW (+260 lines)
- `bin/clud-bug.js`: +160 lines (runUsage + helpers; argparse +4 flags; HELP +6 lines)
- `test/usage.test.js` NEW (+200 lines)
- Composite-pin v0.6.12 → v0.6.13

## [0.6.12] — 2026-05-28

### Fixed — `clud-bug-self-update.yml` YAML literal-block bug breaking `workflow_dispatch`

`templates/self-update.yml.tmpl` had a blank line embedded inside a
multi-line `--body "..."` argument to `gh pr create`, nested inside a
`run: |` block. GitHub Actions' YAML parser ended the block scalar at
the blank line and rejected the next non-blank line as an unexpected
top-level value:

```
HTTP 422: failed to parse workflow: (Line: 90, Col: 1): Unexpected
value 'Review the diff. To stay on this version permanently, ...'
```

Consequence: **`workflow_dispatch` failed on every consuming repo** —
the scheduled weekly run still worked (no parse needed at trigger
time), but on-demand triggers were blocked. Discovered while trying
to manually propagate v0.6.11 (Sonnet pin) to consuming repos. Pin
drift across the org: agent-skills @v0.5.16, reporulez @v0.5.15,
rezgen @v0.5.16, logmind @v0.6.7 — all weeks behind.

Fix: construct the body via `printf` outside the YAML literal block,
then pass via shell variable. Removes the YAML-fragile blank line
entirely.

### Net diff

- `templates/self-update.yml.tmpl` — 4 lines replaced with 7 (printf
  build + 3-line comment explaining why).
- Composite-pin bumped v0.6.11 → v0.6.12.

### Note on propagation after this ships

Consuming repos installed before v0.6.12 still carry the broken
`clud-bug-self-update.yml`. Two ways to recover:
1. **Locally**: `npx clud-bug@latest update` in the repo (this
   re-renders the workflow from the fixed template).
2. **Wait for scheduled run**: next Monday 12:00 UTC the cron
   trigger fires and opens a self-update PR — which would install
   the v0.6.12 template, fixing the bug going forward.

## [0.6.11] — 2026-05-28

### Changed — pin clud-bug-review to Claude Sonnet 4.6 (Phase 0.A.8)

> Reuses the slot that v0.6.9 was originally reserved for in the plan.

clud-bug-review was running on **`claude-opus-4-7`** (Opus 4.7) —
confirmed via log audit on logmind PR #72's run. Per Anthropic
[cost docs](https://code.claude.com/docs/en/costs):

> "Sonnet handles most coding tasks well and costs less than Opus.
> Reserve Opus for complex architectural decisions."

PR review fits Sonnet's profile, not Opus's. Pricing delta:

| Model | Input | Cached read |
|---|---|---|
| Opus 4.7 | $15/MTok | $1.50/MTok |
| **Sonnet 4.6** | **$3/MTok** | **$0.30/MTok** |

**~80% cost reduction** on every review, on top of the caching wins
from v0.6.3. A 50,000-token review (typical for a medium PR) drops
from $0.75 → $0.15 — and that's the uncached-input case. Cached
reviews drop ~$0.075 → ~$0.015.

### How

Added `--model claude-sonnet-4-6` to `claude_args` in all 3 workflow
templates. Consuming repos pick up the pin on next composite-pin
update (Dependabot or `clud-bug update`). Per-repo override remains
available by editing the rendered workflow.

### Net diff

3 templates × 1 line each + composite-pin bump v0.6.10 → v0.6.11.

## [0.6.10] — 2026-05-28

### Added — incremental-diff review on fix-push (Phase 0.A.10 — HIGH-VALUE)

> v0.6.9 intentionally skipped — reserved for the 0.A.8 model-pin
> spike. v0.6.10 ships the HIGHEST-VALUE Phase A follow-up per plan.

clud-bug now fetches only the **delta since its prior review** on
fix-pushes, instead of re-ingesting the full PR diff every time. State
lives in the prior summary comment as an HTML marker:

```html
<!-- last-reviewed-sha: <sha> -->
```

### How it works

On every review pass, the prompt instructs Claude to:

1. **Detect prior state** — grep prior `claude[bot]` comment bodies
   for `last-reviewed-sha: <sha>`.
2. **Verify ancestry** — `git merge-base --is-ancestor <prior_sha> $HEAD_SHA`.
   Force-push or rebase invalidates ancestry → fall back to full diff.
3. **Branch the fetch**:
   - Marker present AND ancestor intact → `git diff <prior_sha>..$HEAD_SHA | head -c "$MAX_DIFF_BYTES"`.
   - Missing OR not an ancestor → `gh pr diff "$PR_NUMBER" | head -c "$MAX_DIFF_BYTES"` (current behavior).
4. **Emit the marker** at the end of every summary comment so the next
   pass can do the same handshake.

### Estimated savings

A 4-push PR (initial 10 KB diff + 3 fix-pushes of 1 KB each) currently
ingests ~40 KB across 4 reviews. With delta-only: ~13 KB. **~67%
reduction on the diff section across the PR's lifetime.** Larger churny
PRs save proportionally more.

### Fallback discipline

- **First review** has no marker → full diff (unchanged behavior).
- **Force-push / rebase** breaks ancestry → full diff (correct).
- **Span check**: if a delta-review surfaces a finding that might
  affect unchanged code outside the delta, Claude is instructed to do
  a one-time full `gh pr diff` to verify before flagging.

### Workflow template changes

- Added `HEAD_SHA: ${{ github.event.pull_request.head.sha }}` to env
  block in all 3 templates.
- Added `Bash(git diff:*)` and `Bash(git merge-base:*)` to allowedTools
  in all 3 templates.
- Composite-pin bumped `v0.6.8 → v0.6.10` (skipping v0.6.9).

### Tests

- `test/prompts.test.js`: prompt contains incremental-diff detection
  instructions; prompt instructs Claude to emit the `last-reviewed-sha`
  marker; all 3 rendered workflow templates declare `HEAD_SHA` env var,
  the new git allowedTools, and pin the composite at `v0.6.10`.

## [0.6.8] — 2026-05-28

### Added — `--max-turns 15` + `MAX_THINKING_TOKENS=8000` in workflow templates (Phase 0.A.7)

Two Anthropic-recommended cost-control knobs from
[code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs),
applied to all 3 workflow templates (`workflow.yml.tmpl`,
`workflow-py.yml.tmpl`, `workflow-ts.yml.tmpl`):

- **`--max-turns 15`** via `claude_args` — caps the agentic loop. PR
  review fits comfortably in 5–10 turns; 15 is a safe ceiling that
  blocks runaway turn-storms (e.g., a confused review chasing a phantom
  finding for 50 turns and burning API budget).
- **`MAX_THINKING_TOKENS=8000`** env var — caps the extended-thinking
  budget per turn. Anthropic docs: "For simpler tasks where deep
  reasoning isn't needed, you can reduce costs by lowering
  `MAX_THINKING_TOKENS=8000`." Default budget runs tens of thousands;
  PR review needs some reasoning but not unbounded.

### Why these are the right defaults

- Both are **opt-out**, not opt-in — consuming repos can override via
  workflow-level env or by editing the rendered workflow. Defaults are
  conservative for the 95% case.
- `--max-turns 15` is a runaway-protection ceiling, not a performance
  cap. A well-behaved review finishes in 5–10 turns; the 15-turn
  ceiling just prevents pathological loops.
- `MAX_THINKING_TOKENS=8000` matches the Anthropic-published guidance
  for review-shaped (rather than architecture/exploration-shaped) tasks.

### Net diff

3 templates × ~3 lines each (env var + claude_args flag + comment). Plus
composite-pin bump v0.6.7 → v0.6.8 across the same 3 files.

## [0.6.7] — 2026-05-27

### Added — `--quiet/-q` flag + `CLUD_BUG_QUIET=1` env var for agent-friendly CLI output

When an agent (Claude Code session, CI script, downstream tool) runs
`clud-bug init` / `update` / `add` / etc., the verbose progress output
(~5–50 lines per command) lands in the agent's context. v0.6.7 adds an
opt-in "quiet" mode borrowed from RTK's pattern — suppresses progress
chatter, emits exactly one final `ok <key-value>` summary line per
command. Errors and warnings still print on stderr.

| Command | Quiet output |
|---|---|
| `init` | `ok initialized: .claude/skills/ N specimens, workflow @vX.Y.Z` |
| `update` | `ok updated: @vX.Y.Z, N changed, M unchanged` |
| `add <slug>` | `ok added: .claude/skills/<slug>/SKILL.md` |
| `remove <slug>` | `ok removed: <slug>` |
| `refresh` | `ok refreshed: +N -M (K unchanged)` |
| `edit-workflow` | `ok branch: <name> (N file)` |

### Activation

Either pass `--quiet` / `-q` on the command line, or export
`CLUD_BUG_QUIET=1` in the environment. For agent invocations, the
env-var route is recommended (set once at session start; no flag per
invocation).

### Behavior

- The final `ok` line **always** prints (even without quiet mode) so
  agents that parse stdout always get a positive confirmation with a
  chainable key-value (commit SHA / file count / branch name).
- `log()` (progress chatter) is suppressed only in quiet mode.
- `warn()` (stderr warnings) and errors print regardless — quiet
  must not silence real problems.

### `AGENTS.md` block update

The v0.6.6-trimmed block now mentions `CLUD_BUG_QUIET=1` so agents
discover the env var when they read AGENTS.md at session boot.

### Tests

- `test/cli.test.js` (+5 new): help advertises the flag, `--quiet`
  emits exactly one `ok` line on refresh / update / empty-repo paths,
  default mode still emits progress chatter + the ok line.

## [0.6.6] — 2026-05-27

### Changed — `AGENTS.md` clud-bug block trimmed from ~44 lines to ~10

The full collaboration rules (fix-push flow, skill structure, comment
format, workflow-edit constraint, where-skills-live) already live in the
bundled `clud-bug-collaboration` skill — both the canonical version in
`thrillmade/agent-skills` AND the local copy at
`templates/skills/baseline/clud-bug-collaboration.md`. This PR
**removes the duplicate copy** from the injected `AGENTS.md` block (and
points at the skill instead), since the skill is already auto-installed
by `clud-bug init`/`update` and auto-loaded by `clud-bug-review`. **No
content is lost — duplication is.**

What stays in the AGENTS.md block (repo-specific, can't dedupe):
- Pointer to the bundled skill.
- Strict-mode toggle line (varies per consuming repo).
- `_Installed at clud-bug vX.Y.Z._` footer.

What was duplicated in AGENTS.md and removed from the block (still lives
in the skill, unchanged):
- Fix-push flow rules.
- Strict-mode mechanics (base-ref read, can't disable on own PR).
- Skill discovery + structure.
- Workflow-edit constraint + `clud-bug edit-workflow` mechanism.

### Why this compounds

Every agent session in every consuming repo reads `AGENTS.md` at boot.
Trimming the block from ~2,100 chars to ~720 chars means each session
reads ~1,400 fewer chars from this file alone. Across 7+ consuming
repos × many sessions/day, this is a meaningful recurring saving.

### Block-version bump

`<!-- clud-bug-block-version: -->` advances from `v1` to `v2` so existing
consumers can detect the schema change in their checked-in `AGENTS.md`.
The next `clud-bug update` rewrites the block to v2 idempotently.

### Tests

- `test/agents-md.test.js` (+2): assert block ≤800 chars, contains the
  `clud-bug-collaboration` skill link, advances to `clud-bug-block-version:
  v2`, and the dropped sections (fix-push flow, workflow-edit, skill
  discovery) are not present in the new block.

## [0.6.5] — 2026-05-27

### Changed — write-time comment compression: stats header + severity prefix + collapsible reasoning

The comments clud-bug *writes* get ingested by every subsequent re-review of
the same PR (via the FIX-PUSH FLOW's `gh api ... comments` fetch). Compressing
at write time means every future re-read in every consuming repo costs less.

- **Stats header** (`Found: N 🔴 / N 🟡 / N 🟣`) leads every review comment immediately under `**This round:**`. Three severity tiers: 🔴 important (bugs/security/perf), 🟡 nit (suggestions), 🟣 pre-existing (issues that pre-date this PR). On the zero-findings case the header IS the entire substantive payload — agents re-ingesting the comment can short-circuit without parsing the body.
- **Per-finding format**: each finding starts with a severity emoji + one-line claim + `file:line`. Long-form reasoning wraps in `<details><summary>Reasoning</summary>...</details>`. Humans see full detail via GitHub's native render; agent re-reads skip the collapsed section.
- **NEW `extractStatsHeader(comment)` export** in `lib/skills.js`: parses the stats line into `{important, nit, preExisting}` or returns `null`. Strict on severity emoji (drift catches loudly), permissive on whitespace.
- **Tests** (`test/prompts.test.js` +2, `test/skills.test.js` +5): assert the prompt instructions are present + the parser handles canonical / whitespace-variant / multi-digit / missing / non-string inputs.

### Compounds effect

Combined with v0.6.3 (caching the stable prefix) and v0.6.4 (capping the
variable suffix), v0.6.5 compresses the third surface: the comments
clud-bug writes that future re-reviews must ingest. Every byte trimmed
here is paid back on every future re-review for the lifetime of the PR.

### Anthropic Code Review parity

The three-tier severity system is the same scheme Anthropic's own Code
Review uses (🔴 Important / 🟡 Nit / 🟣 Pre-existing). Matching this on
opt-in keeps users who switch between products consistent.

## [0.6.4] — 2026-05-27

### Changed — per-section budgets cap the variable suffix (caching covered the stable prefix)

Builds on v0.6.3's caching: the stable system-prompt prefix is cached at
10% of standard input cost, but the variable per-PR content (diff,
comments, skill files) is still billed at full rate on every review. This
release adds prompt-level budget instructions + workflow env vars so
Claude caps each variable fetch with `head -c $MAX_*_BYTES`.

- **`lib/prompts.js`** — `reviewPrompt(...)` now emits a "Section budgets" subsection in the system prompt instructing Claude to cap fetches: `gh pr diff "$PR_NUMBER" | head -c "$MAX_DIFF_BYTES"`, `head -c "$MAX_SKILL_BYTES" .claude/skills/*/SKILL.md`, etc. Tells Claude to note any truncation in the review.
- **`templates/workflow{,-ts,-py}.yml.tmpl`** — three new env vars on the action step: `MAX_DIFF_BYTES=80000`, `MAX_COMMENT_BYTES=20000`, `MAX_SKILL_BYTES=4000`. Plus `REPO_OWNER` / `REPO_NAME` so the comment-fetch pattern resolves. Consumers can override per-repo by setting these env vars in their workflow.
- **`Bash(head:*)`** added to allowedTools so Claude can pipe outputs through `head -c` per the budget instructions.
- **Tests** (`test/prompts.test.js`, +3): assert budget section in prompt, env vars in rendered templates, `Bash(head:*)` in allowedTools across all 3 templates.

### Defaults rationale

- **80 KB diff** covers ~95% of real PRs (measured during the 2026-05-27 spike: median <10 KB, long-tail to 105 KB).
- **20 KB comments** = ~20 most-recent comments at typical sizes. Skips clud-bug's own prior comments (those are handled via the FIX-PUSH FLOW reviewThreads GraphQL).
- **4 KB per skill file** fits the baseline kit comfortably; user-added skills above the cap get silently truncated by `head -c`. (A `[... N bytes elided ...]` marker would require a post-process step we haven't shipped; the prompt instead tells Claude to note any apparent truncation in the review.)

### Why soft enforcement (prompt instructions) vs hard caps (allowlist patterns)

Hard caps via allowedTools patterns would be brittle (would need to match every reasonable invocation of `gh pr diff` and reject the unbounded form). Soft caps via prompt instructions are flexible — Claude generally follows the instruction, and the prompt's caching means the instruction itself is free to ship. Phase 1's RTK rollout will provide hard enforcement at the bash-hook layer for the same fetches.

## [0.6.3] — 2026-05-27

### Changed — Anthropic prompt caching via `APPEND_SYSTEM_PROMPT` env var

Route the 215-line review prompt into the Claude Code CLI's auto-cached
system layer instead of the un-cached user-message body. Anthropic bills
cached input tokens at **10% of standard input** (5-min TTL). Within a
5-min window, the second+ PR review in any consuming repo hits cache.

- **Templates updated** (workflow{,-ts,-py}.yml.tmpl): the prompt content (still produced by `reviewPrompt(...)`) moves from `with.prompt:` to `env.APPEND_SYSTEM_PROMPT`. The action's `src/entrypoints/run.ts` reads `process.env.APPEND_SYSTEM_PROMPT` and passes it to the SDK's `systemPrompt.append`, landing it inside the CLI's auto-cached system layer.
- **User-message `prompt:`** is now a minimal directive ("Review this pull request following the discipline in your system prompt..."), not the full instruction block. The action wraps it with PR context (diff, comments) automatically.
- **`show_full_output: true`** added to expose `cache_read_input_tokens` / `cache_creation_input_tokens` in the run's result JSON for measurement.
- **Test (`test/prompts.test.js`, +1)**: assert `APPEND_SYSTEM_PROMPT` block is byte-identical across two synthetic reviews of the same repo (cache prerequisite — any per-PR data leaking into the prefix would invalidate the cache).

### Critical pitfall avoided

Per Anthropic docs, cached content must be byte-stable across requests
(no PR numbers, timestamps, or SHAs in the prefix) and the prefix must
clear ~1024 tokens. Our prompt is ~3,500 tokens of pure rules content
— no dynamic data, well over the threshold.

### Verification post-rollout

After this lands and propagates, consuming repos' clud-bug reviews
should show non-zero `cache_read_input_tokens` on the 2nd+ review in
any 5-min window (visible via `gh run view --log` on a workflow run
when `show_full_output: true` is set).

## [0.6.2] — 2026-05-27

### Changed — extract review prompt to `lib/prompts.js` (refactor only, behavior preserved)

The 215-line review prompt previously lived inline in
`templates/workflow{,-ts,-py}.yml.tmpl` (×3 copies, with language-specific
bullets diverging per file). v0.6.2 moves it to a single source-of-truth
function `reviewPrompt({projectDescription, language})` in `lib/prompts.js`.

- **NEW `lib/prompts.js`** — `reviewPrompt(...)` accepts `language: 'generic' | 'ts' | 'py'` and emits the appropriate bullets in the "Focus on:" list. All three language variants produce identical content elsewhere; only the bullets diverge per language (matching pre-extraction template behavior).
- **NEW `templateLanguage(tmplName)`** export in `lib/render.js` — maps a `pickTemplate()` result to the language key `reviewPrompt` expects, so callers don't repeat the switch.
- **Indent-aware multi-line substitution** in `lib/render.js`. When a `{{TOKEN}}` placeholder's value contains newlines, continuation lines inherit the placeholder's leading whitespace so YAML/Markdown indent context is preserved. Blank lines stay blank (no trailing whitespace).
- **Templates updated** to use `{{REVIEW_PROMPT}}` instead of the old `{{PROJECT_DESCRIPTION}}` + `{{LANGUAGE_HINTS}}` tokens. `templates/workflow.yml.tmpl` drops from 322 → 108 lines; `workflow-ts.yml.tmpl` from 287 → 70; `workflow-py.yml.tmpl` from 286 → 69.
- **Callers updated** (`bin/clud-bug.js`, `lib/update.js`) to compute the prompt via `reviewPrompt(...)` and pass `REVIEW_PROMPT` to `renderFile`.
- **Tests** (`test/prompts.test.js`, +13) cover: required args, language variants, structural markers, rendered template output, `templateLanguage` mapping, indent-aware render.
- **Cosmetic cleanup**: the old `{{LANGUAGE_HINTS}}: ''` substitution left a `            ` (12-space blank) line in the rendered prompt. Post-extraction this line is a plain blank, matching cleaner conventions and avoiding trailing whitespace in shipped workflow files. Semantically identical; YAML treats both as blank lines in the `prompt: |` block.

### Why this matters (downstream)

This refactor is the prerequisite for v0.6.3 (Anthropic prompt caching
via `appendSystemPrompt`) and v0.6.4 (per-section prompt budgets) — both
need a programmable prompt structure to split the stable prefix from the
variable suffix.

## [0.6.1] — 2026-05-27

### Fixed

- **`clud-bug-collaboration` baseline regression on `clud-bug update`.** v0.6.0's `BASELINE_SKILLS_REF` pinned `thrillmade/agent-skills` at SHA `a445597…` — a commit from BEFORE the agent-skills org migration whose `clud-bug-collaboration/SKILL.md` still contained pre-migration `thrillmot/clud-bug` and `thrillmot/agent-skills` URLs (lines 123–124). `loadBaseline` prefers the remote at the pinned SHA over the bundled local copy, so every `clud-bug update` against v0.6.0 wrote the dead-URL version onto disk. Bumped the SHA to `436963e…` (`thrillmade/agent-skills@main` at the time of this release), which has the canonical `thrillmade/` URLs throughout. Bundled local `templates/skills/baseline/clud-bug-collaboration.md` was already correct; only the remote pin was stale.

## [0.6.0] — 2026-05-27

### Added

- **`excludedBaselines: string[]` field in `.clud-bug.json`.** Lets a consumer repo opt out of any bundled baseline skill. Names listed there are (a) skipped when `runUpdate` iterates the bundled baseline dir, and (b) actively cleaned up: if `.claude/skills/<slug>/` exists, it's `rm -rf`'d in the same pass and surfaced in the `changed` list as `excluded baseline <name>: removed`. Idempotent — re-runs are no-ops once the dir is gone. The field passes through `readManifest` / `writeManifest` unchanged (existing `...data` / `...manifest` spreads carry it).
- **Tests** (`test/update.test.js`, +2): one for the skip-on-write path, one for the migration cleanup path (pre-existing dir gets removed + reported in `changed`).

### Why a minor bump (0.5.x → 0.6.0)

New manifest field is additive but represents the first opt-out surface for bundled baselines — a deliberate API addition, not a bug fix. Existing manifests without the field behave identically to v0.5.x (the loop falls through to the existing write path). Test count: 167.

### Motivation

Pre-v0.6.0, the baseline-write loop in `lib/update.js` iterated the bundled baseline dir on every `clud-bug update` and unconditionally wrote each SKILL.md into `.claude/skills/<slug>/`. A consumer repo could `rm -rf` a baseline dir or remove its manifest entry, but the next update silently regenerated the dir from the bundled copy — making per-repo opt-out impossible. Surfaced concretely in `thrillmade/agent-skills`, which doesn't need `clud-bug-collaboration` because the repo *is* the skill catalog and the skill's "how to coexist with the clud-bug bot" guidance doesn't apply when there's no upstream-bot relationship.

## [0.5.16] — 2026-05-26

### Improved (UX)

- **`classifyPerSkillOutcome` accepts natural bot phrasings** in `lib/skills.js`. Previously the classifier required literal `0 findings` / `0 finding` / `n/a` to mark a per-skill check-run success. Natural phrasings the bot actually uses — `0 critical findings`, `no findings to anchor`, `zero performance findings`, `not applicable`, `✓ all anchored` — all classified as failure, causing recurring false-positive per-skill check-run fails on every clean PR with `strictSkills` set. v0.5.16 broadens the success regex:
  - `\b(?:0|no|zero)\s+(?:\S+\s+){0,3}finding` — quantifier + 0–3 modifier words + "finding(s)". Matches "0 findings", "no findings to anchor", "0 critical findings", "zero performance findings".
  - `\bnot\s+applicable\b` — explicit "not applicable" phrase.
  - `(?:^|\s)✓(?:\s|$|[.,;:])` — checkmark as the bot's universal clean signal, anchored on whitespace/punctuation to avoid false matches.
- **Hard-failure override preserved.** A new `\b[1-9]\d*\s+(?:\w+\s+){0,3}finding` regex catches any positive finding count (`1 finding`, `2 critical findings`, `10 findings`) BEFORE the success checks fire. So even if a line contains both `5 critical findings` AND `✓`, the failure wins. Existing `"10 findings"` regression test (from PR #57) still passes.
- **Documented limitation:** skill-specific vocabulary like `0 pattern fights` or `0 contract breaks` (no literal `finding` word) still classifies as failure. Skill authors should prefer the canonical `0 findings` wording in per-skill scan lines so the classifier doesn't need per-skill vocabulary knowledge. The `✓` checkmark works as a universal escape hatch.

### Changed

- **Composite pin bumped `@v0.5.15` → `@v0.5.16`** in all 3 review templates per the v0.5.15 release-discipline lock-step rule. No functional composite change — same byte content; the pin moves with `lib/skills.js`.
- **Template marker bumped `v9` → `v10`** so v0.5.7's refresh-mode propagates the new pin to existing installs.
- **Test count: 165** (+8 new in `test/skills.test.js` covering the broadened classifier).

## [0.5.15] — 2026-05-26

### Added (release discipline)

- **`test/release-discipline.test.js` enforces composite-pin lock-step in CI.** Two assertions:
  1. The `strict-mode-gate@vX.Y.Z` pin in all 3 review templates (`workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`) must equal the current `package.json` version. Catches the exact gap that caused v0.5.13's sort fix to ship to npm unreachable from any deployed workflow (required v0.5.14 hotfix solely to bump the pin).
  2. All 3 review templates must agree on the same pin. Catches the case where someone edits one template and forgets the other two.
- **Cost of the lock-step rule:** every release now bumps the composite pin even if `.github/actions/strict-mode-gate/action.yml` didn't change in that release — one line per template + the marker bump. Acceptable price for eliminating the silent-fix-not-reachable class of bug that bit twice this stream (v0.5.10→v0.5.12 caught and bundled; v0.5.13→v0.5.14 missed and hotfixed).
- **`action.yml` header doc fixed** to point at `@v0.5.15` (was `@v0.5.12`). Reader copy-pasting the usage example would have landed on the KNOWN-BROKEN ref pre-fix. Flagged by clud-bug-review on PR #65.

### Changed

- **Composite pin bumped `@v0.5.13` → `@v0.5.15`** in all 3 review templates (per the new lock-step rule). No-op for the composite's behavior — `action.yml` and `lib/skills.js` are byte-identical to v0.5.14. Pure mechanical bump.
- **Template marker bumped `v8` → `v9`** so v0.5.7's refresh-mode propagates the pin to existing v8 installs.

## [0.5.14] — 2026-05-26

### Fixed (shipping gap from v0.5.13)

- **Composite ref bumped `@v0.5.12` → `@v0.5.13`** in `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`. v0.5.13 shipped a sort fix in `lib/skills.js` (`selectReviewHeader` / `selectReviewBody` now sort newest-first explicitly) — but the templates kept the `@v0.5.12` composite pin. The composite resolves `lib/skills.js` from `${{ github.action_path }}/../../../lib/skills.js`, which is the composite's own checkout at the pinned tag. So at `@v0.5.12`, the composite kept loading the OLD `lib/skills.js` without the sort fix — meaning v0.5.13's fix was on npm but unreachable from any deployed workflow.
- **Template marker bumped `v7` → `v8`** to trigger v0.5.7's refresh-mode on existing v7 installs. Existing strictMode installs auto-upgrade and finally pick up the gate fix that was supposed to land in v0.5.13.
- No code or test changes — `lib/skills.js` is byte-identical to v0.5.13. The fix is purely the version pin in templates.

### Process note

This is the second time a fix in `lib/skills.js` shipped without the matching composite pin bump (v0.5.10 → v0.5.12 had the same pattern, but the bump was bundled into v0.5.12's PR). When `lib/skills.js` changes for the composite's use case, the templates MUST bump the composite pin in lock-step — otherwise installs run the old code. Worth adding a test that asserts the composite pin in templates matches the current package.json version.

## [0.5.13] — 2026-05-26

### Fixed (caught by PR #64 dogfood after the prompt change)

- **`selectReviewHeader` / `selectReviewBody` now sort by `created_at` descending in Node** instead of relying on `gh api ?sort=created&direction=desc`. GitHub's REST issue-comments endpoint **ignores `direction=desc`** and returns ascending (oldest first) regardless. So the v0.5.12 helpers walked oldest-first and picked the OLDEST matching comment, not the newest — meaning every fix-push review on a strictMode-enabled repo had its gate verdict shadowed by the original round's "— critical findings" comment. Strict mode fired forever on critical-resolved PRs. Caught when PR #64's round-2 "— clean" review still saw the gate fail. 3 new regression tests in `test/skills.test.js` pin the explicit-sort contract.

### Fixed (silent no-op since launch)

- **The bot now actually posts inline review threads.** Pre-v0.5.13 the workflow prompt told the bot to "post your review as a single PR comment" with a buried, weakly-phrased mention of the `mcp__github_inline_comment__create_inline_comment` MCP tool. Effect: every review across every install posted a top-level PR comment (not gateable) and **zero inline review threads** (the only thing GitHub's `required_review_thread_resolution` rule operates on). The reporulez `clud-bug-logmind` ruleset variant has the rule turned on, so the gate has been sitting idle waiting for the bot to actually produce threads — *the entire fix-and-resolve loop the README + status block were designed around has been a silent no-op since the bot shipped*. Caught when verifying PR #63's gate behavior end-to-end.

- **Prompt restructure makes inline threads the primary surface for each finding**, with the top-level summary PR comment as the secondary surface for the strict-mode gate header + status block. The default is now: if a finding can name `file:line`, post it inline via the MCP tool; fall back to summary-only only for structural / cross-cutting findings. Each inline finding becomes a resolvable conversation the author can mark resolved when the fix lands; the loop that produces the "resolved from prior" counter in v0.5.4's status block now has real data to count.

- **Fix-push flow strengthened.** The prompt now explicitly tells the bot to list prior `claude[bot]` inline review threads via GraphQL and resolve the ones whose issue is verifiably fixed in the head diff, ordered BEFORE the new review posts. This is the loop-closing signal — the "resolved from prior" counter proving the bot read the author's fixes — that v0.5.4 introduced as a UI feature without the underlying prompt flow.

### Changed

- **Template marker bumped `v6` → `v7`** in `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`. Existing v6 installs auto-upgrade via v0.5.7's refresh-mode on the next `clud-bug update`.
- `audit.yml.tmpl` (`v2`) and `self-update.yml.tmpl` (`v1`) unchanged — they don't carry the review prompt.

### Migration / dogfood

Repos already running with `required_review_thread_resolution: true` (any install from the reporulez `clud-bug-logmind` variant) immediately benefit on the next PR opened against `main` after `clud-bug update` lands. Threads block merge until resolved. No ruleset change required.

### Changed (docs/marketing, Stream BB.4 — carry over)
- **README first paragraph + npm `description` reframed skill-first.** Lead with "Ship a brand-voice skill, get brand reviews. Each finding cites the skill that motivated it." instead of the prior "project-aware skills" framing. Names the causal claim (write skill → get matching review) instead of describing the architecture. Baselines (bug-finding/security/perf/evidence) explicitly called out as out-of-the-box.
- **`site/app/page.tsx` hero subtitle** swapped from `A field naturalist for your codebase.` → `Skills you write. Reviews the bot does.` Same field-naturalist binomial below as visual signature. Concrete value prop in the position a reader actually reads first.

## [0.5.12] — 2026-05-26

### Fixed (correctness regression)

- **Strict-mode gate now actually fires on critical findings.** The composite `strict-mode-gate` action's pre-v0.5.12 jq filter used `.body | startswith("## 🐛 Clud Bug review")` to find the bot's review comment. But `anthropics/claude-code-action` prepends a `**Claude finished @user's task in Nm Ns**` preamble (followed by a "View job" link) to every bot comment, so the H2 sentinel never appears at body position 0. The filter matched **zero** comments in practice — silently disabling strict mode on every install with `strictMode: true` since v0.5.8 shipped the composite. Bot wrote `## 🐛 Clud Bug review — critical findings`, gate passed anyway.

  **Discovery:** this repo dogfooded BB.3 on PR #60 (the first PR after #59 opted in). clud-bug-review flagged 1 critical finding with the strict-mode header — and the check passed when it shouldn't have. Caught by reading the workflow logs after merge.

- **Per-skill check-runs (BB.3) now actually emit.** The composite action's BB.3 step 2 contained the SAME broken jq filter as the gate step. Per-skill check-runs have been silently skipped on every install with `strictSkills` opt-in since v0.5.10 shipped BB.3 — every workflow run logged `##[warning]No clud-bug review comment found yet — skipping per-skill check-runs.` and exited 0 without calling the Checks API. Both bots on PR #61 caught this when only step 1 was initially fixed.

- **Both fixes share new Node helpers** in `lib/skills.js`:
  - `selectReviewHeader(comments, botLogin)` → first H2 header line (gate step)
  - `selectReviewBody(comments, botLogin)` → full body for per-skill outcome parsing (BB.3 step)
  - `extractFirstReviewHeaderLine(body)` + `isCriticalReviewHeader(headerLine)` → underlying primitives
  Composite calls into Node via the same `SKILLS_LIB` pattern v0.5.10 established for `classifyPerSkillOutcome`. Header-extraction uses a multi-line regex anchored on start-of-line: `/^## 🐛 Clud Bug review[^\n]*/m`. Preserves the original "don't trip on quoted sentinels in body text" safety property — a comment that mentions the sentinel in prose (inline-code, blockquote) won't match because it's not at start-of-line.

- **17 new unit tests** in `test/skills.test.js` pin both contracts: extraction past the claude-code-action preamble (regression guard for both helpers), null on no-sentinel input, no-match on quoted-in-prose, first-of-multiple H2 picked, bot-login filter respected, configurable `bot-login` for the v0.6 App's `clud-bug[bot]` identity, and end-to-end BB.3 flow (`selectReviewBody` → `extractPerSkillLine` → `classifyPerSkillOutcome`).

### Changed

- **Composite action ref bumped `@v0.5.10` → `@v0.5.12`** in the 3 review workflow templates. Existing v5 installs auto-upgrade to v6 via v0.5.7's refresh-mode on the next `clud-bug update` and pick up the corrected gate.
- **Template marker bumped `v5` → `v6`** in `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`. `audit.yml.tmpl` (`v2`) and `self-update.yml.tmpl` (`v1`) unchanged — they don't carry the gate.
- **`strict-mode-gate@v0.5.10` and `@v0.5.8` are now KNOWN-BROKEN.** Users on those refs should refresh via `npx clud-bug update` (or wait for Monday's self-update cron) to land on `@v0.5.12`. No data is at risk; the gate + BB.3 per-skill check-runs just haven't been doing what their names promised since they shipped.

## [0.5.11] — 2026-05-26

### Added

- **`anthropics/claude-code-action` is now pinned to a specific tag** in every shipped workflow. Templates use `@{{CCA_VERSION}}` instead of the floating `@v1` major. The pin lives in `lib/render.js`'s new `DEFAULTS` map (currently `v1.0.133` — the latest stable at release time). Bumping the pin requires a clud-bug release, which makes upstream action upgrades visible in the CHANGELOG and lets users with their own forks opt to a different version. Closes the Unreleased item that's been carried since v0.5.6.
- **`audit.yml.tmpl` and `self-update.yml.tmpl` now flow through `renderFile`** (were raw `readFile` pre-v0.5.11). Required to make `{{CCA_VERSION}}` substitution land in audit alongside review. Self-update has no CCA reference today but is routed through `renderFile` for parity so future tokens propagate uniformly without another refactor.
- **`DEFAULTS` exported from `lib/render.js`.** Single source of truth for template substitution defaults. The v0.6 App will reuse this map to render workflows in its own runtime, keeping the pin contract identical across CLI + App.

### Changed

- **Template markers bumped:**
  - `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`: `v4` → `v5`
  - `audit.yml.tmpl`: `v1` → `v2` (first content change since markers were introduced in v0.5.6)
  - `self-update.yml.tmpl`: stays `v1` (no content change; the `readFile` → `renderFile` switch is internal to clud-bug, byte-identical output today)
- Existing v4/v1 installs auto-upgrade to v5/v2 via v0.5.7's refresh-mode on the next `clud-bug update`.

### Internal

- 4 new tests in `test/render.test.js` pin the DEFAULTS contract: CCA_VERSION format (`vMAJOR.MINOR.PATCH`), substitution from defaults when caller omits it, caller-override precedence, missing-var guard still fires for non-defaulted tokens.

## [0.5.10] — 2026-05-18

### Added — Stream BB.3 (per-skill check-runs via GitHub Checks API)

- **Composite strict-mode-gate action now emits per-skill check-runs.** For each skill listed in the base manifest's new `strictSkills` array, the composite emits a separate check-run via `POST /repos/{owner}/{repo}/check-runs`. The check-run's conclusion is derived from the skill's line in the latest review comment's `### Per-skill scan` block:
  - line contains `0 findings` / `0 finding` / `n/a` → `conclusion: success`
  - any other content (`N finding`, `N findings` with N>0) → `conclusion: failure`
  - skill not mentioned in the review → `conclusion: failure` (GitHub treats `neutral` as passing for required checks — a missing skill must fail loud, not silently green)

  Each emitted check-run shows up in the PR's check list with the skill name as the check name (`brand-voice-review`, `pii-and-compliance`, etc.) and is **individually gateable in branch protection** — letting a repo require a clean `brand-voice-review` check alongside the master `clud-bug-review` check.

  **Opt-in.** Users who don't set `strictSkills` see no behavior change. The composite emits zero check-runs and exits 0.

  Example `.claude/skills/.clud-bug.json`:
  ```json
  {
    "strictMode": true,
    "strictSkills": ["brand-voice-review", "pii-and-compliance"]
  }
  ```

- **`checks: write` permission added to all 3 workflow templates** — required for the Checks API call. No-op for users who don't configure `strictSkills`.

### Changed

- **Template marker bumped `v3` → `v4`** in `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`. Existing v3 installs auto-upgrade via v0.5.7's refresh-mode on the next `clud-bug update`.
- **Composite action ref bumped `@v0.5.8` → `@v0.5.10`** in the same three templates. v0.5.9 installs that adopted v3 templates will need a `clud-bug update` to pick up the v4 templates referencing the new action ref.
- **`strict-mode-gate@v0.5.8` continues to resolve unchanged** — the action's strict-mode gate logic is byte-identical at both refs. Existing v3 templates pointing at `@v0.5.8` keep working; only the per-skill check-runs behavior (BB.3) is gated behind the `@v0.5.10` ref.

## [0.5.9] — 2026-05-18

### Added — Stream BB.1 + BB.2 (skill routing + per-skill review output)

- **`review_mode` frontmatter field on skills.** Every SKILL.md can declare `review_mode: shared` or `review_mode: dedicated` (default: `shared` when omitted). The four shipped baselines (`critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`, `clud-bug-collaboration`) now declare `review_mode: shared`. Domain skills published in [thrillmade/agent-skills](https://github.com/thrillmade/agent-skills) (`brand-voice-review`, `api-contract-enforcement`, `pii-and-compliance`, `test-discipline`) declare `review_mode: dedicated`.
- **`readReviewMode(content)` + `partitionByReviewMode(skills)` in `lib/skills.js`** — parsing + bucketing helpers. Single source of truth that the upcoming v0.6 GitHub App will reuse to route literal parallel Claude calls.
- **Per-skill review output structure.** The workflow prompt now requires:
  - A `### Per-skill scan` block under the status line — one line per loaded skill, even silent ones. Forces the bot to acknowledge each skill explicitly (anti-dilution for shared skills, visibility for dedicated ones).
  - Dedicated H3 sections (`### Brand voice [brand-voice-review]`) for each dedicated-mode skill that produced findings.
  - Shared-mode skill findings stay in the existing combined Critical/Minor buckets (preserves cross-correlation).

### Changed

- **Template marker bumped `v2` → `v3`** in `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`. Existing v2 installs auto-upgrade via v0.5.7's refresh-mode on the next `clud-bug update`.

### Architecture note

v0.5.9 ships the user-visible BB.1+BB.2 behavior via prompt restructuring inside the existing single `claude-code-action` call — same one-Claude-call cost model. The v0.6 GitHub App will use the same `review_mode` metadata to route to literal parallel API calls (one shared + N dedicated, per the locked architecture decision). The frontmatter contract is identical across both runtimes.

## [0.5.8] — 2026-05-18

### Added
- **Composite strict-mode-gate action.** The ~24 lines of inline shell that v0.5.x rendered into every workflow template now live in `.github/actions/strict-mode-gate/action.yml`. Templates reference it via `uses: thrillmade/clud-bug/.github/actions/strict-mode-gate@v0.5.8`. The contract is unchanged (read base ref's `.clud-bug.json`; if `strictMode: true`, fail the check when the latest review's first line starts with `## 🐛 Clud Bug review — critical findings`). Same identifier, same exit code, same comment-grep — just factored out so a single edit ships across all 3 templates + the upcoming v0.6 GitHub App runtime. Adds a `bot-login` input (defaults to `claude[bot]`) so the same gate can serve the v0.6 App which will post as `clud-bug[bot]`.

### Changed
- **Template marker bumped `v1` → `v2`** in `workflow.yml.tmpl`, `workflow-ts.yml.tmpl`, `workflow-py.yml.tmpl`. Existing v1 installs will be refreshed to v2 on the next `clud-bug update` (using v0.5.7's refresh-mode), and the rendered workflows will pick up the composite-action reference automatically. `audit.yml.tmpl` and `self-update.yml.tmpl` are unchanged (still v1) — they don't carry the gate.

## [0.5.7] — 2026-05-18

### Added
- **`clud-bug update` refresh-mode** — uses the `# clud-bug-template-version:` marker that v0.5.6 + PR #52 added to every workflow template. `clud-bug update` now reads each installed workflow's marker, refreshes files whose marker is stale (logging the `vN → vN+1` transition), and **leaves markerless files alone** — treating them as user-customized. The recovery path is the logmind v0.2.1-style "delete the file + run `clud-bug init`" — printed in the `Skipped` block of `clud-bug update`'s output. Foundation for clean future template upgrades; mirrors the marker-driven contract logmind shipped in v0.2.1.
- **`runUpdate` now refreshes `clud-bug-self-update.yml`** alongside `clud-bug-review.yml` and `clud-bug-audit.yml`. The self-update workflow was previously left alone after init — meaning template improvements to the cron + PR-open logic never reached existing installs. Now subject to the same marker-driven refresh.

### Migration note
Installs predating PR #52 have markerless workflows. The first `clud-bug update` run on those repos will print the markerless files in a `Skipped` block with the recovery hint. Installs created from a clud-bug version that included PR #52 (or later) already have `v1` markers in place and will refresh normally. Two paths for the markerless case:
1. **Adopt refresh-mode**: `rm .github/workflows/clud-bug-*.yml && clud-bug init` (or `npx clud-bug@latest init`) — re-renders with v1 markers in place. Future updates pick up automatically.
2. **Keep customizations**: leave the files alone; they'll continue to work, and `clud-bug update` will keep skipping them. Manual sync with templates is on you.

## [0.5.6] — 2026-05-18

### Changed
- **Bumped `actions/checkout@v5` → `@v6`** in all 5 workflow templates (`workflow.yml.tmpl`, `workflow-ts`, `workflow-py`, `audit.yml.tmpl`, `self-update.yml.tmpl`). v6 ships with Node 24 natively, so the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'` shim that v5 needed (a workaround for Node 20 deprecation) is gone. Net -10 lines across the templates; one less workaround future maintainers won't understand.

### Added
- **`Bash(git show:*)`** added to the `--allowedTools` list in `workflow.yml.tmpl` + `workflow-ts.yml.tmpl` + `workflow-py.yml.tmpl`. Defensive — the bot doesn't currently need `git show` (the strict-mode gate uses it from a separate shell step, not inside `claude-code-action`), but future prompt enhancements that read base-ref state from inside the action would silently fail without it.

## [0.5.5] — 2026-05-18

### Added
- **`clud-bug init` offers to enable `required_conversation_resolution`** on the default branch. The bot already auto-resolves its own review threads when fixes land; without this branch-protection setting, that auto-resolution doesn't gate merges. The init step detects your repo + default branch via `gh`, inspects the current state, and prompts to enable. Failure modes (no admin perms, no base protection rule, network error) degrade to advisory messages — they never fail init.
- **New flag `--no-set-protection`** — skips the prompt + API call entirely. For repos that manage branch protection via ruleset or org policy (and don't want clud-bug editing branch protection from underneath them).
- `--accept-all,-y` now also auto-accepts the branch-protection prompt.

### Notes
- `clud-bug init` still works in repos without `gh` installed or in non-GitHub-hosted repos. The branch-protection step prints a one-line advisory and moves on.

## [0.5.4] — 2026-05-18

### Added
- **Status block at the top of every review.** Every Clud Bug PR-review comment now begins (immediately under the `## 🐛 Clud Bug review` header) with a single-line status block: `**This round:** N critical · N minor · N resolved from prior · N still open`. The four counters tell the author and any agent reading the comment exactly what changed since the last review pass — most importantly, **resolved from prior** is the loop-closing signal that proves the bot read their fixes and cleared the corresponding threads, not just listed new complaints. Format is identical on every review (zero values included) so it's grep-able and machine-parseable.

## [0.5.3] — 2026-05-15

### Changed
- **No functional changes.** Metadata-only release. The Stream A2 backfill of v0.4.1, v0.5.0, v0.5.1, v0.5.2 via parallel `workflow_dispatch` finished out of order, leaving npm's `latest` dist-tag pinned to v0.5.1 instead of v0.5.2. npm Trusted Publishing currently authenticates `publish` only — `dist-tag` operations need a long-lived token, which we deliberately don't store. Republishing as v0.5.3 lets the standard tag-push → OIDC-publish flow naturally promote the new version to `latest`. The on-disk code is byte-identical to v0.5.2.

## [0.5.2] — 2026-05-15

### Changed
- **Bumped baseline-skills SHA pin to [`a4455977`](https://github.com/thrillmade/agent-skills/commit/a44559770686e6c51d08ba5bb842d78f85876fb2)** so all four baseline skills (`critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`, `clud-bug-collaboration`) now resolve from `thrillmade/agent-skills` instead of silently falling back to bundled copies. Prior pin pointed at a tree where only `skills/logmind/SKILL.md` existed; every install was fallback-only. Fresh installs will now log `baseline kit: 4 specimens (from thrillmade/agent-skills)` instead of `(bundled fallback)`. Bundled copies still ship as the offline fallback.

## [0.5.1] — 2026-05-15

### Added
- **`clud-bug init` now briefs other agents.** A self-contained `<!-- clud-bug-start -->` block (mirroring the well-established logmind pattern) is added to `AGENTS.md` (created if missing — it's the canonical cross-tool home) and idempotently appended to `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.continuerules`, and any `.md` files under `.cursor/rules/` — but only where those files already exist (no proliferating stubs the user didn't ask for). The block documents how to coexist with the bot's review threads, where the skills live, the strict-mode toggle, and the workflow-self-mod gotcha. Re-runs replace the prior block in place; running with a new clud-bug version updates it.
- **New baseline skill `clud-bug-collaboration`.** Higher-fidelity guidance for Claude Code agents working in a clud-bug-installed repo: when to defer to bot thread resolution, how to read the `clud-bug-review` check status, why `claude-code-action` rejects PRs that modify its own workflow, how to disable strict mode safely (read from base ref so a PR can't disable on itself). Ships in the baseline kit alongside the existing three; canonical home will be `thrillmade/agent-skills/skills/clud-bug-collaboration/SKILL.md` on the next agent-skills SHA bump.
- `clud-bug update` also refreshes the AGENTS.md / CLAUDE.md block so the embedded version + strict-mode line stay current after subsequent updates.

## [0.5.0] — 2026-05-15

### Changed
- **Baseline skills now sourced from [thrillmade/agent-skills](https://github.com/thrillmade/agent-skills) at install time, pinned to a specific commit SHA.** `clud-bug init` fetches `https://raw.githubusercontent.com/thrillmade/agent-skills/<SHA>/skills/<name>/SKILL.md` for each baseline (`critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`). The SHA is pinned in `lib/skills.js` (currently `977e439…`) — bumping it requires a clud-bug release, so a compromised commit on agent-skills can't silently land in users' Claude review skills mid-cycle.
- Fetched skills are cached at `~/.cache/clud-bug/skills/` for 24h. Cache keys include the upstream base URL, so switching bases (via `CLUD_BUG_AGENT_SKILLS_BASE` env override) doesn't poison the cache across forks.
- Network failures, 404s, empty bodies, and 5s timeouts fall back to the bundled copy shipped in the npm package — works fully offline.
- Baseline fetches now run in parallel (`Promise.all`), so a fully unreachable upstream caps at one timeout total instead of three (was ~15s, now ~5s).
- Init log shows the source: `baseline kit: 3 specimens (from thrillmade/agent-skills)` vs `(bundled fallback)` vs a mixed-count form.
- Override the upstream URL via `CLUD_BUG_AGENT_SKILLS_BASE` env var (test seam + fork support).

## [0.4.1] — 2026-05-15

### Added
- **`clud-bug edit-workflow` CLI** — packages clud-bug-workflow edits into an isolated PR. `claude-code-action` refuses to run on PRs that modify its own workflow (a security guard); this command keeps the scope clean so non-workflow work isn't blocked alongside it. Refuses to run if the working tree has non-workflow changes.
- **README "When you edit the workflow"** subsection — documents the upstream self-mod guard so the 401 error doesn't surprise users.

## [0.4.0] — 2026-05-15

### Changed (breaking)
- **Strict mode is now the default for new installs.** `clud-bug init` writes `{ "strictMode": true }` to `.claude/skills/.clud-bug.json`. Reviews that flag critical issues fail the workflow check — pair with branch protection's required status checks for a real merge gate. Existing installs are NOT auto-flipped (the field is only set when missing); your prior advisory behavior is preserved unless you add the field. To opt new installs into advisory, set `strictMode: false`.

### Added
- **Bot-authored PRs are now handled gracefully.** PRs from `dependabot[bot]`, `renovate[bot]`, or forks (where GitHub deliberately doesn't pass repository secrets) used to fail loudly red — wrong signal. Now a guard step detects the case, posts a one-line advisory comment ("Clud Bug skipped — bot/fork PR cannot access secrets"), and exits 0. Check stays green; the skip is visible. Owner-authored PRs without the secret still fail loud.
- **Site polish (carries over from the unreleased entry):** alive bug emoji (layered breathe + twitch + scuttle animations), Plate label gloss, thrillmot footer credit.

[0.5.16]: https://github.com/thrillmade/clud-bug/compare/v0.5.15...v0.5.16
[0.5.15]: https://github.com/thrillmade/clud-bug/compare/v0.5.14...v0.5.15
[0.5.14]: https://github.com/thrillmade/clud-bug/compare/v0.5.13...v0.5.14
[0.5.13]: https://github.com/thrillmade/clud-bug/compare/v0.5.12...v0.5.13
[0.5.12]: https://github.com/thrillmade/clud-bug/compare/v0.5.11...v0.5.12
[0.5.11]: https://github.com/thrillmade/clud-bug/compare/v0.5.10...v0.5.11
[0.5.10]: https://github.com/thrillmade/clud-bug/compare/v0.5.9...v0.5.10
[0.5.9]: https://github.com/thrillmade/clud-bug/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/thrillmade/clud-bug/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/thrillmade/clud-bug/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/thrillmade/clud-bug/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/thrillmade/clud-bug/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/thrillmade/clud-bug/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/thrillmade/clud-bug/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/thrillmade/clud-bug/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/thrillmade/clud-bug/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/thrillmade/clud-bug/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/thrillmade/clud-bug/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/thrillmade/clud-bug/compare/v0.3.4...v0.4.0

## [0.3.4] — 2026-05-15

### Added
- **Strict mode (opt-in)** — set `strictMode: true` in `.claude/skills/.clud-bug.json` and the workflow check fails when Clud Bug flags any critical issue. Default behavior is unchanged: advisory (green check when the bot ran, regardless of findings). Pair with branch protection's required-status-checks for a real merge gate. Toggleable per-repo without rewriting any workflow.

## [0.3.3] — 2026-05-15

### Fixed
- **No more silently-green checks when `ANTHROPIC_API_KEY` is missing.** All review + audit + baseline workflows now have a guard step that fails the job with an actionable `::error::` message when the secret is empty. Fork PRs (where GitHub deliberately withholds secrets) get a `::warning::` and exit 0 — the documented by-design behavior. Eliminates the footgun where users thought Clud Bug was reviewing when it wasn't even running.

## [0.3.2] — 2026-05-15

### Changed
- **Skill enforcement is now hard, not soft.** Workflow prompt previously said "skills should shape your review — defer to their guidance" (a nudge). Now it says "Skills are not background context — they are review rules with authority. Before flagging any finding, scan loaded skills... your review MUST reference them by name." Reviews are also required to end with a `Skills referenced: [...]` footer. Result: every review now produces an explicit audit trail showing which skills shaped which findings.
- **`clud-bug init` warns when only baseline specimens get pinned.** Flag the case where the install gives users a generic Claude review instead of a project-aware one — points them at `clud-bug add` and custom skills.

## [0.3.1] — 2026-05-15

### Added
- **`clud-bug update` CLI** — re-renders the workflow templates and refreshes the bundled baseline specimens. Custom skills are never touched; remote (skills.sh-installed) skills are left alone unless explicitly refreshed via `clud-bug refresh`.
- **Self-update workflow** — `clud-bug init` now also installs `.github/workflows/clud-bug-self-update.yml`. Cron weekly (Mondays 12:00 UTC). Compares the manifest's `lastUpdateVersion` to npm's `clud-bug@latest`; if newer, runs `update` and opens a PR with the diff.
- **Pin escape hatch** — set `pinVersion` in `.claude/skills/.clud-bug.json` and the self-update workflow exits cleanly without opening PRs.
- **Manifest preserves arbitrary keys** — `lastUpdate`, `lastUpdateVersion`, `pinVersion`, etc. survive read/write cycles.

## [0.3.0] — 2026-05-15

### Added
- **`clud-bug audit` CLI** — walk the whole repo (or a slice) preparing a report stub. Filters: `--since <date>`, `--changed-in 7d|2w|1mo|1y`, `--scope <glob>` (repeatable).
- **Audit workflow** — `clud-bug init` now also installs `.github/workflows/clud-bug-audit.yml`. Manual trigger by default (cron commented). Spawns a Claude run that reads the stub, walks the manifest, appends findings, and opens a PR titled `🐛 Clud Bug audit — YYYY-MM-DD` so the report shows up in your normal PR review surface.
- **OG / Twitter card image at `/opengraph-image`** (and `/twitter-image`). Generated by `next/og` at the edge with the field-guide composition.
- **Favicon + Apple touch icon** via `site/app/icon.tsx` and `site/app/apple-icon.tsx`.
- **Live site data on `cludbug.dev`** — version, weekly downloads, count of PRs Clud Bug has reviewed, and the latest public review headline. Server-rendered with 1h revalidate; degrades gracefully on API failure.

### Fixed
- **Paragraph indent inconsistency on cludbug.dev.** Removed the `text-indent: 1.4em` rule on `.section-prose p + p`.
- **Bug-pin scuttle animation** snap removed by replacing the 45/47%/90% keyframes with a symmetric 35→65% scuttle.

[0.3.4]: https://github.com/thrillmade/clud-bug/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/thrillmade/clud-bug/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/thrillmade/clud-bug/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/thrillmade/clud-bug/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/thrillmade/clud-bug/compare/v0.2.2...v0.3.0

## [0.2.2] — 2026-05-15

### Changed
- **Brand voice extends past the site.** CLI log strings, README intro, and review-prompt tone now consistently inhabit the field-naturalist voice the site already used. The bot is told to address authors conversationally without sacrificing clarity or critical-issues-only discipline.
- **Color palette swap on cludbug.dev.** Replace the crimson accent with leaf-green primary + citrus-orange highlights — taken from the clud-bug emoji's actual colors. Crimson is now reserved for "critical issue" badges only.
- **Node.js 20 deprecation fix.** All workflow templates now bump `actions/checkout@v5` and `actions/setup-node@v5`, and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` so generated workflows stop emitting deprecation warnings ahead of GitHub's June 2 / Sept 16 cutovers.

## [0.2.1] — 2026-05-15

### Fixed
- Silence `bin[clud-bug] script name was cleaned` publish warning by switching to the shorthand `"bin": "bin/clud-bug.js"` form (preferred when the binary name matches the package name).

## [0.2.0] — 2026-05-15

### Added
- **Public npm release.** `npx clud-bug init` now works from any directory.
- **Skill management commands.** `clud-bug list`, `clud-bug add <source/name>`, `clud-bug remove <slug>`, `clud-bug refresh` — evolve your skill set after `init` without clobbering custom skills.
- **`.claude/skills/.clud-bug.json` manifest.** Tracks provenance so commands can distinguish baseline / skills.sh / custom skills.
- **`CLUD_BUG_SKILLS_SH_BASE` env var.** Test seam for overriding the skills.sh API base URL.
- **1-page site at [cludbug.dev](https://cludbug.dev).** Field-guide aesthetic; install instructions and the differentiating wedge in one place.
- **Parallel baseline review workflow** (`.github/workflows/claude-code-review.yml` in this repo only). Stock `anthropics/claude-code-action` runs alongside clud-bug-review for comparison until clud-bug's track record is established.
- **Auto-resolve prior review threads.** Workflow templates now teach the bot to resolve its own prior inline review threads when re-reviewing a PR, unblocking the conversation-resolution branch protection rule on iterative PRs.

### Fixed
- **`refresh` no longer mass-deletes skills when skills.sh is unreachable.** Previously, a transient API failure or `.catch(() => [])` would surface as an empty recommendation set, and `--accept-all` would silently remove every remote skill in the manifest. Now aborts with exit 1.
- **`refresh --offline` no longer mass-deletes remote skills.** Same root cause as above. In offline mode, removals are explicitly suppressed since the recommendation set isn't authoritative.

## [0.1.0] — 2026-03-11

### Added
- Initial release. `clud-bug init` CLI: detects repo signals, queries skills.sh, installs matching skills, generates a working `.github/workflows/clud-bug-review.yml`.
- Three workflow templates (generic / TS / Python) with the `--allowedTools` whitelist needed for `gh pr comment` to actually post reviews.
- Three baseline skills shipped in the package: `critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`.
- 28 unit tests, repo-level CI (test + actionlint).

[0.2.2]: https://github.com/thrillmade/clud-bug/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/thrillmade/clud-bug/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thrillmade/clud-bug/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thrillmade/clud-bug/releases/tag/v0.1.0
