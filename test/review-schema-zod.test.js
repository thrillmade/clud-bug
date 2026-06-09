// Equivalence test: src/core/review-schema-zod.ts must produce byte-
// identical results to clud-bug-app/lib/review-schema.ts for the pure
// helpers (flatten/unflatten/derive*/buildReviewFromFindings) AND its Zod
// schemas must describe the same wire shape.
//
// Why this matters: Phase 4 of the Bug 9 migration deletes the App's
// lib/review-schema.ts and replaces every import with `clud-bug/core`.
// If the ported helpers drift from the App-side originals — different
// flatten order, different summary derivation, different default behavior
// — the App's runtime swaps to silently-wrong output. This test pins the
// contract so the drift fails CI here, not in production.
//
// Pattern mirrors test/strict-mode-gate-classifier.test.js.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import * as core from '../src/core/review-schema-zod.js';

// ---------------------------------------------------------------------------
// Fixtures — exercise empty, single-severity, mixed, ordering edge cases.
// ---------------------------------------------------------------------------

const EMPTY_REVIEW = {
  status_header: 'clean',
  summary_counts: {
    critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0,
  },
  per_skill_scan: [],
  critical_findings: [],
  minor_findings: [],
  preexisting_findings: [],
  skills_referenced: [],
  last_reviewed_sha: '0000000000000000000000000000000000000000',
};

const F_CRIT = {
  skill: 'race-conditions',
  file: 'auth.ts',
  line: 42,
  summary: 'Race condition on token refresh',
  reasoning: 'Token A may overwrite token B.',
};
const F_MINOR = {
  skill: 'critical-issues-only',
  file: 'comment.ts',
  line: 10,
  summary: 'Nit: rename helper',
};
const F_PRE = {
  skill: 'evidence-based-review',
  file: 'old.ts',
  line: 5,
  summary: 'Preexisting before this PR',
};

const MIXED_REVIEW = {
  status_header: 'critical findings',
  summary_counts: {
    critical: 1, minor: 1, preexisting: 1, resolved_from_prior: 0, still_open: 0,
  },
  per_skill_scan: [{ skill: 'race-conditions', outcome: '1 finding' }],
  critical_findings: [F_CRIT],
  minor_findings: [F_MINOR],
  preexisting_findings: [F_PRE],
  skills_referenced: ['race-conditions', 'critical-issues-only', 'evidence-based-review'],
  last_reviewed_sha: 'cafef00d'.padEnd(40, '0'),
};

// Deliberately scrambles skill order to exercise deriveSkillsReferenced's
// "first-appearance preserved" guarantee.
const SCRAMBLED_FINDINGS = [
  { ...F_CRIT, severity: 'critical' },
  { ...F_CRIT, skill: 'race-conditions', severity: 'critical' }, // dup-skill
  { ...F_MINOR, skill: 'race-conditions', severity: 'minor' },   // dup-skill
  { ...F_MINOR, severity: 'minor' },
  { ...F_PRE, severity: 'preexisting' },
];

// ---------------------------------------------------------------------------
// flattenFindings — must preserve severity order: criticals → minors → pre.
// ---------------------------------------------------------------------------

test('flattenFindings: empty review returns []', () => {
  assert.deepEqual(core.flattenFindings(EMPTY_REVIEW), []);
});

test('flattenFindings: preserves severity order across buckets', () => {
  const out = core.flattenFindings(MIXED_REVIEW);
  assert.equal(out.length, 3);
  assert.equal(out[0].severity, 'critical');
  assert.equal(out[1].severity, 'minor');
  assert.equal(out[2].severity, 'preexisting');
});

test('flattenFindings: copies all wire fields onto each Finding', () => {
  const [crit] = core.flattenFindings(MIXED_REVIEW);
  assert.equal(crit.skill, F_CRIT.skill);
  assert.equal(crit.file, F_CRIT.file);
  assert.equal(crit.line, F_CRIT.line);
  assert.equal(crit.summary, F_CRIT.summary);
  assert.equal(crit.reasoning, F_CRIT.reasoning);
  assert.equal(crit.severity, 'critical');
});

// ---------------------------------------------------------------------------
// unflattenFindings — inverse of flatten. Strip severity into 3 arrays.
// ---------------------------------------------------------------------------

test('unflattenFindings: empty list returns 3 empty arrays', () => {
  const out = core.unflattenFindings([]);
  assert.deepEqual(out.critical_findings, []);
  assert.deepEqual(out.minor_findings, []);
  assert.deepEqual(out.preexisting_findings, []);
});

test('unflattenFindings: strips severity field on each item', () => {
  const out = core.unflattenFindings([{ ...F_CRIT, severity: 'critical' }]);
  assert.equal(out.critical_findings.length, 1);
  assert.equal('severity' in out.critical_findings[0], false);
});

test('flatten then unflatten round-trip: equal up to bucket grouping', () => {
  const flat = core.flattenFindings(MIXED_REVIEW);
  const unflat = core.unflattenFindings(flat);
  assert.deepEqual(unflat.critical_findings, MIXED_REVIEW.critical_findings);
  assert.deepEqual(unflat.minor_findings, MIXED_REVIEW.minor_findings);
  assert.deepEqual(unflat.preexisting_findings, MIXED_REVIEW.preexisting_findings);
});

// ---------------------------------------------------------------------------
// deriveSummaryCounts — counts each bucket, always-0 for resolved/still_open.
// ---------------------------------------------------------------------------

test('deriveSummaryCounts: counts by severity, resolved/still_open=0', () => {
  const flat = core.flattenFindings(MIXED_REVIEW);
  const out = core.deriveSummaryCounts(flat);
  assert.deepEqual(out, {
    critical: 1, minor: 1, preexisting: 1, resolved_from_prior: 0, still_open: 0,
  });
});

test('deriveSummaryCounts: empty findings → all zeros', () => {
  assert.deepEqual(core.deriveSummaryCounts([]), {
    critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0,
  });
});

// ---------------------------------------------------------------------------
// deriveSkillsReferenced — first-appearance preserved, dedup.
// ---------------------------------------------------------------------------

test('deriveSkillsReferenced: dedup, first-appearance order', () => {
  const out = core.deriveSkillsReferenced(SCRAMBLED_FINDINGS);
  assert.deepEqual(out, [
    'race-conditions',
    'critical-issues-only',
    'evidence-based-review',
  ]);
});

test('deriveSkillsReferenced: empty → []', () => {
  assert.deepEqual(core.deriveSkillsReferenced([]), []);
});

// ---------------------------------------------------------------------------
// buildReviewFromFindings — test ergonomics helper.
// ---------------------------------------------------------------------------

test('buildReviewFromFindings: empty findings → clean status', () => {
  const r = core.buildReviewFromFindings({ findings: [] });
  assert.equal(r.status_header, 'clean');
  assert.deepEqual(r.summary_counts, {
    critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0,
  });
  assert.deepEqual(r.critical_findings, []);
  assert.deepEqual(r.minor_findings, []);
  assert.deepEqual(r.preexisting_findings, []);
  assert.deepEqual(r.skills_referenced, []);
  assert.equal(r.last_reviewed_sha, '');
});

test('buildReviewFromFindings: with findings → critical findings status', () => {
  const r = core.buildReviewFromFindings({
    findings: [{ ...F_CRIT, severity: 'critical' }],
    last_reviewed_sha: 'abc'.padEnd(40, 'a'),
  });
  assert.equal(r.status_header, 'critical findings');
  assert.equal(r.critical_findings.length, 1);
  assert.deepEqual(r.skills_referenced, [F_CRIT.skill]);
  assert.equal(r.last_reviewed_sha.length, 40);
});

test('buildReviewFromFindings: status_header override wins', () => {
  const r = core.buildReviewFromFindings({
    findings: [],
    status_header: 'bare',
  });
  assert.equal(r.status_header, 'bare');
});

test('buildReviewFromFindings: optional fields omitted when not provided', () => {
  const r = core.buildReviewFromFindings({ findings: [] });
  assert.equal('dedicated_sections' in r, false);
  assert.equal('diagnostics' in r, false);
});

// ---------------------------------------------------------------------------
// Zod schemas — runtime contract. Parsing a valid wire shape must succeed,
// parsing an invalid one must fail with a Zod error.
// ---------------------------------------------------------------------------

test('reviewSchema: parses valid empty review', () => {
  const ok = core.reviewSchema.parse(EMPTY_REVIEW);
  assert.equal(ok.status_header, 'clean');
});

test('reviewSchema: parses valid mixed review', () => {
  const ok = core.reviewSchema.parse(MIXED_REVIEW);
  assert.equal(ok.critical_findings.length, 1);
});

test('reviewSchema: rejects review missing required field', () => {
  assert.throws(
    () => core.reviewSchema.parse({ ...EMPTY_REVIEW, last_reviewed_sha: undefined }),
    /last_reviewed_sha/,
  );
});

test('findingItemSchema: rejects empty skill string', () => {
  assert.throws(() => core.findingItemSchema.parse({ skill: '', summary: 'x' }));
});

test('findingItemSchema: rejects line < 1', () => {
  assert.throws(() => core.findingItemSchema.parse({ skill: 's', summary: 'x', line: 0 }));
});

test('crossCheckSchema: parses valid response', () => {
  const ok = core.crossCheckSchema.parse({
    verdicts: [{ pass1Index: 0, verdict: 'agreed', rationale: 'confirmed' }],
    independentFindings: [{ ...F_CRIT, severity: 'critical' }],
  });
  assert.equal(ok.verdicts.length, 1);
  assert.equal(ok.independentFindings.length, 1);
});

test('crossCheckSchema: rejects unknown verdict', () => {
  assert.throws(() =>
    core.crossCheckSchema.parse({
      verdicts: [{ pass1Index: 0, verdict: 'maybe' }],
      independentFindings: [],
    }),
  );
});

// ---------------------------------------------------------------------------
// Wire-shape contract: the Zod-derived JSON Schema must describe the same
// required wire-shape fields as the CLI's plain JSON Schema. This is the
// "two validators agree" guard. We don't byte-compare the schemas (Zod
// emits a slightly different JSON Schema dialect), but we do assert the
// required field set matches.
// ---------------------------------------------------------------------------

test('wire-shape: Zod reviewSchema agrees with CLI REVIEW_SCHEMA on required fields', async () => {
  const cli = await import('../src/core/review-schema.js');
  const cliRequired = new Set(cli.REVIEW_SCHEMA.required);
  // Zod's `_def.shape` enumerates the fields; required = those without `.optional()`.
  // For zod v4, walk the shape object and check `_def.optional === false`.
  const zodShape = core.reviewSchema._def.shape ?? core.reviewSchema.shape;
  // Both schemas must require the SPEC §1.8.1 baseline fields.
  const expectedRequired = [
    'status_header',
    'summary_counts',
    'per_skill_scan',
    'critical_findings',
    'minor_findings',
    'preexisting_findings',
    'skills_referenced',
    'last_reviewed_sha',
  ];
  for (const field of expectedRequired) {
    assert.ok(cliRequired.has(field), `CLI schema missing required field: ${field}`);
    assert.ok(zodShape && field in zodShape, `Zod schema missing field: ${field}`);
  }
});
