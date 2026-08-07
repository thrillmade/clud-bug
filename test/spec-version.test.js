// SPEC §4.3 / §7.1 / §7.3 conformance for what clud-bug DECLARES about the
// spec version. Covers clud-bug#277 (stale + disagreeing markers, wrong key
// name) and clud-bug#267 (`--version` does not implement §7.3).
//
// Quoted rules these assertions enforce, from `thrillmade/protocol` SPEC.md
// at origin/main:
//
//   §4.3 "`review-sha` MUST be the 40-character head SHA reviewed,
//        `written-by` the identity that posted the comment, and
//        `spec-version` the version of this document the producer
//        implements."
//   §7.1 "Every place the version appears MUST agree."
//   §7.3 "The first line's format is exactly `<tool-name> <tool-semver>
//        (spec <spec-semver>)`. A single trailing newline is REQUIRED."
//   §7.3 "The vocabulary is fixed — `orient`, `work`, `record`, `review`,
//        `propagate`, `gates`, `versioning`."

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import {
  SPEC_VERSION,
  SPEC_AREAS,
  SPEC_AREA_VOCABULARY,
  renderVersionDeclaration,
} from '../src/core/spec-version.js';
import { PROTOCOL_VERSION, renderReviewFile } from '../src/core/review-writeback.js';
import { NOTARY_PROTOCOL_VERSION, buildBundle } from '../src/core/notary-bundle.js';

const HEAD_SHA = 'a'.repeat(40);

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
  last_reviewed_sha: '0'.repeat(40),
};

// ---------------------------------------------------------------- §7.1

test('SPEC_VERSION is a semver matching the document header', () => {
  // The document itself carries `<!-- spec-version: 2.0.0 -->`.
  assert.match(SPEC_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(SPEC_VERSION, '2.0.0');
});

test('§7.1: both producers agree — one source, not two literals', () => {
  // The defect in #277 was precisely that these were '0.1.0' and '1.2.0'.
  assert.equal(PROTOCOL_VERSION, SPEC_VERSION);
  assert.equal(NOTARY_PROTOCOL_VERSION, SPEC_VERSION);
});

test('§7.1: the version the bundle stamps is the version the comment emits', () => {
  const bundle = buildBundle({
    repo: 'o/r', headSha: HEAD_SHA, verdict: 'clean',
    findings: [], coverage: [], recipeVersion: 'test',
  });
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 1, headSha: HEAD_SHA, prUrl: 'https://x',
  });
  assert.ok(md.includes(`<!-- spec-version: ${bundle.protocol_version} -->`));
});

// ---------------------------------------------------------------- §4.3

test('§4.3: the emitted marker key is `spec-version`, not `protocol-version`', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 42, headSha: HEAD_SHA, prUrl: 'https://x',
  });
  assert.ok(md.includes(`<!-- spec-version: ${SPEC_VERSION} -->`));
  // The old key must be gone entirely — a comment carrying both would let a
  // consumer keep reading the wrong one and never notice.
  assert.equal(md.includes('protocol-version'), false);
});

// ---------------------------------------------------------------- §7.3

test('§7.3: first line format is exactly `<tool> <ver> (spec <spec-ver>)`', () => {
  const out = renderVersionDeclaration({ toolName: 'clud-bug', toolVersion: '0.7.0' });
  const [first] = out.split('\n');
  assert.equal(first, `clud-bug 0.7.0 (spec ${SPEC_VERSION})`);
});

test('§7.3: a single trailing newline is REQUIRED', () => {
  const out = renderVersionDeclaration({ toolName: 'clud-bug', toolVersion: '0.7.0' });
  assert.ok(out.endsWith('\n'));
  assert.equal(out.endsWith('\n\n'), false);
  // Exactly two lines of content.
  assert.equal(out.split('\n').length, 3);
});

test('§7.3: the second line names areas', () => {
  const out = renderVersionDeclaration({ toolName: 'clud-bug', toolVersion: '0.7.0' });
  const second = out.split('\n')[1];
  assert.equal(second, `areas: ${SPEC_AREAS.join(', ')}`);
});

test('§7.3: every claimed area is in the fixed seven-word vocabulary', () => {
  assert.equal(SPEC_AREA_VOCABULARY.length, 7);
  for (const area of SPEC_AREAS) {
    assert.ok(
      SPEC_AREA_VOCABULARY.includes(area),
      `"${area}" is not one of the seven §7.3 area words`,
    );
  }
});

test('§0.4: clud-bug does not claim areas it does not implement', () => {
  // `record` is logmind's — clud-bug writes no decision record.
  assert.equal(SPEC_AREAS.includes('record'), false);
  // `versioning` — emitting this declaration satisfies §7.3, it does not
  // implement the area. §7.3's own example is a tool that emits the
  // declaration and claims `orient, record, gates`, not `versioning`.
  assert.equal(SPEC_AREAS.includes('versioning'), false);
});

test('§7.3: areas are unique and non-empty', () => {
  assert.ok(SPEC_AREAS.length > 0);
  assert.equal(new Set(SPEC_AREAS).size, SPEC_AREAS.length);
});
