import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Manages a clud-bug-owned section inside AGENTS.md / CLAUDE.md and adjacent
// agent-instruction files. Mirrors the well-established `<!-- logmind-start -->`
// pattern: a marked block that other agents can read for collaboration rules,
// idempotently rewritten on each `clud-bug init` so the content stays current.

const START_MARKER = '<!-- clud-bug-start -->';
const END_MARKER   = '<!-- clud-bug-end -->';
// v2 (clud-bug v0.6.6+): trimmed from ~44 lines to ~10. Full collaboration
// rules moved to the bundled `clud-bug-collaboration` skill (always installed
// alongside clud-bug), which clud-bug-review loads at review time. AGENTS.md
// becomes a pointer + the strict-mode toggle (repo-specific, varies per
// consumer). Compounds across every agent session in every consuming repo.
const BLOCK_VERSION = 'v2';

// Files we'll touch when present, plus files we'll create if missing.
// AGENTS.md is the cross-tool canonical (logmind made it canonical too).
// CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules etc. are tool-specific
// stubs/instructions; we append the same block where they exist but don't
// create them (logmind already creates the ones it knows about).
const ALWAYS_TOUCH = ['AGENTS.md'];                         // create if missing
const TOUCH_IF_PRESENT = [
  'CLAUDE.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.continuerules',
];

// Render the clud-bug block. Bundled here rather than in a template file so
// updates ship with the CLI itself.
//
// `strictMode` MUST match the workflow's gate predicate exactly so the block
// can't lie about repo state. The workflow at `templates/workflow*.yml.tmpl`
// reads the manifest with `JSON.parse(s).strictMode === true` — meaning the
// gate fires ONLY on an explicit `true`, and anything else (missing field,
// `false`, `null`) is advisory. Mirror that here: render "on" only when the
// caller explicitly passes `true`. Anything else is "off".
//
// Why this matters: a v0.3-era install (no `strictMode` field, `lastUpdate`
// set) is a documented advisory upgrade path — `clud-bug init` deliberately
// preserves that state. If the block rendered "on" for that case, other
// agents reading AGENTS.md would get a wrong model of the gate.
export function renderBlock({ version, strictMode } = {}) {
  const versionLine = version ? `_Installed at clud-bug v${version}._` : '';
  const strictNote = strictMode === true
    ? '**on** in this repo (workflow check fails on critical findings)'
    : '**off** in this repo (advisory only)';
  return `${START_MARKER}
<!-- clud-bug-block-version: ${BLOCK_VERSION} -->
## clud-bug — Claude PR review

This repo uses [clud-bug](https://cludbug.dev) for automatic PR reviews.
Full collaboration rules — fix-push flow, skill structure, comment format,
strict-mode mechanics, workflow-edit constraint — live in the bundled
[\`clud-bug-collaboration\` skill](.claude/skills/clud-bug-collaboration/SKILL.md).
Read that skill before pushing fixes addressing prior review threads.

Strict mode is ${strictNote}. Toggle via \`.claude/skills/.clud-bug.json\`
(read from PR **base ref**, so PRs can't disable strict-mode on themselves).

For agent invocations of the \`clud-bug\` CLI, prefer \`CLUD_BUG_QUIET=1\`
(or pass \`--quiet\`) — suppresses progress chatter and emits a single
\`ok <key-value>\` summary line per command.

${versionLine}
${END_MARKER}`;
}

// Replace an existing clud-bug block in `content`, OR append if absent.
// Idempotent: running multiple times leaves a single block.
export function upsertBlock(content, block) {
  const startRe = new RegExp(escapeRe(START_MARKER));
  const endRe   = new RegExp(escapeRe(END_MARKER));
  if (startRe.test(content) && endRe.test(content)) {
    // Replace from START_MARKER through END_MARKER (greedy multi-line).
    const re = new RegExp(`${escapeRe(START_MARKER)}[\\s\\S]*?${escapeRe(END_MARKER)}`);
    return content.replace(re, block);
  }
  // Append with a separating blank line, no trailing newline duplication.
  const sep = content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${sep}${block}\n`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Touches all relevant agent-instruction files in `cwd`.
// Creates AGENTS.md if it doesn't exist (it's the canonical home).
// Updates other files only if they already exist (don't proliferate stubs;
// logmind or the user owns those creation decisions).
//
// Returns { touched: string[], created: string[] } for the caller to log.
export async function applyToRepo(cwd, blockOpts = {}) {
  const block = renderBlock(blockOpts);
  const touched = [];
  const created = [];

  for (const path of ALWAYS_TOUCH) {
    const full = join(cwd, path);
    const existed = await fileExists(full);
    const prior = existed ? await readFile(full, 'utf8') : seedFile(path);
    const next = upsertBlock(prior, block);
    if (next !== prior) {
      await writeFile(full, next);
      (existed ? touched : created).push(path);
    }
  }

  for (const path of TOUCH_IF_PRESENT) {
    const full = join(cwd, path);
    if (!(await fileExists(full))) continue;
    const prior = await readFile(full, 'utf8');
    const next = upsertBlock(prior, block);
    if (next !== prior) {
      await writeFile(full, next);
      touched.push(path);
    }
  }

  // .cursor/rules/*.md — append to every file that exists.
  const cursorRulesDir = join(cwd, '.cursor', 'rules');
  if (await fileExists(cursorRulesDir)) {
    let entries = [];
    try { entries = await readdir(cursorRulesDir); } catch {}
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const full = join(cursorRulesDir, name);
      const prior = await readFile(full, 'utf8');
      const next = upsertBlock(prior, block);
      if (next !== prior) {
        await writeFile(full, next);
        touched.push(`.cursor/rules/${name}`);
      }
    }
  }

  return { touched, created };
}

function seedFile(name) {
  // When AGENTS.md doesn't exist (no logmind, no prior tooling), seed with a
  // minimal canonical header so the clud-bug block has context.
  if (name === 'AGENTS.md') {
    return `# AGENTS.md

This file is the canonical instruction file for AI coding agents working in
this repository. Tools that understand AGENTS.md (Cursor, Codex, Windsurf,
Claude Code, Cline, Continue, Aider, ...) read it directly.

`;
  }
  return '';
}

async function fileExists(path) {
  try { await stat(path); return true; } catch { return false; }
}
