// 0.0.E (v0.6.17): golden-set regression gate for the review prompt.
//
// Runs three categories of structural checks against the rendered prompt:
//
//   1. must-contain  — instruction phrases that load-bearing CI relies on
//   2. must-not-contain — anti-pattern filler that the LLM token guide § 6 flags
//   3. byte-budget  — size caps so future trims have headroom, not slop
//
// Gates 0.0.P (prompt trim) and 0.0.O (schema enforcement). Cheap,
// deterministic, runs on every PR. See test/golden/README.md for the
// fixture format + when to update.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewPrompt } from '../src/core/prompts.js';

const GOLDEN = join(import.meta.dirname, 'golden');

async function loadFixture(name) {
  const raw = await readFile(join(GOLDEN, name), 'utf8');
  return JSON.parse(raw);
}

const PROMPT_ARGS = { projectDescription: 'p' };

test('golden: must-contain — every required instruction phrase is in the prompt', async () => {
  const fixture = await loadFixture('must-contain.json');
  const prompt = reviewPrompt(PROMPT_ARGS);
  const missing = [];
  for (const entry of fixture.entries) {
    const re = new RegExp(entry.pattern, 'u');
    if (!re.test(prompt)) {
      missing.push(`  • ${entry.pattern} (${entry.category}) — ${entry.why}`);
    }
  }
  assert.equal(
    missing.length, 0,
    `\n${missing.length} required instruction(s) missing from the rendered prompt:\n${missing.join('\n')}\n\nAdd them back to lib/prompts.js OR remove the entry from test/golden/must-contain.json if intentionally dropped (with a CHANGELOG note).`,
  );
});

test('golden: must-not-contain — no filler anti-patterns are in the prompt', async () => {
  const fixture = await loadFixture('must-not-contain.json');
  const prompt = reviewPrompt(PROMPT_ARGS);
  const present = [];
  for (const entry of fixture.entries) {
    const re = new RegExp(entry.pattern, 'i');
    if (re.test(prompt)) {
      present.push(`  • ${entry.pattern} (${entry.category}) — ${entry.why}`);
    }
  }
  assert.equal(
    present.length, 0,
    `\n${present.length} anti-pattern phrase(s) leaked into the rendered prompt:\n${present.join('\n')}\n\nRemove from lib/prompts.js. These are filler per the LLM token optimization guide § 6.`,
  );
});

test('golden: byte-budget — rendered prompt is under the size cap', async () => {
  const fixture = await loadFixture('byte-budget.json');
  const prompt = reviewPrompt(PROMPT_ARGS);
  const actualBytes = Buffer.byteLength(prompt, 'utf8');
  const capBytes = fixture.max_prompt_bytes.value;
  assert.ok(
    actualBytes <= capBytes,
    `Rendered prompt is ${actualBytes} bytes, exceeds cap of ${capBytes} bytes. ` +
    `${fixture.max_prompt_bytes.why} If the growth is intentional, bump the cap with a CHANGELOG entry explaining why.`,
  );
});

test('golden: byte-budget — rendered prompt is under the line cap', async () => {
  const fixture = await loadFixture('byte-budget.json');
  const prompt = reviewPrompt(PROMPT_ARGS);
  const actualLines = prompt.split('\n').length;
  const capLines = fixture.max_prompt_lines.value;
  assert.ok(
    actualLines <= capLines,
    `Rendered prompt is ${actualLines} lines, exceeds cap of ${capLines} lines. ` +
    `${fixture.max_prompt_lines.why}`,
  );
});

test('golden: fixture sanity — each must-contain entry has why + category', async () => {
  // Catches malformed fixtures.
  const fixture = await loadFixture('must-contain.json');
  for (const entry of fixture.entries) {
    assert.equal(typeof entry.pattern, 'string', 'pattern must be a string');
    assert.equal(typeof entry.why, 'string', `${entry.pattern}: why must be a string`);
    assert.equal(typeof entry.category, 'string', `${entry.pattern}: category must be a string`);
    assert.ok(entry.why.length >= 10, `${entry.pattern}: why must be substantive (>=10 chars)`);
  }
});

test('golden: fixture sanity — each must-not-contain entry has why + category', async () => {
  const fixture = await loadFixture('must-not-contain.json');
  for (const entry of fixture.entries) {
    assert.equal(typeof entry.pattern, 'string');
    assert.ok(entry.why.length >= 10);
    assert.equal(typeof entry.category, 'string');
  }
});
