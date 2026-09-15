// clud-bug#301/#305 — where THIS repo documents skill authoring (README.md's
// "Adding your own skills" section) must state the two facts that were
// previously wrong or missing:
//
//   #305: the reviewer reads a skill's SKILL.md body only — a references/
//   subdirectory next to it is never inlined into the prompt. Silent on
//   this, an author following standard progressive-disclosure advice moves
//   content into references/ and deletes it from the review with no signal.
//
//   #301: the per-skill byte cap has exactly one owner, the library's
//   DEFAULT_MAX_SKILL_BYTES constant — not a second, independently-stated
//   number in prose.
//
// These are prose facts, not renderer output, so the test reads README.md
// directly rather than rendering a template.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_SKILL_BYTES } from '../src/core/prompt-builder.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function readReadme() {
  return readFile(join(PKG_ROOT, 'README.md'), 'utf8');
}

test('#305: README documents that the reviewer reads SKILL.md only, never references/', async () => {
  const readme = await readReadme();
  assert.match(readme, /references\/[^\n]*(never|not)[^\n]*read/i, 'no statement that references/ is not read into the prompt');
  assert.match(readme, /SKILL\.md/);
});

test('#301: README states the skill byte cap as the library constant, not a second number', async () => {
  const readme = await readReadme();
  assert.match(readme, /DEFAULT_MAX_SKILL_BYTES/, 'README does not name the one owner of the byte-cap fact');
  // The number stated must be the constant's actual value — not a stale
  // hand-copied figure that could silently drift from it.
  assert.match(readme, new RegExp(String(DEFAULT_MAX_SKILL_BYTES)));
});

// The skill frontmatter contract moved when SPEC 2.0 merged: its headings run
// 1.8 → 2.1, so there is no §1.10 to cite. `§1.10.1` is different — those
// citations are version-stamped (`v0.5.1+`) and record what an older SPEC
// said, which stays true and stays put. A bare `§1.10` sends a reader to a
// section that does not exist.
async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(abs)));
    else if (entry.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

test('SPEC 2.0 has no §1.10 — no source file cites one (version-stamped §1.10.1 is historical and allowed)', async () => {
  const stale = [];
  for (const abs of await sourceFiles(join(PKG_ROOT, 'src'))) {
    const lines = (await readFile(abs, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (/§1\.10(?!\.1)/.test(line)) stale.push(`${abs.slice(PKG_ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(stale, [], `citations of a SPEC section that does not exist:\n${stale.join('\n')}`);
});

// What makes a `§1.10.1` citation legitimate is the version stamp, not the
// extra digit: unstamped, it reads as a live section of the SPEC 2.0 the rest
// of the file cites, and SPEC 2.0's headings run 1.8 → 2.1. So the stamp is
// the whole guard, and an unstamped one is the same stale pointer the test
// above catches — just spelled differently.
test('a §1.10.1 citation carries the SPEC version it is true of', async () => {
  const unstamped = [];
  for (const abs of await sourceFiles(join(PKG_ROOT, 'src'))) {
    const lines = (await readFile(abs, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (/§1\.10\.1/.test(line) && !/§1\.10\.1 v\d/.test(line)) {
        unstamped.push(`${abs.slice(PKG_ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(unstamped, [], `§1.10.1 cited without the SPEC version that has it:\n${unstamped.join('\n')}`);
});
