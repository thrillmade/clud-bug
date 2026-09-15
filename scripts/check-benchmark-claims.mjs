#!/usr/bin/env node
// Drift gate for every published planted-defect-benchmark claim (#270).
//
//   node scripts/check-benchmark-claims.mjs
//
// Re-renders the blocks from `benchmark/results/latest.json` in memory and
// byte-compares them against what is committed. Same shape as
// scripts/fixture-check.mjs: the renderer is the only writer, and this is the
// gate that says so.
//
// It fails on either side of the drift — a hand-edited number in a doc, and a
// result file whose numbers nobody re-rendered. Fix both the same way:
// `node scripts/render-benchmark.mjs`.

import { readFileSync } from 'node:fs';

import { ROOT, jsxBlockViolations, readLatest, renderTargets } from './render-benchmark.mjs';

const errors = [];

let result;
try {
  result = readLatest();
} catch (err) {
  console.error(`::error::check-benchmark-claims: ${err.message}`);
  process.exit(1);
}

for (const [path, expected] of renderTargets(result)) {
  const rel = path.slice(ROOT.length + 1);
  let actual;
  try {
    actual = readFileSync(path, 'utf8');
  } catch {
    errors.push(`${rel} is missing — run \`node scripts/render-benchmark.mjs\``);
    continue;
  }
  if (actual === expected) {
    console.log(`  ok  ${rel}`);
    continue;
  }
  let i = 0;
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++;
  const window = (s) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 60));
  errors.push(
    `${rel} does not match benchmark/results/latest.json (first difference at char ${i}):\n` +
      `        committed ${window(actual)}\n` +
      `        rendered  ${window(expected)}`,
  );
}

errors.push(...jsxBlockViolations());

if (errors.length > 0) {
  for (const e of errors) console.error(`::error::check-benchmark-claims: ${e}`);
  console.error(
    `\ncheck-benchmark-claims: ${errors.length} published claim(s) drifted from ` +
      `benchmark/results/latest.json. Re-render with \`node scripts/render-benchmark.mjs\`.`,
  );
  process.exit(1);
}

console.log(`\ncheck-benchmark-claims: ok (run ${result.runId}, ${result.totals.caught}/${result.totals.total} caught)`);
