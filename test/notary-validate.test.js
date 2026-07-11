// Phase Z3 — the notary's deterministic validators (③ coverage · ④ grounding ·
// ⑤ consistency) + the diff splitter. These gate the un-forgeable merge check,
// so the adversarial cases (fabricated critical, dropped real critical, verdict
// lie, removed-line grounding) are the point — not an afterthought.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import {
  validateConsistency,
  validateCoverage,
  validateGrounding,
  validateBundle,
  spanAppearsInDiff,
  splitUnifiedDiff,
} from '../src/core/notary-validate.js';
import { buildBundle } from '../src/core/notary-bundle.js';

// A realistic single-file patch: one removed line, two added lines, context.
const APP_PATCH = [
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const password = "hunter2";',
  ' export { a };',
].join('\n');

const DIFF = [{ filename: 'src/app.ts', patch: APP_PATCH }];

// ---------------------------------------------------------------------------
// ⑤ consistency
// ---------------------------------------------------------------------------

test('consistency: clean with a critical finding is rejected', () => {
  const r = validateConsistency('clean', [{ severity: 'critical', summary: 'x' }]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /clean/);
});

test('consistency: critical verdict with no critical findings is rejected', () => {
  const r = validateConsistency('critical', [{ severity: 'minor', summary: 'x' }]);
  assert.equal(r.ok, false);
});

test('consistency: clean with no criticals passes', () => {
  assert.equal(validateConsistency('clean', [{ severity: 'minor', summary: 'x' }]).ok, true);
  assert.equal(validateConsistency('clean', []).ok, true);
});

test('consistency: critical with a critical finding passes', () => {
  assert.equal(validateConsistency('critical', [{ severity: 'critical', summary: 'x', grounding: 'y' }]).ok, true);
});

test('consistency: unverified/failed are self-consistent regardless of findings', () => {
  assert.equal(validateConsistency('unverified', [{ severity: 'critical', summary: 'x' }]).ok, true);
  assert.equal(validateConsistency('failed', []).ok, true);
});

// ---------------------------------------------------------------------------
// ③ coverage
// ---------------------------------------------------------------------------

test('coverage: a changed file absent from the claim fails (silent skip)', () => {
  const r = validateCoverage([], DIFF);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingFiles, ['src/app.ts']);
});

test('coverage: every changed file claimed passes', () => {
  assert.equal(validateCoverage(['src/app.ts'], DIFF).ok, true);
});

test('coverage: extra claimed files (not in the diff) are harmless', () => {
  assert.equal(validateCoverage(['src/app.ts', 'src/other.ts'], DIFF).ok, true);
});

test('coverage: empty diff is trivially covered', () => {
  assert.equal(validateCoverage([], []).ok, true);
});

// ---------------------------------------------------------------------------
// ④ grounding — the core anti-forgery check
// ---------------------------------------------------------------------------

test('grounding: a critical quoting a real added line passes', () => {
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'hardcoded secret', grounding: 'const password = "hunter2";', grounding_kind: 'quote' }],
    DIFF,
  );
  assert.equal(r.ok, true);
  assert.equal(r.violations.length, 0);
});

test('grounding: a FABRICATED critical (span not in the diff) is rejected', () => {
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/app.ts', line: 9, summary: 'made up', grounding: 'const nope = neverHappened();', grounding_kind: 'quote' }],
    DIFF,
  );
  assert.equal(r.ok, false);
  assert.match(r.violations[0].reason, /not found in the diff/);
});

test('grounding: a critical grounded on a REMOVED line is rejected (left-side only)', () => {
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/app.ts', line: 2, summary: 'x', grounding: 'const b = 2;', grounding_kind: 'quote' }],
    DIFF,
  );
  assert.equal(r.ok, false);
});

test('grounding: a bare critical (no grounding at all) is rejected', () => {
  const r = validateGrounding([{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'x' }], DIFF);
  assert.equal(r.ok, false);
  assert.match(r.violations[0].reason, /no grounding/);
});

test('grounding: reproduction/invariant criticals are unverifiable, not rejected', () => {
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'race', grounding: 'ran the repro; observed a deadlock', grounding_kind: 'reproduction' }],
    DIFF,
  );
  assert.equal(r.ok, true);
  assert.equal(r.violations.length, 0);
  assert.equal(r.unverifiable.length, 1);
});

test('grounding: quote-grounded critical on a file not in the diff is rejected', () => {
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/ghost.ts', line: 1, summary: 'x', grounding: 'anything', grounding_kind: 'quote' }],
    DIFF,
  );
  assert.equal(r.ok, false);
  assert.match(r.violations[0].reason, /not in the diff/);
});

test('grounding: minor/preexisting findings are not grounding-gated', () => {
  const r = validateGrounding(
    [
      { severity: 'minor', file: 'src/app.ts', line: 3, summary: 'nit' },
      { severity: 'preexisting', summary: 'old' },
    ],
    DIFF,
  );
  assert.equal(r.ok, true);
});

test('grounding: whitespace/indentation differences still match', () => {
  // agent quotes with different leading indentation than the diff bytes.
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'x', grounding: '   const   password = "hunter2";   ', grounding_kind: 'quote' }],
    DIFF,
  );
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------------------
// spanAppearsInDiff (unit)
// ---------------------------------------------------------------------------

test('spanAppearsInDiff: matches an added line, not a removed one', () => {
  assert.equal(spanAppearsInDiff('const b = 3;', APP_PATCH), true);
  assert.equal(spanAppearsInDiff('const b = 2;', APP_PATCH), false);
});

test('spanAppearsInDiff: matches a context line (head-side)', () => {
  assert.equal(spanAppearsInDiff('export { a };', APP_PATCH), true);
});

test('spanAppearsInDiff: empty span never matches', () => {
  assert.equal(spanAppearsInDiff('   ', APP_PATCH), false);
});

// ---------------------------------------------------------------------------
// validateBundle — the two adversarial end-to-end cases from the plan
// ---------------------------------------------------------------------------

test('validateBundle: a well-formed grounded review passes', () => {
  const bundle = buildBundle({
    repo: 'o/r', pr: 1, headSha: 'a'.repeat(40), verdict: 'critical',
    findings: [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'secret', grounding: 'const password = "hunter2";', grounding_kind: 'quote' }],
    coverage: ['src/app.ts'], recipeVersion: 'test',
  });
  assert.equal(validateBundle(bundle, DIFF).ok, true);
});

test('validateBundle: FABRICATED critical fails on grounding', () => {
  const bundle = buildBundle({
    repo: 'o/r', headSha: 'a'.repeat(40), verdict: 'critical',
    findings: [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'fake', grounding: 'not in diff at all', grounding_kind: 'quote' }],
    coverage: ['src/app.ts'], recipeVersion: 'test',
  });
  const v = validateBundle(bundle, DIFF);
  assert.equal(v.ok, false);
  assert.equal(v.grounding.ok, false);
});

test('validateBundle: DROPPED real critical (unreviewed changed file) fails on coverage', () => {
  // The review claims clean but never covered the file the diff changed.
  const bundle = buildBundle({
    repo: 'o/r', headSha: 'a'.repeat(40), verdict: 'clean',
    findings: [], coverage: [], recipeVersion: 'test',
  });
  const v = validateBundle(bundle, DIFF);
  assert.equal(v.ok, false);
  assert.equal(v.coverage.ok, false);
});

test('validateBundle: verdict lie (clean + critical) fails on consistency', () => {
  const bundle = buildBundle({
    repo: 'o/r', headSha: 'a'.repeat(40), verdict: 'clean',
    findings: [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'x', grounding: 'const password = "hunter2";', grounding_kind: 'quote' }],
    coverage: ['src/app.ts'], recipeVersion: 'test',
  });
  const v = validateBundle(bundle, DIFF);
  assert.equal(v.ok, false);
  assert.equal(v.consistency.ok, false);
});

// ---------------------------------------------------------------------------
// splitUnifiedDiff
// ---------------------------------------------------------------------------

test('splitUnifiedDiff: splits a multi-file diff into per-file patches', () => {
  const raw = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index abc..def 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1;',
    '+const b = 2;',
    ' export { a };',
    'diff --git a/README.md b/README.md',
    'index 111..222 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const files = splitUnifiedDiff(raw);
  assert.equal(files.length, 2);
  assert.equal(files[0].filename, 'src/app.ts');
  assert.ok(files[0].patch.startsWith('@@ -1,2 +1,3 @@'));
  assert.ok(files[0].patch.includes('+const b = 2;'));
  assert.equal(files[1].filename, 'README.md');
  assert.ok(files[1].patch.includes('+new'));
});

test('splitUnifiedDiff: a pure rename (no hunk) yields a file with no patch', () => {
  const raw = [
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
  ].join('\n');
  const files = splitUnifiedDiff(raw);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'new.txt');
  assert.equal(files[0].patch, undefined);
});

test('splitUnifiedDiff: empty input yields no files', () => {
  assert.deepEqual(splitUnifiedDiff(''), []);
});

test('splitUnifiedDiff: decodes a git-quoted non-ASCII filename (café.ts)', () => {
  // Real git (core.quotepath default) octal-escapes é as \303\251 and quotes the path.
  const raw = [
    'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
    'index abc..def 100644',
    '--- "a/caf\\303\\251.ts"',
    '+++ "b/caf\\303\\251.ts"',
    '@@ -1 +1 @@',
    '-const x = 1;',
    '+const x = 2;',
  ].join('\n');
  const files = splitUnifiedDiff(raw);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'café.ts');
  assert.ok(files[0].patch.includes('+const x = 2;'));
});

test('splitUnifiedDiff: strips the git-appended trailing tab on a space-containing path', () => {
  const raw = [
    'diff --git a/my file.ts b/my file.ts',
    'index abc..def 100644',
    '--- a/my file.ts\t',
    '+++ b/my file.ts\t',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n');
  const files = splitUnifiedDiff(raw);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'my file.ts');
});

test('splitUnifiedDiff: a quoted non-ASCII file still grounds a critical (no false-reject)', () => {
  const raw = [
    'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
    '--- "a/caf\\303\\251.ts"',
    '+++ "b/caf\\303\\251.ts"',
    '@@ -1,2 +1,2 @@',
    ' const a = 1;',
    '+const secret = "leak";',
  ].join('\n');
  const r = validateGrounding(
    [{ severity: 'critical', file: 'café.ts', line: 2, summary: 'secret', grounding: 'const secret = "leak";', grounding_kind: 'quote' }],
    splitUnifiedDiff(raw),
  );
  assert.equal(r.ok, true);
});

test('splitUnifiedDiff output round-trips through the validators', () => {
  const raw = [
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const password = "hunter2";',
    ' export { a };',
  ].join('\n');
  const files = splitUnifiedDiff(raw);
  const r = validateGrounding(
    [{ severity: 'critical', file: 'src/app.ts', line: 3, summary: 'x', grounding: 'const password = "hunter2";', grounding_kind: 'quote' }],
    files,
  );
  assert.equal(r.ok, true);
});
