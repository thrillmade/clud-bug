# Changelog

All notable changes to clud-bug. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.13] — 2026-05-26

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

- **`review_mode` frontmatter field on skills.** Every SKILL.md can declare `review_mode: shared` or `review_mode: dedicated` (default: `shared` when omitted). The four shipped baselines (`critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`, `clud-bug-collaboration`) now declare `review_mode: shared`. Domain skills published in [thrillmot/agent-skills](https://github.com/thrillmot/agent-skills) (`brand-voice-review`, `api-contract-enforcement`, `pii-and-compliance`, `test-discipline`) declare `review_mode: dedicated`.
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
- **Composite strict-mode-gate action.** The ~24 lines of inline shell that v0.5.x rendered into every workflow template now live in `.github/actions/strict-mode-gate/action.yml`. Templates reference it via `uses: thrillmot/clud-bug/.github/actions/strict-mode-gate@v0.5.8`. The contract is unchanged (read base ref's `.clud-bug.json`; if `strictMode: true`, fail the check when the latest review's first line starts with `## 🐛 Clud Bug review — critical findings`). Same identifier, same exit code, same comment-grep — just factored out so a single edit ships across all 3 templates + the upcoming v0.6 GitHub App runtime. Adds a `bot-login` input (defaults to `claude[bot]`) so the same gate can serve the v0.6 App which will post as `clud-bug[bot]`.

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
- **Bumped baseline-skills SHA pin to [`a4455977`](https://github.com/thrillmot/agent-skills/commit/a44559770686e6c51d08ba5bb842d78f85876fb2)** so all four baseline skills (`critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`, `clud-bug-collaboration`) now resolve from `thrillmot/agent-skills` instead of silently falling back to bundled copies. Prior pin pointed at a tree where only `skills/logmind/SKILL.md` existed; every install was fallback-only. Fresh installs will now log `baseline kit: 4 specimens (from thrillmot/agent-skills)` instead of `(bundled fallback)`. Bundled copies still ship as the offline fallback.

## [0.5.1] — 2026-05-15

### Added
- **`clud-bug init` now briefs other agents.** A self-contained `<!-- clud-bug-start -->` block (mirroring the well-established logmind pattern) is added to `AGENTS.md` (created if missing — it's the canonical cross-tool home) and idempotently appended to `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.continuerules`, and any `.md` files under `.cursor/rules/` — but only where those files already exist (no proliferating stubs the user didn't ask for). The block documents how to coexist with the bot's review threads, where the skills live, the strict-mode toggle, and the workflow-self-mod gotcha. Re-runs replace the prior block in place; running with a new clud-bug version updates it.
- **New baseline skill `clud-bug-collaboration`.** Higher-fidelity guidance for Claude Code agents working in a clud-bug-installed repo: when to defer to bot thread resolution, how to read the `clud-bug-review` check status, why `claude-code-action` rejects PRs that modify its own workflow, how to disable strict mode safely (read from base ref so a PR can't disable on itself). Ships in the baseline kit alongside the existing three; canonical home will be `thrillmot/agent-skills/skills/clud-bug-collaboration/SKILL.md` on the next agent-skills SHA bump.
- `clud-bug update` also refreshes the AGENTS.md / CLAUDE.md block so the embedded version + strict-mode line stay current after subsequent updates.

## [0.5.0] — 2026-05-15

### Changed
- **Baseline skills now sourced from [thrillmot/agent-skills](https://github.com/thrillmot/agent-skills) at install time, pinned to a specific commit SHA.** `clud-bug init` fetches `https://raw.githubusercontent.com/thrillmot/agent-skills/<SHA>/skills/<name>/SKILL.md` for each baseline (`critical-issues-only`, `evidence-based-review`, `respect-existing-conventions`). The SHA is pinned in `lib/skills.js` (currently `977e439…`) — bumping it requires a clud-bug release, so a compromised commit on agent-skills can't silently land in users' Claude review skills mid-cycle.
- Fetched skills are cached at `~/.cache/clud-bug/skills/` for 24h. Cache keys include the upstream base URL, so switching bases (via `CLUD_BUG_AGENT_SKILLS_BASE` env override) doesn't poison the cache across forks.
- Network failures, 404s, empty bodies, and 5s timeouts fall back to the bundled copy shipped in the npm package — works fully offline.
- Baseline fetches now run in parallel (`Promise.all`), so a fully unreachable upstream caps at one timeout total instead of three (was ~15s, now ~5s).
- Init log shows the source: `baseline kit: 3 specimens (from thrillmot/agent-skills)` vs `(bundled fallback)` vs a mixed-count form.
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

[0.5.13]: https://github.com/thrillmot/clud-bug/compare/v0.5.12...v0.5.13
[0.5.12]: https://github.com/thrillmot/clud-bug/compare/v0.5.11...v0.5.12
[0.5.11]: https://github.com/thrillmot/clud-bug/compare/v0.5.10...v0.5.11
[0.5.10]: https://github.com/thrillmot/clud-bug/compare/v0.5.9...v0.5.10
[0.5.9]: https://github.com/thrillmot/clud-bug/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/thrillmot/clud-bug/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/thrillmot/clud-bug/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/thrillmot/clud-bug/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/thrillmot/clud-bug/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/thrillmot/clud-bug/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/thrillmot/clud-bug/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/thrillmot/clud-bug/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/thrillmot/clud-bug/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/thrillmot/clud-bug/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/thrillmot/clud-bug/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/thrillmot/clud-bug/compare/v0.3.4...v0.4.0

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

[0.3.4]: https://github.com/thrillmot/clud-bug/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/thrillmot/clud-bug/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/thrillmot/clud-bug/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/thrillmot/clud-bug/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/thrillmot/clud-bug/compare/v0.2.2...v0.3.0

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

[0.2.2]: https://github.com/thrillmot/clud-bug/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/thrillmot/clud-bug/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thrillmot/clud-bug/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thrillmot/clud-bug/releases/tag/v0.1.0
