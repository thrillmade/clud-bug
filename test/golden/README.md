# Golden set — review-prompt regression gate

> 0.0.E (v0.6.17). Gates 0.0.P (prompt trim) and 0.0.O (JSON schema
> output). Cheap, deterministic, runs in CI on every PR.

## What it tests

Three categories of regression that no individual test would catch:

1. **`must-contain.json`** — instruction phrases the review prompt
   MUST include. If 0.0.P over-aggressively trims and drops one of
   these, CI fails. Each entry has a `pattern` (regex), a `why`
   (rationale for keeping), and a `category` (rough grouping).

2. **`must-not-contain.json`** — anti-pattern phrases (filler from
   the LLM token optimization guide § 6) that should NEVER be
   re-added. Catches accidental regression where polite-but-bloated
   prose creeps back into the prompt.

3. **`byte-budget.json`** — size caps. The whole prompt + per-section
   targets. Catches the case where 0.0.P "trims" but actually adds
   bytes elsewhere.

## Running

```bash
# From the clud-bug repo root (also runs in CI via `npm test`):
node --test test/prompts.eval.test.js

# Via the subcommand — same runner, works from anywhere inside the
# clud-bug repo:
node bin/clud-bug.js eval
```

`clud-bug eval` is a **dev-only** command. It runs the gate against
the review prompt bundled in this repo. `test/` is not in the npm
`files` array, so an end-user invoking `clud-bug eval` from a globally
installed copy would hit `ENOENT` — intentional. If you maintain your
own prompts and want similar regression protection, fork this fixture
structure into your own repo.

## When to update the golden set

- **Adding a must-contain** when you ship a new prompt instruction
  that's load-bearing (e.g., when 0.0.O lands and the prompt needs a
  new schema-output instruction).
- **Adding a must-not-contain** when you find a filler pattern that
  bloated the prompt before — locks in the cleanup.
- **Updating byte-budget** when a major prompt structural change ships
  (with a CHANGELOG note explaining the change).

## What this gate does NOT test

- It does NOT run the LLM. That's too expensive for every-PR CI.
  Quality testing against real model outputs lives in a separate
  layer (manual `clud-bug eval --live` invocation, future).
- It does NOT test the renderer/post-processor. That ships with
  0.0.O and gets its own tests.
- It does NOT replace clud-bug-review itself. The gate is a
  structural check; clud-bug-review is the behavioral check on
  each PR.

## Fixture format

See `must-contain.json`, `must-not-contain.json`, `byte-budget.json`
for the JSON schema in use.
