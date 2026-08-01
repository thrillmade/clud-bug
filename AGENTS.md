# AGENTS.md

This is the canonical instruction file for AI coding agents working in this
repository. Tools that understand `AGENTS.md` (Cursor, Codex, Windsurf,
Claude Code, Cline, Continue, Aider, ...) read this file directly. Per-tool
files like `CLAUDE.md` or `.cursorrules` are stubs that point here so the
guidance lives in one place.

<!-- logmind-start -->
<!-- logmind-block-version: v7-pointer -->
## Decision logging — `logmind log` is the commit primitive

**`logmind log` replaces `git add` + `git commit` + `git push` for any change that carries a decision** — do not run those git commands directly.

```bash
logmind log "summary" -r "why" -a "alternative" -i "implication"
```

This project uses [logmind](https://logmind.dev). What counts as a decision, branch routing, `--stage scoped` for unrelated WIP, `logmind doctor`, and the required-reading list ([`docs/timeline.md`](docs/timeline.md), [`docs/decisions.md`](docs/decisions.md), [`docs/file-structure.md`](docs/file-structure.md), `docs/decisions-branches/<branch>.md`) all live in the **`logmind` agent skill** at https://github.com/thrillmade/agent-skills/tree/main/skills/logmind.
<!-- logmind-end -->

## Project Overview

<!-- Replace with a short description of what this project does. -->

## Development Commands

<!-- Common commands a contributor needs (build, test, lint, run). -->

<!-- clud-bug-start -->
<!-- clud-bug-block-version: v2 -->
## clud-bug — Claude PR review

This repo uses [clud-bug](https://cludbug.dev) for automatic PR reviews.
Full collaboration rules — fix-push flow, skill structure, comment format,
strict-mode mechanics, workflow-edit constraint — live in the bundled
[`clud-bug-collaboration` skill](.claude/skills/clud-bug-collaboration/SKILL.md).
Read that skill before pushing fixes addressing prior review threads.

Strict mode is **on** in this repo (workflow check fails on critical findings). Toggle via `.claude/skills/.clud-bug.json`
(read from PR **base ref**, so PRs can't disable strict-mode on themselves).

Local max mode (this session, on a PR trigger) certifies its review via the
hosted notary at `https://app.cludbug.dev` **by default** — it submits an
attestation bundle with `clud-bug post-check-run --sha ... --bundle bundle.json`
rather than self-attesting. Toggle via `"notary": false` in
`.claude/skills/.clud-bug.json` (falls back to the labeled self-attested
check); override the origin with `CLUD_BUG_NOTARY_URL`.

For agent invocations of the `clud-bug` CLI, prefer `CLUD_BUG_QUIET=1`
(or pass `--quiet`) — suppresses progress chatter and emits a single
`ok <key-value>` summary line per command.

_Installed at clud-bug v0.7.0-rc.20._
<!-- clud-bug-end -->

## Read the thread, not the issue body

In several open issues the body describes a design that was superseded in
that issue's own comments. Building from the body ships the wrong thing —
always read the full comment thread before implementing.

The live answer is the latest **maintainer ruling dated on or after the
2026-08-01 SPEC 2.0 merge**. Recency alone is not the test: a comment can be
the newest one on an issue and still predate the merge that invalidated it
(#256 below is exactly this), and not every comment is a ruling.

Confirmed cases:

- **#260** — body asks to add a trust parameter to the probe surface; its
  comment says delete the probe surface entirely (the body's version is
  behaviour SPEC 2.0 §4.7 now bans).
- **#256** — has exactly one comment, dated 2026-07-31, so it is both the
  newest and pre-merge. It cites an intermediate ruling that never shipped,
  so the fix text it recommends is wrong. Neither the body nor the comment
  is live: **ask before implementing this one.**
- **#246** — body, first comment, and last comment each disagree with the
  one before it; only the 2026-08-01 comment is live.
- **#262 item 7** — duplicates #267.
