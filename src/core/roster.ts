// The agent roster reader — SPEC §2.4, distributed via agent-skills#180,
// wired into review composition by clud-bug#268.
//
// A role is one file at `.claude/agents/<name>.md`: YAML frontmatter plus a
// body the DISPATCHED agent reads as its own instructions. This module reads
// the frontmatter only. It never reads the body past the closing `---`, never
// executes anything, and never sends a body anywhere — the body is prose
// written for a harness to hand to an agent, not data for us to act on.
//
// #180's ruling (corrected 2026-07-31, confirmed 2026-08-14): only `name` and
// `description` are REQUIRED; `tools` / `model` / `color` / `trigger` are
// optional; there is NO `tier` field — "a role names a model directly."
// A frontmatter that carries `tier` predates that ruling (or copies the
// rejected beetle/wasp/mantis shape) and is reported as a problem, not
// silently accepted with the field dropped.
//
// A malformed entry is never silently dropped — it lands in `problems`,
// naming the file and the reason, because a role that disappeared without a
// trace is worse for a dispatcher than one that loudly failed to load.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const AGENTS_DIR_SEGMENTS = ['.claude', 'agents'] as const;

/** One parsed `.claude/agents/<name>.md` entry (agent-skills#180's shape;
 * SPEC §2.4). Deliberately has no `tier` — see the module doc. */
export interface RosterEntry {
  name: string;
  description: string;
  model?: string;
  tools?: string;
  color?: string;
  trigger?: string;
  /** Repo-relative path, e.g. `.claude/agents/beetle.md`. */
  file: string;
}

/** A `.claude/agents/*.md` file that did not parse into a `RosterEntry`,
 * naming the file and why — never a silent drop. */
export interface RosterProblem {
  file: string;
  reason: string;
}

export interface RosterReadResult {
  entries: RosterEntry[];
  problems: RosterProblem[];
}

/**
 * Reads every `.claude/agents/*.md` under `repoRoot`'s frontmatter into a
 * `RosterEntry`. Never throws: an absent (or unreadable) `.claude/agents`
 * directory is an EMPTY roster — SPEC §2.4: "A repository with no roster ...
 * MUST NOT be treated as an error" — and a malformed file is reported in
 * `problems` rather than skipped in silence or thrown as a fatal error.
 */
export async function readRoster(repoRoot: string): Promise<RosterReadResult> {
  const dir = join(repoRoot, ...AGENTS_DIR_SEGMENTS);
  let names: string[];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    names = dirents
      .filter((d) => d.isFile() && d.name.endsWith('.md'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    // No roster directory at all (or unreadable) — an empty roster.
    return { entries: [], problems: [] };
  }

  const entries: RosterEntry[] = [];
  const problems: RosterProblem[] = [];
  for (const name of names) {
    const file = [...AGENTS_DIR_SEGMENTS, name].join('/');
    const slug = name.slice(0, -'.md'.length);
    let raw: string;
    try {
      raw = await readFile(join(dir, name), 'utf8');
    } catch (e) {
      problems.push({ file, reason: `unreadable: ${(e as Error).message}` });
      continue;
    }
    const result = parseRosterEntry(raw, slug, file);
    if ('problem' in result) {
      problems.push(result.problem);
    } else {
      entries.push(result.entry);
    }
  }
  return { entries, problems };
}

/**
 * Parses one `.claude/agents/<slug>.md` file's raw text into a `RosterEntry`,
 * or a `RosterProblem` naming why it didn't parse. Pure — split out from the
 * directory walk so each fixture case is testable without a filesystem
 * round-trip.
 *
 * Hand-rolled and scoped to the exact §2.4 shape (flat scalars only), the
 * same tradeoff `skills.ts`'s `parseFrontmatter` makes rather than pulling in
 * a general YAML dependency for a fixed handful of fields.
 */
export function parseRosterEntry(
  raw: string,
  slug: string,
  file: string,
): { entry: RosterEntry } | { problem: RosterProblem } {
  const trimmed = raw.replace(/^﻿/, '');
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { problem: { file, reason: 'missing YAML frontmatter' } };
  }
  const block = match[1] ?? '';
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // §2.4's frontmatter is flat scalars only (`tools` is documented as a
    // comma-separated STRING, not a nested list) — an indented continuation
    // is something this reader doesn't understand, not something to guess at.
    if (/^\s/.test(line)) {
      return { problem: { file, reason: `malformed frontmatter line: ${line}` } };
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      return { problem: { file, reason: `malformed frontmatter line: ${line}` } };
    }
    const key = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    fields[key] = value;
  }

  // §2.4: "There is no `tier` field... Naming a cost bracket instead would
  // need a resolution step that does not exist." A `tier` field means this
  // file predates the ruling (or copied clud-bug's own rejected
  // beetle/wasp/mantis shape) and MUST be reported, not silently dropped.
  if ('tier' in fields) {
    return {
      problem: {
        file,
        reason:
          'has a `tier` field — a role names a model directly (SPEC §2.4); there is no cost-bracket field to resolve one from',
      },
    };
  }

  const name = fields['name'];
  if (!name) {
    return { problem: { file, reason: 'missing required `name` field' } };
  }
  const description = fields['description'];
  if (!description) {
    return { problem: { file, reason: 'missing required `description` field' } };
  }
  // §2.4: "MUST equal its filename without the extension."
  if (name !== slug) {
    return {
      problem: {
        file,
        reason: `\`name: ${name}\` does not match its filename (expected \`${slug}\`)`,
      },
    };
  }

  const entry: RosterEntry = { name, description, file };
  if (fields['model']) entry.model = fields['model'];
  if (fields['tools']) entry.tools = fields['tools'];
  if (fields['color']) entry.color = fields['color'];
  if (fields['trigger']) entry.trigger = fields['trigger'];
  return { entry };
}
