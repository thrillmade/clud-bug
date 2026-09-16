// SPEC §6.6 (now §4.3) conformance-fixture harness (NORMATIVE release-gate).
//
// For every scenario dir under `fixtures/reviews/<scenario>/`, render its
// input through the SAME renderer used to post the PR comment body and
// assert the output is byte-identical to the committed `expected.md`
// golden. A renderer change that alters the comment shape fails this gate
// until the goldens are regenerated + reviewed. Two input shapes:
//
//   - `input.json` (+ optional `meta.json`) → `renderReview(input, { meta })`
//   - `multipass.json`                      → `renderMultiPassMarkdown(input)`
//     (clud-bug#256 gap C — `renderMultiPassMarkdown` had zero fixture
//     coverage; a scenario using this shape is what gives it release-test
//     coverage at all, independent of who calls it in production.)
//
//   node scripts/fixture-check.mjs            # check (CI gate)
//   node scripts/fixture-check.mjs --update   # regenerate goldens
//
// Imports from `dist/` — run `npm run build` first (CI does, and the
// `test:fixtures` script is wired after the build step).

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURES = resolve(ROOT, 'fixtures/reviews');
const UPDATE = process.argv.includes('--update');

if (!existsSync(FIXTURES)) {
  console.error(`fixture-check: ${FIXTURES} does not exist.`);
  process.exit(1);
}

const { renderReview } = await import('../dist/core/render-review.js');
const { renderMultiPassMarkdown } = await import('../dist/core/review-writeback.js');

const scenarios = (await readdir(FIXTURES, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort((a, b) => a.localeCompare(b));

if (scenarios.length === 0) {
  console.error(`fixture-check: no scenario directories under ${FIXTURES}.`);
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const name of scenarios) {
  const dir = resolve(FIXTURES, name);
  let actual;
  try {
    const multiPassPath = resolve(dir, 'multipass.json');
    if (existsSync(multiPassPath)) {
      const input = JSON.parse(await readFile(multiPassPath, 'utf8'));
      actual = renderMultiPassMarkdown(input);
    } else {
      const input = JSON.parse(await readFile(resolve(dir, 'input.json'), 'utf8'));
      const metaPath = resolve(dir, 'meta.json');
      const meta = existsSync(metaPath)
        ? JSON.parse(await readFile(metaPath, 'utf8'))
        : undefined;
      actual = renderReview(input, meta ? { meta } : undefined);
    }
  } catch (err) {
    console.error(`FAIL  ${name} — input.json parse/render error: ${err.message}`);
    failed++;
    continue;
  }

  if (UPDATE) {
    await writeFile(resolve(dir, 'expected.md'), actual, 'utf8');
    console.log(`  updated  ${name}`);
    passed++;
    continue;
  }

  let expected;
  try {
    expected = await readFile(resolve(dir, 'expected.md'), 'utf8');
  } catch {
    console.error(`FAIL  ${name} — expected.md missing (run with --update to create it).`);
    failed++;
    continue;
  }

  if (actual === expected) {
    console.log(`  ok  ${name}`);
    passed++;
  } else {
    let i = 0;
    while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
    const win = (s) => JSON.stringify(s.slice(Math.max(0, i - 8), i + 16));
    console.error(`FAIL  ${name} — first diff at char ${i}:`);
    console.error(`        expected ${win(expected)}`);
    console.error(`        actual   ${win(actual)}`);
    failed++;
  }
}

console.log(`\nfixture-check: ${passed} passed, ${failed} failed${UPDATE ? ' (updated)' : ''}.`);
if (failed > 0) process.exit(1);
