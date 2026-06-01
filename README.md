# Clud Bug 🐛
### A field guide to specimens crawling your code

> **[cludbug.dev](https://cludbug.dev)** · live field journal.

Clud Bug is **skill-driven PR review** for your GitHub repo. Ship a brand-voice skill, get brand reviews. Ship a compliance skill, get PII checks on every diff. Each finding cites the skill that motivated it — the bot's authority comes from your specimens, not from generic advice.

Four baseline skills ship by default — covering bug-finding, evidence-based review discipline, pattern conformity, and agent coordination. Add more from [skills.sh](https://skills.sh) or write your own — the bot loads them automatically.

One command to install. The first PR you open afterwards gets a real review back — typically within two minutes.

## Quickstart

```bash
cd your-repo
npx clud-bug init
git add .claude .github/workflows/clud-bug-review.yml
git commit -m "Add clud-bug PR review"
git push

# OR — install the full SkDD toolchain (clud-bug + logmind) in one go:
npx clud-bug init --with-skdd   # subprocesses to `pip install logmind && logmind init`
```

Then in your repo on GitHub:
**Settings → Secrets and variables → Actions → New repository secret** → set `ANTHROPIC_API_KEY`.

Open a PR. A review comment should appear within ~2 minutes.

## What `clud-bug init` does

The naturalist arrives at your repo, surveys the habitat, and assembles a field kit:

1. **Surveys habitat.** Reads `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc., to learn what your stack is.
2. **Consults [skills.sh](https://skills.sh).** Pulls review skills relevant to your dependencies (e.g. a Next.js project gets Next.js review specimens).
3. **Pins baseline specimens** that enforce review discipline regardless of stack:
   - `critical-issues-only` — flag bugs, security, perf only. Skip nits.
   - `evidence-based-review` — every claim must quote the line being criticized.
   - `respect-existing-conventions` — don't suggest fights with the codebase's patterns.
   - `clud-bug-collaboration` — guidance for any other Claude Code agents working in your repo: how to coexist with bot review threads, how to read the gate, why workflow self-mods break the action, etc.
4. **Writes** the chosen specimens to `.claude/skills/<name>/SKILL.md` (Claude Code auto-loads them in the GitHub Action).
5. **Drafts the field kit** at `.github/workflows/clud-bug-review.yml` with your project description filled in and the right permissions/tool allowlist for `gh pr comment` to actually post.
6. **Briefs other agents** by adding a `<!-- clud-bug-start -->` block to `AGENTS.md` (creating it if missing — it's the cross-tool canonical), and idempotently to `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.continuerules`, and `.cursor/rules/*.md` where they already exist. Re-runs replace the prior block in place. Files you didn't already have are left uncreated — no proliferating stubs.
7. **Offers to enable `required_conversation_resolution`** on your default branch. Clud Bug auto-resolves its own review threads when fixes land — but that only gates merges when conversation-resolution is required. Init detects the current state via `gh`, prompts to enable (auto-yes with `--accept-all`), and degrades to an advisory message if you lack admin perms / `gh` isn't installed / the branch has no base protection rule. Pass `--no-set-protection` to skip the prompt entirely — for repos that manage branch protection via ruleset or org policy.

## CLI options

```
npx clud-bug init [options]

  --offline             Skip skills.sh; install only the bundled baseline skills.
  --accept-all,-y       Accept the recommended skill set (and the
                        branch-protection prompt) without prompting.
  --no-set-protection   Skip the prompt that offers to enable
                        required_conversation_resolution on the default
                        branch. For repos that manage branch protection
                        via ruleset or org policy.
  --commit              git add + commit the generated files when done.
  --help,-h             Show help.
```

## Staying up to date

`clud-bug init` ships a third workflow: `clud-bug-self-update.yml`. Once a week (Mondays 12:00 UTC), it checks npm for a newer `clud-bug` version. If one exists, it runs `clud-bug update` and opens a PR titled `🐛 Clud Bug self-update: vX.Y.Z → vA.B.C`. Custom and skills.sh-installed specimens are never touched — only baseline specimens and the workflow templates get refreshed.

You can also run the update manually:

```bash
clud-bug update
```

To pin a specific version and stop receiving update PRs, add `pinVersion` to `.claude/skills/.clud-bug.json`:

```json
{ "pinVersion": "0.3.0", ... }
```

## Auditing the whole repo

PR reviews catch issues entering. Audits catch issues that already crossed the line.

```bash
clud-bug audit                      # walk every tracked file
clud-bug audit --changed-in 7d      # only files touched in the last 7 days
clud-bug audit --since 2026-01-01   # only files touched since a date
clud-bug audit --scope 'src/**/*.ts'  # narrow by glob (repeatable)
```

The CLI prepares an `audits/YYYY-MM-DD.md` stub. For findings, `clud-bug init` also installed `.github/workflows/clud-bug-audit.yml` — go to **Actions → Clud Bug 🐛 Audit → Run workflow**. Clud Bug walks the manifest, appends findings to the same file, opens a PR you can read, act on, then merge or close.

The workflow ships with `workflow_dispatch` only (manual). The cron is in the file, commented — uncomment for weekly audits.

## Strict mode (default since v0.4.0)

Clud Bug runs in **strict mode by default** for new installs. The workflow check fails when Clud Bug flags a critical issue (bug, security, performance, missing test coverage) — green means clean, red means the bot found something to address. Add `clud-bug-review` to your branch protection's required status checks and merging is blocked until findings are addressed.

`clud-bug init` writes `{ "strictMode": true }` to `.claude/skills/.clud-bug.json`. To opt out into advisory mode (the bot still reviews; the check stays green regardless of findings), set `strictMode: false`:

```json
{ "strictMode": false, ... }
```

The toggle takes effect on PRs opened *after* the new value lands on the base branch (the gate reads the manifest from the base ref so PRs can't disable strict on themselves).

**Existing installs upgrading to v0.4.0:** the new default only fires on fresh installs (manifests that have never been touched by `init` or `update`). Existing repos — including v0.3.x advisory installs that never set `strictMode` — keep their prior behavior on re-init. To enable strict mode in an existing repo, add `"strictMode": true` to `.claude/skills/.clud-bug.json` manually.

## Bot-authored PRs (Dependabot, Renovate, fork PRs)

GitHub deliberately doesn't pass repository secrets to workflows triggered by bot-authored PRs (`dependabot[bot]`, `renovate[bot]`) or PRs from forks. The action can't authenticate against Anthropic, so Clud Bug can't review.

Rather than failing red (wrong signal), the workflow detects this case, posts a one-line advisory comment to the PR explaining the skip, and exits 0. The check stays green; the comment makes the skip visible. Reviews are your responsibility on those PRs.

To enable real reviews on Dependabot PRs, [add ANTHROPIC_API_KEY to Dependabot's secret scope](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/configuring-access-to-private-registries-for-dependabot).

## How skills shape reviews

Skills aren't background reading material for the bot — they're rules with authority. The workflow prompt now requires Clud Bug to:

1. **Cite the skill by name** when applying its guidance: e.g. `[evidence-based-review]: this claim isn't anchored to a line`.
2. **End every review with a footer** listing which skills shaped the findings: `Skills referenced: [critical-issues-only, next-best-practices, my-team-rules]`.

The footer is your audit trail. If a review's footer is `[none]`, either the bot found nothing relevant in your installed skills (and should explain why), or your skill set isn't covering the kinds of changes you actually ship — a signal to add or write new specimens.

`clud-bug init` warns when it would install only baseline specimens. Pair with at least one project-aware skill from skills.sh, or your own — that's where the wedge over stock Claude review comes from.

## Managing skills

After `init`, four commands let you evolve the skill set without re-running the whole setup:

```bash
clud-bug list                                       # show what's installed
clud-bug add vercel-labs/skills/next-best-practices # install one from skills.sh
clud-bug remove next-best-practices                 # uninstall (refuses custom skills)
clud-bug refresh                                    # re-query skills.sh, diff vs installed
```

Skills are tracked in `.claude/skills/.clud-bug.json` (a small manifest). Anything in `.claude/skills/` that *isn't* in the manifest is treated as your custom work and never modified by `clud-bug` commands.

## Adding your own skills

Drop any `.md` file into `.claude/skills/<your-skill>/SKILL.md` — Claude Code auto-discovers it on the next PR. Same format as skills from skills.sh:

```markdown
---
name: my-team-rules
description: One-line description of what this skill teaches the reviewer.
---

# My team rules

Rules go here. Be specific, cite examples, explain the why.
```

This is how you encode your team's PR-review discipline (e.g. "always check for SQL injection in `db/queries/`", "API responses must include error codes from `lib/errors.ts`").

## Why this works (and why the original `claude-code-action` install often doesn't)

`anthropics/claude-code-action@v1` is the underlying engine — clud-bug just configures it correctly. Two things people commonly miss when wiring it themselves:

- **`gh pr comment` is disabled by default.** Without `--allowedTools` whitelisting it, Claude runs, thinks, and exits silently. clud-bug's generated workflow includes the right allowlist.
- **Skills are not auto-loaded from anywhere.** If you don't ship `.claude/skills/*` in your repo, Claude reviews with zero project context. clud-bug installs a curated set so the review is actually project-aware.

## Fork PR caveat ⚠️

GitHub does **not** pass repo secrets (including `ANTHROPIC_API_KEY`) to workflows triggered by PRs from forks. By default, `pull_request` workflows on fork PRs will run with no API key and produce no comment.

If you want clud-bug to review fork PRs too, you have two options:

1. **Maintainer re-pushes the branch** to your repo as a non-fork branch, and the review runs.
2. **Switch the trigger to `pull_request_target`** (advanced) — this gives the workflow access to secrets but runs against the *base* ref, not the PR's code. To safely review the PR's actual code, follow [`anthropics/claude-code-action` security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md): check out the PR head into a **subdirectory** (not the workspace root) and pass it via `--add-dir`. Skipping this is a code-execution risk.

Concretely, the safe shape:

```yaml
on:
  pull_request_target:
    types: [opened, synchronize]

jobs:
  clud-bug-review:
    steps:
      - uses: actions/checkout@v6  # base ref — trusted
      - uses: actions/checkout@v6  # PR head — UNTRUSTED, into a subdir
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          path: pr-head
      - uses: anthropics/claude-code-action@v1
        with:
          claude_args: --add-dir pr-head
          # ... rest of args
```

The key invariant: the base checkout (with secrets in scope) lives at the workspace root; the PR head (untrusted user code) only ever lives in a subdirectory the action explicitly opts into via `--add-dir`. Any deviation — checking out the PR head at the root, running `npm install` from the subdir, etc. — re-opens the code-execution risk.

clud-bug's generated workflow uses `pull_request` (not `pull_request_target`) by default. If you understand the trade-offs and want to handle fork PRs, edit the trigger yourself using the shape above.

## When you edit the workflow

> **TL;DR:** if you see `App token exchange failed: Workflow validation failed (401)` on a PR that edits a clud-bug workflow file, that's **expected and protective** — not a bug in your PR. Read on.

clud-bug uses [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action), which **refuses to run when the PR being reviewed modifies the action's own workflow file**. That's a security guard: without it, a PR could neuter the reviewer or exfiltrate secrets via prompt injection in the workflow file itself.

### What you'll see

When you push a PR that touches `.github/workflows/clud-bug-review.yml` (or any other clud-bug workflow):

- The `clud-bug-review` check fails with `App token exchange failed: 401 Unauthorized — Workflow validation failed. The workflow file must exist and have identical content to the version on the repository's default branch.`
- You'll get a GitHub email titled something like **"[thrillmade/your-repo] Run failed: Clud Bug 🐛 Crawls Your Code — `<branch-name>`"** — same wording for every workflow failure, so it doesn't visually distinguish "this is the expected self-mod guard" from "real failure."

### How to merge

If the PR contains **only** workflow edits, this is the expected path:

1. A maintainer reviews the diff directly (the bot can't).
2. Merge via admin override (`gh pr merge --admin` or the "Merge without waiting for requirements" button) — the failing `clud-bug-review` check is the bot refusing to review *itself*, not a real defect.
3. Subsequent PRs on the new workflow work normally — the validation gate compares against `main`, so once your edit is on `main`, the gate passes.

If the PR contains workflow edits **mixed with other code changes**, split them. The bot can't review either half while the workflow edit is in the diff, so any real findings get masked.

### The helper command

`clud-bug edit-workflow` packages the workflow change into a clean PR for you, refusing to run if your working tree has any non-workflow changes:

```bash
# Edit .github/workflows/clud-bug-*.yml as you like, then:
clud-bug edit-workflow
```

This keeps the merge ceremony scoped to just the workflow edit.

## Verifying it works

After install:

1. Confirm `ANTHROPIC_API_KEY` secret is set on the repo.
2. Open a throwaway PR with an obvious bug (e.g. `const x = null; x.foo()`).
3. Within ~2 min, Clud Bug should post a comment flagging it.
4. If no comment: check the **Actions** tab logs. Look for `gh pr comment` invocations and any "Resource not accessible by integration" errors (usually a permissions issue or a fork PR).

### Reading a review

Every Clud Bug review opens with a status line that tells you exactly what changed since the previous pass — particularly useful on re-review after you push a fix:

```
## 🐛 Clud Bug review

**This round:** 0 critical · 1 minor · 3 resolved from prior · 0 still open

### Findings
…
```

- **critical** — new critical findings in this review (these are what strict mode gates on)
- **minor** — non-critical findings (suggestions / nits)
- **resolved from prior** — prior unresolved threads the bot just cleared because it verified your fix in the diff
- **still open** — prior threads whose issue is still standing

Same format every time; zero values are always present so the line is easy to scan and parse.

## Manual install (advanced)

If you don't want to use the CLI, you can install a generic workflow by hand:

```bash
mkdir -p .github/workflows
curl -o .github/workflows/clud-bug-review.yml \
  https://raw.githubusercontent.com/thrillmade/clud-bug/main/templates/workflow.yml.tmpl
# Edit {{PROJECT_DESCRIPTION}} and {{LANGUAGE_HINTS}} placeholders by hand.
```

The CLI does this for you, plus skill curation.

## Contributing

Pull requests welcome. If you're adding a new detector for a language ecosystem, put it in `lib/detect.js` and add a fixture-based test in `test/detect.test.js`.

```bash
npm test          # node:test, no runtime deps
```

## License

MIT.

---

## Part of the thrillmade SkDD toolchain

[Skills-Driven Development](https://zakelfassi.com/skdd-skills-driven-development) (Zak Elfassi's methodology) gives you the loop; the thrillmade toolchain ships the parts:

- **[logmind](https://github.com/thrillmade/logmind)** — the *why* behind every change (decision logging as commit primitive); skill-creation + testing + auditing
- **[clud-bug](https://github.com/thrillmade/clud-bug)** — skill-driven PR review at gate time; every finding cites the skill that motivated it
- **[agent-skills](https://github.com/thrillmade/agent-skills)** — public catalog of reusable skills
- **[skills.sh](https://skills.sh)** — skill discovery + install

End-to-end agentic auto dev: write skills first → log the *why* → run them against PRs → iterate based on usage. The tools work independently; better together.
