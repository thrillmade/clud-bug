// Phase Z3 — the notary attestation bundle: assembly + the tolerant wire parser.
// The parser is a trust boundary (it reads an artifact the local agent produced),
// so the rejection cases matter: a malformed or truncated bundle must be `null`,
// never a partially-accepted "green".

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import {
  buildBundle,
  parseBundle,
  notaryResponseIsRejection,
  NOTARY_BUNDLE_VERSION,
  NOTARY_PROTOCOL_VERSION,
} from '../src/core/notary-bundle.js';

const SHA = 'a'.repeat(40);

test('buildBundle: stamps wire + protocol versions and omits absent optionals', () => {
  const b = buildBundle({
    repo: 'o/r', headSha: SHA, verdict: 'clean', findings: [], coverage: [], recipeVersion: 'local',
  });
  assert.equal(b.bundle_version, NOTARY_BUNDLE_VERSION);
  assert.equal(b.protocol_version, NOTARY_PROTOCOL_VERSION);
  assert.equal(b.repo, 'o/r');
  assert.equal('pr' in b, false);
  assert.equal('nonce' in b, false);
});

test('buildBundle: carries pr and nonce when provided', () => {
  const b = buildBundle({
    repo: 'o/r', pr: 7, headSha: SHA, verdict: 'clean', findings: [], coverage: ['a.ts'],
    recipeVersion: 'local', nonce: 'abc123',
  });
  assert.equal(b.pr, 7);
  assert.equal(b.nonce, 'abc123');
});

test('parseBundle: round-trips a built bundle', () => {
  const b = buildBundle({
    repo: 'o/r', pr: 7, headSha: SHA, verdict: 'critical',
    findings: [{ severity: 'critical', file: 'a.ts', line: 2, summary: 'x', grounding: 'y', grounding_kind: 'quote' }],
    coverage: ['a.ts'], recipeVersion: 'local',
  });
  const parsed = parseBundle(JSON.parse(JSON.stringify(b)));
  assert.deepEqual(parsed, b);
});

test('parseBundle: rejects a non-object', () => {
  assert.equal(parseBundle(null), null);
  assert.equal(parseBundle('nope'), null);
});

test('parseBundle: rejects a missing/!owner-repo `repo`', () => {
  assert.equal(parseBundle({ repo: 'noslash', head_sha: SHA, verdict: 'clean', findings: [], coverage: [] }), null);
});

test('parseBundle: rejects an unknown verdict (trust-boundary whitelist)', () => {
  assert.equal(parseBundle({ repo: 'o/r', head_sha: SHA, verdict: 'CLEAN', findings: [], coverage: [] }), null);
  assert.equal(parseBundle({ repo: 'o/r', head_sha: SHA, verdict: 'banana', findings: [], coverage: [] }), null);
  assert.equal(parseBundle({ repo: 'o/r', head_sha: SHA, verdict: 'clean ', findings: [], coverage: [] }), null);
});

test('parseBundle: accepts every legitimate verdict', () => {
  for (const v of ['clean', 'critical', 'failed', 'unverified']) {
    const b = parseBundle({ repo: 'o/r', head_sha: SHA, verdict: v, findings: [], coverage: [] });
    assert.ok(b, `verdict ${v} should parse`);
    assert.equal(b.verdict, v);
  }
});

test('notaryResponseIsRejection: 4xx is a terminal decline; 5xx/2xx are not', () => {
  for (const s of [400, 403, 409, 422, 499]) assert.equal(notaryResponseIsRejection(s), true, String(s));
  for (const s of [200, 500, 502, 503]) assert.equal(notaryResponseIsRejection(s), false, String(s));
});

test('parseBundle: rejects a missing head_sha / findings / coverage', () => {
  assert.equal(parseBundle({ repo: 'o/r', verdict: 'clean', findings: [], coverage: [] }), null);
  assert.equal(parseBundle({ repo: 'o/r', head_sha: SHA, verdict: 'clean', coverage: [] }), null);
  assert.equal(parseBundle({ repo: 'o/r', head_sha: SHA, verdict: 'clean', findings: [] }), null);
});

test('parseBundle: rejects the WHOLE bundle when any finding is malformed', () => {
  const raw = {
    repo: 'o/r', head_sha: SHA, verdict: 'critical', coverage: ['a.ts'],
    findings: [
      { severity: 'critical', file: 'a.ts', line: 2, summary: 'ok', grounding: 'y' },
      { severity: 'not-a-severity', summary: 'bad' }, // malformed
    ],
  };
  assert.equal(parseBundle(raw), null);
});

test('parseBundle: rejects non-string coverage entries', () => {
  const raw = { repo: 'o/r', head_sha: SHA, verdict: 'clean', findings: [], coverage: ['a.ts', 42] };
  assert.equal(parseBundle(raw), null);
});

test('parseBundle: drops an out-of-range line but keeps the finding', () => {
  const raw = {
    repo: 'o/r', head_sha: SHA, verdict: 'clean', coverage: [],
    findings: [{ severity: 'minor', file: 'a.ts', line: 0, summary: 'x' }],
  };
  const parsed = parseBundle(raw);
  assert.ok(parsed);
  assert.equal(parsed.findings.length, 1);
  assert.equal('line' in parsed.findings[0], false);
});

test('parseBundle: ignores an unknown grounding_kind (leaves it unset → defaults to quote)', () => {
  const raw = {
    repo: 'o/r', head_sha: SHA, verdict: 'critical', coverage: ['a.ts'],
    findings: [{ severity: 'critical', file: 'a.ts', line: 2, summary: 'x', grounding: 'y', grounding_kind: 'telepathy' }],
  };
  const parsed = parseBundle(raw);
  assert.ok(parsed);
  assert.equal('grounding_kind' in parsed.findings[0], false);
});
