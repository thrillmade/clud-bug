#!/usr/bin/env node
// clud-bug#262 item 6 — ONE owner for "which SPEC §x.y sections exist".
//
//   node scripts/gen-spec-sections.mjs [--spec-path <file>] [--protocol-dir <dir>]
//
// `git grep -oE "SPEC §[0-9]+\.[0-9.]*" -- src/` found 167 citations across
// 38 files, many pre-SPEC-2.0 (§1.8.1, §7.2.1, §10.3.3 — SPEC 2.0 tops out
// at §8.3). Nothing had ever generated a list of sections that DO exist, so
// nothing could tell a stale citation from a live one except a human
// re-reading SPEC.md by hand. This script is that list's one owner.
//
// Resolution order for the source document:
//   1. --spec-path <file>            — read that file directly.
//   2. --protocol-dir <dir> (default: a sibling `../protocol` checkout, the
//      layout this repo's own docs assume) — `git -C <dir> show
//      origin/main:SPEC.md`.
//
// Writes data/spec-sections.json: every heading number + title, stamped
// with SPEC_VERSION (src/core/spec-version.ts — the same constant `--version`
// declares, so the index and the tool's own declared version can never
// silently diverge). `scripts/check-spec-citations.mjs` reads this file; it
// does not re-derive it.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec-path') out.specPath = argv[++i];
    else if (argv[i] === '--protocol-dir') out.protocolDir = argv[++i];
  }
  return out;
}

function readSpecText({ specPath, protocolDir }) {
  if (specPath) {
    return readFileSync(resolve(specPath), 'utf8');
  }
  const dir = protocolDir ?? join(ROOT, '..', 'protocol');
  try {
    return execFileSync('git', ['-C', dir, 'show', 'origin/main:SPEC.md'], {
      encoding: 'utf8',
    });
  } catch (err) {
    throw new Error(
      `could not read SPEC.md from the protocol clone at ${dir} (${err.message}). ` +
        'Pass --spec-path <file> to point at a local copy instead.',
    );
  }
}

/**
 * Extracts every numbered heading from SPEC.md.
 *
 * SPEC.md's two numbered heading shapes:
 *   `## Section N: Title`        — top-level (e.g. "## Section 4: Review")
 *   `### N.M Title`              — subsection (e.g. "### 4.1 What a review examines")
 *
 * Deliberately NOT matched: `## YYYY-MM-DD HH:MM - <Decision Title>` (the
 * §3.1 decision-record TEMPLATE heading, not a numbered SPEC section) and
 * any other `##`/`###` heading that isn't one of the two numbered shapes
 * above.
 */
export function extractSections(specText) {
  const sections = [];
  const seen = new Set();
  const add = (number, title) => {
    if (seen.has(number)) return; // first occurrence wins (matches SPEC.md's own uniqueness)
    seen.add(number);
    sections.push({ number, title: title.trim() });
  };
  for (const line of specText.split('\n')) {
    const top = line.match(/^##\s+Section\s+(\d+):\s*(.+)$/);
    if (top) {
      add(top[1], top[2]);
      continue;
    }
    const sub = line.match(/^###\s+(\d+(?:\.\d+)+)\s+(.+)$/);
    if (sub) {
      add(sub[1], sub[2]);
    }
  }
  return sections;
}

function readSpecVersion() {
  const src = readFileSync(join(ROOT, 'src/core/spec-version.ts'), 'utf8');
  const m = src.match(/export const SPEC_VERSION = '([^']+)'/);
  if (!m) {
    throw new Error('could not find SPEC_VERSION in src/core/spec-version.ts');
  }
  return m[1];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const specText = readSpecText(args);
  const sections = extractSections(specText);
  if (sections.length === 0) {
    throw new Error('extracted zero sections — the heading regex or the SPEC.md source is wrong');
  }
  const specVersion = readSpecVersion();
  const out = {
    specVersion,
    // Deterministic output (SPEC §2.7): no timestamp, no absolute path —
    // two runs against the same SPEC.md text produce byte-identical JSON.
    source: 'thrillmade/protocol SPEC.md',
    sections,
  };
  const outPath = join(ROOT, 'data', 'spec-sections.json');
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`gen-spec-sections: wrote ${sections.length} section(s) (spec ${specVersion}) to data/spec-sections.json`);
}

// Only run when invoked directly (not when imported for its `extractSections`
// export, e.g. by check-spec-citations.mjs's own tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
