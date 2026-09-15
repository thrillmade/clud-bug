// The config documentation has one owner: `CONFIG_KEYS` (clud-bug#271).
//
// The docs site is a separate package and cannot import `src/core`, so the
// table it renders is a copy — and a hand-kept copy reads as true until one
// quietly isn't. These tests fail on divergence: a key added to the schema
// without being documented, a key documented that the schema does not have,
// and any wording of the refusal's guarantee that is not the schema's own.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONFIG_KEYS,
  NAMED_CONFIG_KEYS,
  HONEST_GUARANTEE,
} from '../src/core/config-schema.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCS_PAGE = join(ROOT, 'site', 'app', 'docs', 'config', 'page.tsx');
const README = join(ROOT, 'README.md');

test('the docs page names every settable key, by both of its names', async () => {
  const page = await readFile(DOCS_PAGE, 'utf8');
  for (const key of NAMED_CONFIG_KEYS) {
    assert.ok(page.includes(key), `docs page does not mention ${key}`);
    const onDisk = CONFIG_KEYS[key].path.join('.');
    assert.ok(page.includes(onDisk), `docs page does not mention the on-disk key ${onDisk}`);
  }
});

test('the docs page documents no key the schema does not have', async () => {
  const page = await readFile(DOCS_PAGE, 'utf8');
  // Every `review.x` / `design.x` looking key the page names must be real.
  for (const [, key] of page.matchAll(/<code>((?:review|design)\.[a-z_.]+)<\/code>/g)) {
    assert.ok(CONFIG_KEYS[key], `docs page documents ${key}, which is not in CONFIG_KEYS`);
  }
});

test('the docs page teaches the command, not the hand edit', async () => {
  const page = await readFile(DOCS_PAGE, 'utf8');
  assert.match(page, /clud-bug config set/);
  assert.match(page, /clud-bug config list/);
});

// §1.6:266 — what actually holds when the rule is broken. The docs may not
// claim more than the schema does, so they carry the schema's own sentence.
test('the docs page and the README carry the honest guarantee verbatim', async () => {
  const page = await readFile(DOCS_PAGE, 'utf8');
  assert.ok(
    page.includes(HONEST_GUARANTEE),
    'site/app/docs/config/page.tsx must carry HONEST_GUARANTEE verbatim',
  );
  const readme = await readFile(README, 'utf8');
  assert.ok(readme.includes(HONEST_GUARANTEE), 'README.md must carry HONEST_GUARANTEE verbatim');
});

test('the README config section names the command and the humans-only keys', async () => {
  const readme = await readFile(README, 'utf8');
  assert.match(readme, /## Configuration/);
  assert.match(readme, /clud-bug config set <key> <value>/);
  for (const key of NAMED_CONFIG_KEYS.filter((k) => CONFIG_KEYS[k].owner === 'human')) {
    assert.ok(readme.includes(key), `README does not name the humans-only key ${key}`);
  }
});

test('the README no longer sends a reader to hand-edit a settable key', async () => {
  const readme = await readFile(README, 'utf8');
  // The three passages that used to say "add X to .claude/skills/.clud-bug.json".
  for (const phrase of [
    'add `pinVersion` to',
    'add `"strictMode": true` to',
    'add `"notary": false` to',
  ]) {
    assert.equal(readme.includes(phrase), false, `README still says: ${phrase}`);
  }
});
