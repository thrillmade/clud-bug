// Phase ZP3 — `clud-bug build-bundle`: the ReviewData → NotaryBundle transform.
//
// The self-hosted Action routes its review through the notary by transforming
// the review's structured_output (ReviewData) into an attestation bundle. These
// tests pin the pure transform: the finding buckets flatten 1:1, the verdict is
// DERIVED from the actual critical count (not the model's self-reported
// summary_counts — matching validateConsistency), and coverage passes through.

import { describe, expect, it } from 'vitest';

import { reviewDataToBundle } from '../src/cli/build-bundle.js';
import { NOTARY_BUNDLE_VERSION, NOTARY_PROTOCOL_VERSION, validateConsistency } from '../src/core/index.js';

const SHA = 'deadbeefcafefeed0000';
const meta = { repo: 'o/r', pr: 7, headSha: SHA, recipeVersion: 'ci-0.0.0', coverage: ['a.ts', 'b.ts'] };

describe('reviewDataToBundle', () => {
  it('derives verdict=critical from a non-empty critical bucket (not summary_counts)', () => {
    const data = {
      // Deliberately LIE in summary_counts to prove the verdict ignores it.
      summary_counts: { critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0 },
      critical_findings: [{ skill: 'critical-issues-only', summary: 'off-by-one', file: 'a.ts', line: 4, grounding: 'i <= n', grounding_kind: 'quote' }],
      minor_findings: [],
      preexisting_findings: [],
    };
    const b = reviewDataToBundle(data, meta);
    expect(b.verdict).toBe('critical');
    // The bundle it produces never trips the notary's own consistency check.
    expect(validateConsistency(b.verdict, b.findings).ok).toBe(true);
  });

  it('derives verdict=clean when the critical bucket is empty (even if counts claim otherwise)', () => {
    const data = {
      summary_counts: { critical: 9, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0 },
      critical_findings: [],
      minor_findings: [{ skill: 's', summary: 'nit' }],
      preexisting_findings: [],
    };
    const b = reviewDataToBundle(data, meta);
    expect(b.verdict).toBe('clean');
    expect(validateConsistency(b.verdict, b.findings).ok).toBe(true);
  });

  it('flattens all three buckets to NotaryFinding[] with 1:1 severity names', () => {
    const data = {
      critical_findings: [{ skill: 's', summary: 'c1', file: 'a.ts', line: 1 }],
      minor_findings: [{ skill: 's', summary: 'm1' }, { skill: 's', summary: 'm2' }],
      preexisting_findings: [{ skill: 's', summary: 'p1' }],
    };
    const b = reviewDataToBundle(data, meta);
    expect(b.findings.map((f) => f.severity)).toEqual(['critical', 'minor', 'minor', 'preexisting']);
    expect(b.findings[0]).toMatchObject({ severity: 'critical', summary: 'c1', file: 'a.ts', line: 1 });
  });

  it('skips null/non-object finding entries (and a non-array bucket) instead of crashing', () => {
    const data = {
      // Malformed / truncated structured_output: null, a number, a non-array bucket.
      critical_findings: [null, { skill: 's', summary: 'real' }, 42],
      minor_findings: [undefined],
      preexisting_findings: 'not-an-array',
    };
    const b = reviewDataToBundle(data, meta); // must NOT throw
    expect(b.findings).toHaveLength(1);
    expect(b.findings[0]).toMatchObject({ severity: 'critical', summary: 'real' });
    expect(b.verdict).toBe('critical');
  });

  it('carries grounding + grounding_kind through onto critical findings', () => {
    const data = {
      critical_findings: [
        { skill: 's', summary: 'c', grounding: 'const x = y', grounding_kind: 'quote' },
      ],
      minor_findings: [],
      preexisting_findings: [],
    };
    const b = reviewDataToBundle(data, meta);
    expect(b.findings[0].grounding).toBe('const x = y');
    expect(b.findings[0].grounding_kind).toBe('quote');
  });

  it('sets coverage from meta (the caller passes GitHub ground-truth changed files), not the findings', () => {
    const b = reviewDataToBundle({ critical_findings: [], minor_findings: [], preexisting_findings: [] }, meta);
    expect(b.coverage).toEqual(['a.ts', 'b.ts']);
    expect(Array.isArray(b.coverage)).toBe(true);
  });

  it('stamps repo/pr/head_sha/recipe + the wire & protocol versions', () => {
    const b = reviewDataToBundle({ critical_findings: [], minor_findings: [], preexisting_findings: [] }, meta);
    expect(b).toMatchObject({
      repo: 'o/r',
      pr: 7,
      head_sha: SHA,
      recipe_version: 'ci-0.0.0',
      bundle_version: NOTARY_BUNDLE_VERSION,
      protocol_version: NOTARY_PROTOCOL_VERSION,
    });
  });

  it('tolerates missing finding buckets (degrades to empty, verdict=clean)', () => {
    const b = reviewDataToBundle({}, meta);
    expect(b.findings).toEqual([]);
    expect(b.verdict).toBe('clean');
  });
});
