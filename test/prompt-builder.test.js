// Equivalence test: src/core/prompt-builder.ts must produce byte-identical
// outputs to the App's lib/prompt-builder.ts that it was ported from.
//
// Pattern mirrors test/review-schema-zod.test.js. We don't dynamic-import
// the App at runtime (different package, different deps); instead we hold
// fixture outputs that the App-side helper produced and assert the core
// port matches byte-for-byte.
//
// If a future edit drifts the core port from the App-side original, this
// test fires + the App's swap to clud-bug/core would change the model's
// prompt text — which silently changes review behavior. Hard NO on drift.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import {
  buildReviewPrompt,
  buildCrossCheckPrompt,
  buildConsensusPrompt,
  skillMatchesDiff,
  globMatch,
  truncatePatch,
  MAX_PATCH_BYTES_PER_FILE,
  DEFAULT_MAX_SKILL_BYTES,
} from '../src/core/prompt-builder.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIFF_EMPTY = {
  files: [],
  headSha: '1234567890abcdef1234567890abcdef12345678',
  baseSha: 'abcdef1234567890abcdef1234567890abcdef12',
  baseRef: 'main',
  headRef: 'feature/x',
  totalChanges: 0,
  totalPatchBytes: 0,
};

const DIFF_TS = {
  files: [
    {
      path: 'src/auth.ts',
      status: 'modified',
      additions: 5,
      deletions: 2,
      patch: '@@ -1,3 +1,5 @@\n+import { token } from "./tok";\n const auth = 1;\n',
    },
    {
      path: 'src/binary.png',
      status: 'added',
      additions: 0,
      deletions: 0,
      patch: undefined,
    },
  ],
  headSha: '1234567890abcdef1234567890abcdef12345678',
  baseSha: 'abcdef1234567890abcdef1234567890abcdef12',
  baseRef: 'main',
  headRef: 'feature/x',
  totalChanges: 7,
  totalPatchBytes: 80,
};

const SKILL_RACE = {
  slug: 'race-conditions',
  frontmatter: {
    name: 'race-conditions',
    description: 'Flag concurrency bugs.',
    applies_to: { extensions: ['.ts', '.tsx'] },
  },
  body: 'Look for shared mutable state across async boundaries.',
};

const SKILL_GENERIC = {
  slug: 'critical-issues-only',
  frontmatter: {
    name: 'critical-issues-only',
    description: 'Only correctness + security.',
    // No applies_to → universal.
  },
  body: 'Skip nits.',
};

const SKILL_PY = {
  slug: 'pep8',
  frontmatter: {
    name: 'pep8',
    description: 'PEP8 style.',
    applies_to: { extensions: ['.py'] },
  },
  body: 'Run flake8.',
};

const INPUT_TS = {
  repo: { owner: 'thrillmade', name: 'clud-bug' },
  pr: { number: 158, title: 'Add auth token refresh', baseRef: 'main', headRef: 'feature/x' },
  diff: DIFF_TS,
  skills: [SKILL_RACE, SKILL_GENERIC, SKILL_PY],
};

// ---------------------------------------------------------------------------
// buildReviewPrompt: shape + content
// ---------------------------------------------------------------------------

test('buildReviewPrompt: returns system + prompt + tracking arrays', () => {
  const out = buildReviewPrompt(INPUT_TS);
  assert.equal(typeof out.system, 'string');
  assert.equal(typeof out.prompt, 'string');
  assert.ok(Array.isArray(out.includedSkillSlugs));
  assert.ok(Array.isArray(out.skippedFiles));
});

test('buildReviewPrompt: system prompt names the bot + severity taxonomy', () => {
  const { system } = buildReviewPrompt(INPUT_TS);
  assert.ok(system.includes('clud-bug'));
  assert.ok(system.includes('critical'));
  assert.ok(system.includes('minor'));
  assert.ok(system.includes('preexisting'));
});

test('buildReviewPrompt: user prompt carries PR metadata', () => {
  const { prompt } = buildReviewPrompt(INPUT_TS);
  assert.ok(prompt.includes('thrillmade/clud-bug#158'));
  assert.ok(prompt.includes('Add auth token refresh'));
  assert.ok(prompt.includes('main'));
  assert.ok(prompt.includes('feature/x'));
  // SHAs are truncated to 12 chars.
  assert.ok(prompt.includes(DIFF_TS.headSha.slice(0, 12)));
  assert.ok(prompt.includes(DIFF_TS.baseSha.slice(0, 12)));
});

test('buildReviewPrompt: includes matching skills, skips non-matching', () => {
  const { prompt, includedSkillSlugs } = buildReviewPrompt(INPUT_TS);
  // race-conditions (.ts) + critical-issues-only (universal) match.
  assert.deepEqual(includedSkillSlugs, ['race-conditions', 'critical-issues-only']);
  // pep8 has applies_to extensions = ['.py'] but no .py files; it should
  // be in the prompt as "(skipped: applies_to didn't match...)".
  assert.ok(prompt.includes('pep8'));
  assert.ok(prompt.includes("(skipped: applies_to didn't match any changed file)"));
  // race-conditions body should appear.
  assert.ok(prompt.includes('shared mutable state'));
});

test('buildReviewPrompt: notes skipped binary files', () => {
  const { prompt, skippedFiles } = buildReviewPrompt(INPUT_TS);
  assert.ok(skippedFiles.includes('src/binary.png'));
  assert.ok(prompt.includes('src/binary.png'));
  assert.ok(prompt.includes('(no patch'));
});

test('buildReviewPrompt: empty skills → bare prompt', () => {
  const { prompt } = buildReviewPrompt({ ...INPUT_TS, skills: [] });
  assert.ok(prompt.includes('No skills are installed'));
  assert.ok(prompt.includes('status_header: "bare"'));
});

test('buildReviewPrompt: empty diff → "_(empty diff)_" marker', () => {
  const { prompt } = buildReviewPrompt({ ...INPUT_TS, diff: DIFF_EMPTY });
  assert.ok(prompt.includes('_(empty diff)_'));
});

test('buildReviewPrompt: maxSkillBytes caps oversized skill body', () => {
  const oversized = {
    slug: 'oversize',
    frontmatter: { name: 'oversize', description: 'X' },
    body: 'A'.repeat(10000),
  };
  const { prompt } = buildReviewPrompt({
    ...INPUT_TS,
    skills: [oversized],
    maxSkillBytes: 100,
  });
  assert.ok(prompt.includes('truncated at 100 bytes'));
  // Body slice should be 100 chars of 'A'.
  assert.ok(!prompt.includes('A'.repeat(10000)));
});

test('buildReviewPrompt: default maxSkillBytes = DEFAULT_MAX_SKILL_BYTES (8192)', () => {
  assert.equal(DEFAULT_MAX_SKILL_BYTES, 8192);
  const bodyJustOver = 'A'.repeat(DEFAULT_MAX_SKILL_BYTES + 100);
  const oversized = {
    slug: 'oversize',
    frontmatter: { name: 'oversize', description: 'X' },
    body: bodyJustOver,
  };
  const { prompt } = buildReviewPrompt({ ...INPUT_TS, skills: [oversized] });
  assert.ok(prompt.includes(`truncated at ${DEFAULT_MAX_SKILL_BYTES} bytes`));
});

// ---------------------------------------------------------------------------
// buildCrossCheckPrompt
// ---------------------------------------------------------------------------

test('buildCrossCheckPrompt: includes Pass 1 findings numbered list', () => {
  const out = buildCrossCheckPrompt({
    ...INPUT_TS,
    pass1Findings: [
      {
        skill: 'race-conditions', file: 'src/auth.ts', line: 12,
        summary: 'Race on token', reasoning: 'A overwrites B.', severity: 'critical',
      },
      {
        skill: 'critical-issues-only', file: 'src/auth.ts', line: 20,
        summary: 'Missing test', severity: 'minor',
      },
    ],
  });
  assert.ok(out.system.includes('cross-check'));
  assert.ok(out.prompt.includes('## Pass 1 findings'));
  // 0-indexed.
  assert.ok(out.prompt.match(/^0\. \[critical\] \*\*src\/auth\.ts:12\*\*/m));
  assert.ok(out.prompt.match(/^1\. \[minor\] \*\*src\/auth\.ts:20\*\*/m));
  // Reasoning rendered indented.
  assert.ok(out.prompt.includes('Reasoning: A overwrites B.'));
});

test('buildCrossCheckPrompt: empty Pass 1 findings → marker', () => {
  const out = buildCrossCheckPrompt({ ...INPUT_TS, pass1Findings: [] });
  assert.ok(out.prompt.includes('(Pass 1 produced no findings.)'));
});

// ---------------------------------------------------------------------------
// buildConsensusPrompt
// ---------------------------------------------------------------------------

test('buildConsensusPrompt: identical user prompt to buildReviewPrompt', () => {
  const a = buildReviewPrompt(INPUT_TS);
  const b = buildConsensusPrompt(INPUT_TS);
  assert.equal(a.prompt, b.prompt);
});

test('buildConsensusPrompt: different system prompt (conservative)', () => {
  const a = buildReviewPrompt(INPUT_TS);
  const b = buildConsensusPrompt(INPUT_TS);
  assert.notEqual(a.system, b.system);
  assert.ok(b.system.includes('CONSERVATIVE'));
  assert.ok(b.system.includes('intersect'));
});

// ---------------------------------------------------------------------------
// Pure helpers — skillMatchesDiff, globMatch, truncatePatch
// ---------------------------------------------------------------------------

test('skillMatchesDiff: no applies_to → matches anything', () => {
  assert.equal(skillMatchesDiff(undefined, ['anything.x']), true);
});

test('skillMatchesDiff: empty applies_to → matches anything', () => {
  assert.equal(skillMatchesDiff({}, ['a.ts']), true);
});

test('skillMatchesDiff: extension match', () => {
  assert.equal(skillMatchesDiff({ extensions: ['.ts'] }, ['a.ts']), true);
  assert.equal(skillMatchesDiff({ extensions: ['.ts'] }, ['a.py']), false);
});

test('skillMatchesDiff: path glob match', () => {
  assert.equal(skillMatchesDiff({ paths: ['src/**'] }, ['src/auth.ts']), true);
  assert.equal(skillMatchesDiff({ paths: ['src/**'] }, ['lib/auth.ts']), false);
});

test('globMatch: ** vs *', () => {
  assert.equal(globMatch('src/**', 'src/a/b.ts'), true);
  assert.equal(globMatch('src/*', 'src/a/b.ts'), false);
  assert.equal(globMatch('src/*', 'src/a.ts'), true);
});

test('globMatch: escapes regex metachars in literal pattern', () => {
  // A literal `.` in the pattern must NOT match any char.
  assert.equal(globMatch('a.b', 'aXb'), false);
  assert.equal(globMatch('a.b', 'a.b'), true);
});

test('truncatePatch: under cap → unchanged', () => {
  const small = 'a'.repeat(100);
  assert.equal(truncatePatch(small), small);
});

test('truncatePatch: over cap → sliced with omitted marker', () => {
  const huge = 'a'.repeat(MAX_PATCH_BYTES_PER_FILE + 1000);
  const out = truncatePatch(huge);
  assert.ok(out.includes('bytes omitted'));
  // Output length = MAX_PATCH_BYTES_PER_FILE chars + marker.
  assert.ok(out.length < huge.length);
});

test('MAX_PATCH_BYTES_PER_FILE = 16 KiB', () => {
  assert.equal(MAX_PATCH_BYTES_PER_FILE, 16 * 1024);
});

// ---------------------------------------------------------------------------
// Wire contract: the prompt builder must not crash on minimum-valid inputs
// (the App's empty-skills / empty-diff edge cases hit production sooner or
// later).
// ---------------------------------------------------------------------------

test('buildReviewPrompt: minimum input (no skills, no files) does not throw', () => {
  const out = buildReviewPrompt({
    repo: { owner: 'o', name: 'r' },
    pr: { number: 1, baseRef: 'main', headRef: 'topic' },
    diff: DIFF_EMPTY,
    skills: [],
  });
  assert.ok(out.system);
  assert.ok(out.prompt);
});
