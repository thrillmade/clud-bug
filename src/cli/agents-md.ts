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
//
// AGENTS.md is the cross-tool canonical (logmind made it canonical too) and is
// the ONLY file that receives the clud-bug block. SPEC 2.0 §1.1:
//
//   "`AGENTS.md` is the single source of agent instructions. A tool MUST NOT
//    copy its content into any other file."
//
// CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules etc. are per-tool files.
// SPEC 2.0 §1.2:
//
//   "A per-tool file MUST NOT carry a copy of the instructions. A markdown one
//    is a redirect and nothing else"
//
// So these get a redirect stub, never the block — and any block a pre-#265
// clud-bug already copied in gets stripped on the next init/update (migration).
// We still never CREATE them; logmind (via `agents.<name>`, §1.2/§1.6) and the
// user own that decision.
const ALWAYS_TOUCH = ['AGENTS.md'];                         // create if missing
const REDIRECT_IF_PRESENT = [
  'CLAUDE.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.continuerules',
];

export interface RenderBlockOptions {
  version?: string | undefined;
  strictMode?: boolean | undefined;
  skillRelPath?: string | undefined;
}

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
//
// v0.6.25 (gotcha #2 fix): when the consuming repo IS the publisher of
// the clud-bug-collaboration skill (skill source lives at
// `skills/clud-bug-collaboration/SKILL.md` instead of the consumer-install
// path `.claude/skills/...`), render the LOCAL repo path. Otherwise the
// link is dead in the publisher repo (this used to require a manual fix
// every v0.6.* propagation cycle on agent-skills).
export function renderBlock({ version, strictMode, skillRelPath }: RenderBlockOptions = {}): string {
  const versionLine = version ? `_Installed at clud-bug v${version}._` : '';
  const strictNote = strictMode === true
    ? '**on** in this repo (workflow check fails on critical findings)'
    : '**off** in this repo (advisory only)';
  const skillPath = skillRelPath || '.claude/skills/clud-bug-collaboration/SKILL.md';
  return `${START_MARKER}
<!-- clud-bug-block-version: ${BLOCK_VERSION} -->
## clud-bug — Claude PR review

This repo uses [clud-bug](https://cludbug.dev) for automatic PR reviews.
Full collaboration rules — fix-push flow, skill structure, comment format,
strict-mode mechanics, workflow-edit constraint — live in the bundled
[\`clud-bug-collaboration\` skill](${skillPath}).
Read that skill before pushing fixes addressing prior review threads.

Strict mode is ${strictNote}. Toggle via \`.claude/skills/.clud-bug.json\`
(read from PR **base ref**, so PRs can't disable strict-mode on themselves).

For agent invocations of the \`clud-bug\` CLI, prefer \`CLUD_BUG_QUIET=1\`
(or pass \`--quiet\`) — suppresses progress chatter and emits a single
\`ok <key-value>\` summary line per command.

${versionLine}
${END_MARKER}`;
}

// --- #265: per-tool redirect stubs (SPEC 2.0 §1.2) ---------------------------

// Our stub's identity line. Deliberately in clud-bug's OWN marker namespace
// rather than logmind's `<!-- logmind-stub: ... -->`.
//
// §1.2's worked example shows logmind's stub, and #265 quotes it as "the
// required form, byte for byte". We do NOT write those bytes, for two reasons:
//
//   1. §1.1 — "Each installed tool owns one marked region ... A tool MUST
//      leave every other region byte-identical." Writing `logmind-stub` would
//      put clud-bug inside logmind's region, and two tools racing on one
//      marker is exactly the clobbering §1.1 forbids.
//   2. The example's second line promises "the decision-logging requirement
//      (logmind)". clud-bug installs standalone, so in a logmind-less repo
//      that sentence would be false.
//
// We match the FORM (one comment marker + a two-line pointer, nothing else)
// and recognise logmind's stub as already satisfying the redirect, so a repo
// with both tools gets one stub rather than two. See the report on #265.
const STUB_MARKER = '<!-- clud-bug-stub: AI agent instructions for this project live in AGENTS.md -->';

// Render the redirect stub for a file `depth` directories below the repo root.
// `.github/copilot-instructions.md` needs `../AGENTS.md`, `.cursor/rules/x.md`
// needs `../../AGENTS.md` — a bare `AGENTS.md` link from those paths is dead,
// which is the same class of defect as the v0.6.25 gotcha #2 skill-path bug.
export function renderStub(depth = 0): string {
  const rel = `${'../'.repeat(Math.max(0, depth))}AGENTS.md`;
  return `${STUB_MARKER}
See [AGENTS.md](${rel}) for project-specific AI agent instructions, including
the PR-review rules (clud-bug) and required reading.`;
}

// True if `content` already sends the reader back to AGENTS.md, by any of the
// forms in the wild:
//   - Claude Code's `@AGENTS.md` eager import
//   - logmind's `<!-- logmind-stub: ... -->` (SPEC §1.2's worked example)
//   - our own `<!-- clud-bug-stub: ... -->`
//   - a plain markdown link to AGENTS.md, at any relative depth
// When one is present we add nothing — a per-tool file needs one redirect,
// not one per installed tool.
export function hasAgentsMdRedirect(content: unknown): boolean {
  if (typeof content !== 'string') return false;
  if (hasAgentsMdImport(content)) return true;
  if (content.includes('<!-- logmind-stub:')) return true;
  if (content.includes('<!-- clud-bug-stub:')) return true;
  return /\]\((?:\.{1,2}\/)*AGENTS\.md\)/.test(content);
}

// Insert `stub` at the top of `content`, after YAML frontmatter if the file
// opens with it. Cursor's newer `.cursor/rules/*.md` format carries a
// frontmatter header (`---\ndescription: ...\n---`) that stops being
// frontmatter the moment anything is prepended above it — so we step over it.
// Everything already in the file survives; we only add.
export function insertStub(content: string, stub: string): string {
  // Match the file's own line ending, so adding three lines to a CRLF file
  // doesn't render as a whole-file diff on a Windows checkout.
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const body = nl === '\r\n' ? stub.replace(/\n/g, '\r\n') : stub;
  if (content.trim() === '') return `${body}${nl}`;
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (fm) {
    const head = content.slice(0, fm[0].length);
    const rest = content.slice(fm[0].length);
    return `${head}${nl}${body}${nl}${rest.startsWith(nl) ? rest : `${nl}${rest}`}`;
  }
  return `${body}${nl}${nl}${content}`;
}

// v0.6.25 (gotcha #2): detect repos that PUBLISH the
// clud-bug-collaboration skill (agent-skills is the canonical case).
// When the skill source exists at `skills/clud-bug-collaboration/SKILL.md`
// in the working tree, the AGENTS.md link should point there, not at the
// consumer-install `.claude/skills/...` path that doesn't exist in the
// publisher repo.
export async function detectSkillRelPath(cwd: string): Promise<string> {
  const publisherPath = 'skills/clud-bug-collaboration/SKILL.md';
  const consumerPath = '.claude/skills/clud-bug-collaboration/SKILL.md';
  if (await fileExists(join(cwd, publisherPath))) return publisherPath;
  return consumerPath;
}

// Replace an existing clud-bug block in `content`, OR append if absent.
// Idempotent: running multiple times leaves a single block.
//
// Used for AGENTS.md ONLY. Per-tool files go through redirectContentFor()
// instead — see §1.1/§1.2 above.
export function upsertBlock(content: string, block: string): string {
  const startRe = new RegExp(escapeRe(START_MARKER));
  const endRe   = new RegExp(escapeRe(END_MARKER));
  if (startRe.test(content) && endRe.test(content)) {
    // Replace from START_MARKER through the FIRST END_MARKER after it. The
    // `*?` is NON-greedy on purpose: content following the end marker (a
    // second block, a hand-written footer) must survive untouched. The
    // comment here used to say "greedy", which was wrong about its own
    // regex — test 'preserves content after the end marker' pins the truth.
    const re = new RegExp(`${escapeRe(START_MARKER)}[\\s\\S]*?${escapeRe(END_MARKER)}`);
    return content.replace(re, block);
  }
  // Append with a separating blank line, no trailing newline duplication.
  const sep = content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${sep}${block}\n`;
}

// 0.0.I.1 (v0.6.X): true if `content` has Claude Code's `@AGENTS.md`
// @-import — the canonical AGENTS.md content gets eager-loaded.
//
// Matches at start-of-line (a literal `@AGENTS.md` mentioned in prose
// won't fire; only the import directive does). Allows trailing space
// (some editors trim it; some don't) and optional newline terminator.
export function hasAgentsMdImport(content: unknown): boolean {
  if (typeof content !== 'string') return false;
  return /^@AGENTS\.md\s*$/m.test(content);
}

// 0.0.I.1: strip a clud-bug block (markers + body) AND the blank line
// that precedes it, if any. Originally used only when an @AGENTS.md import
// was detected; #265 makes it unconditional for every per-tool file, because
// §1.2 forbids the copy regardless of whether the file also @-imports.
//
// Returns the cleaned content. If no block exists, returns content
// unchanged. Idempotent.
//
// #265: the regex is now GLOBAL. Non-greedy still bounds each match to its
// own end marker (so text between two blocks survives), but a file that
// somehow accrued two copies — a bad merge of two branches that each ran
// init — must end up with zero, not one. "MUST NOT carry a copy" is not
// satisfied by removing only the first.
export function removeBlock(content: string): string {
  if (typeof content !== 'string') return content;
  // Consume the line breaks on BOTH sides of the block along with it, so no
  // dent is left where it sat. Both runs are greedy AND CRLF-aware, so the
  // match owns ALL the line
  // breaks around the block and the replacement below decides the separator
  // outright. Two bugs this closes:
  //   - the old trailing `\n?` consumed one newline, so a block with a blank
  //     line on each side left a doubled blank line behind;
  //   - `\n*` on a CRLF file matched the `\n` halves only, stranding the
  //     `\r`s as extra blank lines: a Windows .cursorrules came back as
  //     '# my rules\r\n\r\n\n\r\n\r\ntrailing' — three blank lines of dent.
  const re = new RegExp(
    `(?:\\r?\\n)*${escapeRe(START_MARKER)}[\\s\\S]*?${escapeRe(END_MARKER)}(?:\\r?\\n)*`,
    'g',
  );
  // Emit the line ending the file already uses, rather than forcing LF into
  // a CRLF file (which shows up as a whole-file diff in a Windows checkout).
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  // #265: what replaces the match depends on where the block sat.
  //
  // Replacing with '' unconditionally — what this did before — was safe only
  // while the block was guaranteed to be the LAST thing in the file, which it
  // was: the old code always appended it. Now that we strip blocks out of
  // hand-edited per-tool files, a block can have user content on both sides,
  // and '' welds those two lines together: 'HEAD\n\n<block>\nMIDDLE' became
  // the single line 'HEADMIDDLE'. That is user content damage, silent and
  // unrecoverable. Restore the separation instead.
  return content.replace(re, (match: string, offset: number) => {
    if (offset === 0) return '';                                // nothing above to separate from
    if (offset + match.length >= content.length) return nl;     // last thing in the file: keep it newline-terminated
    return nl + nl;                                             // keep the lines that surrounded it apart
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ApplyToRepoResult {
  touched: string[];
  created: string[];
}

// Touches all relevant agent-instruction files in `cwd`.
// Creates AGENTS.md if it doesn't exist (it's the canonical home).
// Updates other files only if they already exist (don't proliferate stubs;
// logmind or the user owns those creation decisions).
//
// Returns { touched: string[], created: string[] } for the caller to log.
export async function applyToRepo(cwd: string, blockOpts: RenderBlockOptions = {}): Promise<ApplyToRepoResult> {
  // v0.6.25 / gotcha #2: detect publisher repo + render local skill path.
  // Pre-v0.6.25 always rendered the consumer install path → broke
  // agent-skills' check-links every propagation cycle. Detection runs
  // before block render so the path is correct from the first write.
  const skillRelPath = blockOpts.skillRelPath ?? await detectSkillRelPath(cwd);
  const block = renderBlock({ ...blockOpts, skillRelPath });
  const touched: string[] = [];
  const created: string[] = [];

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

  // #265: per-tool files get a REDIRECT, never the block.
  for (const path of REDIRECT_IF_PRESENT) {
    const full = join(cwd, path);
    if (!(await fileExists(full))) continue;
    const prior = await readFile(full, 'utf8');
    const next = redirectContentFor(prior, path);
    if (next !== prior) {
      await writeFile(full, next);
      touched.push(path);
    }
  }

  // .cursor/rules/*.md — same redirect rule for every file that exists.
  const cursorRulesDir = join(cwd, '.cursor', 'rules');
  if (await fileExists(cursorRulesDir)) {
    let entries: string[] = [];
    try { entries = await readdir(cursorRulesDir); } catch { /* dir missing or unreadable */ }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const relPath = `.cursor/rules/${name}`;
      const full = join(cursorRulesDir, name);
      const prior = await readFile(full, 'utf8');
      const next = redirectContentFor(prior, relPath);
      if (next !== prior) {
        await writeFile(full, next);
        touched.push(relPath);
      }
    }
  }

  return { touched, created };
}

// #265 / SPEC 2.0 §1.2: decide what content a per-tool file should have.
//
// Two steps, in order:
//   1. Strip any clud-bug block. Pre-#265 clud-bug copied the whole block
//      into these files; §1.1 forbids the copy, so an existing one is a
//      migration to clean up. 0.0.I.1 already did this for files carrying
//      an `@AGENTS.md` import — that escape hatch is Claude-Code-only, so
//      .cursorrules / .windsurfrules / .clinerules / .continuerules /
//      GEMINI.md / copilot-instructions.md never qualified and always kept
//      the copy. Now every per-tool file is stripped.
//   2. Ensure a redirect exists. If the file already points at AGENTS.md by
//      any recognised form (@-import, logmind's stub, ours, a plain link),
//      leave it alone. Otherwise insert our stub.
//
// What this deliberately does NOT do is make the file "a redirect and
// nothing else" by truncation. §1.2 describes the file's ideal end state,
// but §1.1's rule for the tool is that it "MUST leave every byte outside
// [its own region] untouched" — and a hand-written .cursorrules is exactly
// such bytes. clud-bug removes what clud-bug wrote and adds a pointer; it
// does not delete content it never authored. Whether the rest of the file
// should go is the user's call (or logmind's, which owns per-tool file
// creation via `agents.<name>`).
//
// AGENTS.md itself is NOT routed through here — it always gets the
// block (it's the canonical source).
function redirectContentFor(prior: string, relPath: string): string {
  const stripped = removeBlock(prior);
  if (hasAgentsMdRedirect(stripped)) return stripped;
  const depth = relPath.split('/').length - 1;
  return insertStub(stripped, renderStub(depth));
}

function seedFile(name: string): string {
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

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
