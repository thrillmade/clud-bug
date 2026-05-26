# AGENTS.md

This is the canonical instruction file for AI coding agents working in this
repository. Tools that understand `AGENTS.md` (Cursor, Codex, Windsurf,
Claude Code, Cline, Continue, Aider, ...) read this file directly. Per-tool
files like `CLAUDE.md` or `.cursorrules` are stubs that point here so the
guidance lives in one place.

<!-- logmind-start -->
<!-- logmind-block-version: v3-slim -->
## Decision logging — see the `logmind` skill

This project uses [logmind](https://logmind.dev). The full procedure
(when to log, how to log, what counts as a decision, branch routing) lives
in the **`logmind` agent skill** which your runtime should auto-load.

If the skill isn't loaded for some reason, install it once:

```bash
npx skills add https://github.com/thrillmot/agent-skills --skill logmind
```

### Project-specific paths

- **[docs/timeline.md](docs/timeline.md)** — auto-generated chronological overview across all branches; start here.
- Recent decisions on the default branch: **[docs/decisions.md](docs/decisions.md)**
- Per-branch decisions (in-flight feature work): **docs/decisions-branches/**
- Archived decisions: **[docs/decisions-archive.md](docs/decisions-archive.md)**
- Project tree (regenerated on main-branch logs + post-PR-merge): **[docs/file-structure.md](docs/file-structure.md)**

### Quick reference

```bash
logmind log "decision summary" -r "why" -a "alternative" -i "implication"
logmind show               # recent decisions on the current branch
logmind search "keyword"   # full-text across recent + archive
```

**Use `logmind log` for the commit, not `git add` + `git commit`.** The
`log` command writes the decision file, stages the decision log + its
companion files, and creates the commit in one step. Use
`--stage all` to also stage the rest of the working tree.

**Read `docs/decisions.md` and the matching `docs/decisions-branches/<branch>.md` (if any) before starting any non-trivial task.** The team has likely already decided things you'd otherwise re-litigate.
<!-- logmind-end -->

## Project Overview

<!-- Replace with a short description of what this project does. -->

## Development Commands

<!-- Common commands a contributor needs (build, test, lint, run). -->

<!-- clud-bug-start -->
<!-- clud-bug-block-version: v1 -->
## clud-bug — Claude PR review

This repository uses [clud-bug](https://cludbug.dev) to review pull requests
automatically. Three things matter when other agents (or future-you) work
in this repo:

### When you push fixes addressing prior Clud Bug review threads

The bot resolves its own prior review threads on the next pass when it can
verify the fix in the diff. You don't need to manually resolve threads it
opened — push the fix, wait ~2 minutes, and check the PR. If a thread it
left isn't auto-resolved after a fix, the bot judged the issue still open;
read its latest review comment for what it's still flagging.

### Strict mode

Strict mode is **on** in this repo (workflow check fails on critical findings). Toggle by editing `.claude/skills/.clud-bug.json`:

```json
{ "strictMode": true | false, ... }
```

The setting is read from the **base ref** of any open PR, so PRs cannot
disable strict mode on themselves. Changes take effect on PRs opened after
they merge to the base branch.

### Where the skills live

Project-aware review rules live in `.claude/skills/<name>/SKILL.md`. A
small baseline kit ships with every install — see
`.claude/skills/.clud-bug.json` for the current set. Add more via
`clud-bug add <source/name>` (from skills.sh) or by dropping your own
`.md` files there. They auto-load into the reviewer.

### Editing the workflow

Anthropic's `claude-code-action` refuses to run on PRs that modify its own
workflow file. Use `clud-bug edit-workflow` to bundle workflow tweaks into
their own isolated PR — see [README](https://github.com/thrillmot/clud-bug#when-you-edit-the-workflow).

_Installed at clud-bug v0.5.15._
<!-- clud-bug-end -->
