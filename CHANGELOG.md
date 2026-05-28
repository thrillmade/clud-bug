# Changelog

All notable changes to clud-bug. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
