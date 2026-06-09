// Equivalence test: .github/actions/strict-mode-gate/classifier.mjs must
// produce byte-identical results to src/core/skills.ts for the two
// functions the composite action uses (selectReviewHeader,
// isCriticalReviewHeader).
//
// Why this matters: the strict-mode-gate composite action is checked into
// this repo at the same ref as the rest of the source. To keep the action
// buildless, we vendored the two pure functions instead of having the
// action import from src/. This test prevents drift — if anyone updates
// the skills.ts versions without copying the change to classifier.mjs,
// CI fails here.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import * as core from '../src/core/skills.js';
import * as vendored from '../.github/actions/strict-mode-gate/classifier.mjs';

const SAMPLE_COMMENTS = [
  {
    user: { login: 'github-actions[bot]' },
    body: 'unrelated CI comment\nsecond line',
    created_at: '2026-06-08T10:00:00Z',
  },
  {
    user: { login: 'clud-bug[bot]' },
    body: '**Claude finished**\n\n---\n## 🐛 Clud Bug review — clean\n\n0 critical · 0 minor',
    created_at: '2026-06-08T11:00:00Z',
  },
  {
    user: { login: 'clud-bug[bot]' },
    body: '**Claude finished**\n\n---\n## 🐛 Clud Bug review — critical findings\n\n1 critical',
    created_at: '2026-06-08T12:00:00Z',
  },
];

test('selectReviewHeader: vendored matches src/core/skills.ts', () => {
  for (const botLogin of ['clud-bug[bot]', 'github-actions[bot]', 'unknown', '']) {
    const expected = core.selectReviewHeader(SAMPLE_COMMENTS, botLogin);
    const actual = vendored.selectReviewHeader(SAMPLE_COMMENTS, botLogin);
    assert.equal(actual, expected, `mismatch for botLogin=${botLogin}`);
  }
});

test('selectReviewHeader: vendored handles edge cases identically', () => {
  const cases = [
    [null, 'clud-bug[bot]'],
    [undefined, 'clud-bug[bot]'],
    [[], 'clud-bug[bot]'],
    [SAMPLE_COMMENTS, null],
    [SAMPLE_COMMENTS, 123],
    [SAMPLE_COMMENTS, ''],
  ];
  for (const [comments, botLogin] of cases) {
    const expected = core.selectReviewHeader(comments, botLogin);
    const actual = vendored.selectReviewHeader(comments, botLogin);
    assert.equal(actual, expected);
  }
});

test('isCriticalReviewHeader: vendored matches src/core/skills.ts', () => {
  const cases = [
    '## 🐛 Clud Bug review — critical findings',
    '## 🐛 Clud Bug review — clean',
    '## 🐛 Clud Bug review',
    'random text',
    null,
    undefined,
    '',
  ];
  for (const line of cases) {
    const expected = core.isCriticalReviewHeader(line);
    const actual = vendored.isCriticalReviewHeader(line);
    assert.equal(actual, expected, `mismatch for line=${JSON.stringify(line)}`);
  }
});

test('extractFirstReviewHeaderLine: vendored matches src/core/skills.ts', () => {
  const cases = [
    '## 🐛 Clud Bug review — clean\n\nbody',
    '**Claude finished**\n\n---\n## 🐛 Clud Bug review — critical findings\n\nrest',
    'no header here',
    '',
    null,
  ];
  for (const body of cases) {
    const expected = core.extractFirstReviewHeaderLine(body);
    const actual = vendored.extractFirstReviewHeaderLine(body);
    assert.equal(actual, expected);
  }
});
