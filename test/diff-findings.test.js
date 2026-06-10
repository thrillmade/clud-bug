// Tests for src/core/diff-findings.ts — SPEC §1.8.1 Resolved / Still-open
// block helpers. Covers:
//   - parsePriorReviewFile robustness (null, empty, malformed, well-formed)
//   - diffFindings split logic (null prior, empty current, identical, partial)
//   - findingIdentity stability across rounds
//   - severity-bucket change counts as resolved (different identity by design)

import { describe, expect, it } from 'vitest';

import {
  parsePriorReviewFile,
  diffFindings,
  findingIdentity,
} from '../src/core/diff-findings.js';
import {
  parsePriorReviewFile as barrelParse,
  diffFindings as barrelDiff,
  findingIdentity as barrelIdentity,
} from '../src/core/index.js';
import { renderReviewFile } from '../src/core/review-writeback.js';

// ---------------------------------------------------------------------------
// parsePriorReviewFile — robustness
// ---------------------------------------------------------------------------

describe('parsePriorReviewFile: robustness', () => {
  it('returns null on null input', () => {
    expect(parsePriorReviewFile(null)).toBeNull();
  });

  it('returns null on undefined input', () => {
    expect(parsePriorReviewFile(undefined)).toBeNull();
  });

  it('returns null on empty markdown', () => {
    expect(parsePriorReviewFile('')).toBeNull();
  });

  it('returns null on whitespace-only markdown', () => {
    expect(parsePriorReviewFile('   \n\n  \n')).toBeNull();
  });

  it('returns null on completely unrelated markdown (no severity sections)', () => {
    expect(
      parsePriorReviewFile('# Hello\n\nThis is not a review file.'),
    ).toBeNull();
  });

  it('drops malformed bullet lines silently (no throw, no spurious findings)', () => {
    // The "bullet" lines below are not valid SPEC §1.8.1 finding lines.
    const md = [
      '# clud-bug review — PR #1',
      '',
      '### \u{1F534} Critical',
      '- this is not a bullet',
      '- **no closing bold (missing)',
      '- ** ** — — empty',
      '',
    ].join('\n');
    expect(parsePriorReviewFile(md)).toBeNull();
  });

  it('parses a well-formed single-finding doc', () => {
    const md = [
      '# clud-bug review — PR #1',
      '<!-- protocol-version: 0.1.0 -->',
      '<!-- written-by: clud-bug[bot] -->',
      '<!-- review-sha: abc -->',
      '',
      '**Summary:** 1 critical · 0 minor · 0 preexisting · 0 resolved-from-prior · 0 still-open',
      '',
      '**Findings:**',
      '',
      '### \u{1F534} Critical',
      '- **src/auth.ts:42** — race-conditions: Race condition on token refresh',
      '  Reasoning: Two async calls can interleave.',
      '',
      '---',
      '',
      '[Link to PR](https://github.com/foo/bar/pull/1)',
    ].join('\n');
    const parsed = parsePriorReviewFile(md);
    expect(parsed).not.toBeNull();
    expect(parsed?.findings.length).toBe(1);
    expect(parsed?.findings[0]).toEqual({
      file: 'src/auth.ts',
      line: 42,
      severity: 'critical',
      skillName: 'race-conditions',
      summary: 'Race condition on token refresh',
    });
  });

  it('parses a multi-bucket doc with correct severity tagging', () => {
    const md = [
      '### \u{1F534} Critical',
      '- **a.ts:1** — race: A',
      '- **b.ts:2** — race: B',
      '',
      '### \u{1F7E1} Minor',
      '- **c.ts:3** — style: C',
      '',
      '### \u{1F7E3} Preexisting (informational)',
      '- **d.ts:4** — types: D',
      '',
    ].join('\n');
    const parsed = parsePriorReviewFile(md);
    expect(parsed?.findings.length).toBe(4);
    expect(parsed?.findings[0]?.severity).toBe('critical');
    expect(parsed?.findings[1]?.severity).toBe('critical');
    expect(parsed?.findings[2]?.severity).toBe('minor');
    expect(parsed?.findings[3]?.severity).toBe('preexisting');
  });

  it('accepts cross-cutting findings without :line anchor', () => {
    const md = [
      '### \u{1F534} Critical',
      '- **README.md** — docs: missing intro section',
      '',
    ].join('\n');
    const parsed = parsePriorReviewFile(md);
    expect(parsed?.findings.length).toBe(1);
    expect(parsed?.findings[0]?.file).toBe('README.md');
    expect(parsed?.findings[0]?.line).toBe(0);
  });

  it('accepts (unknown file) markers and preserves them verbatim', () => {
    const md = [
      '### \u{1F534} Critical',
      '- **(unknown file)** — race: cross-cutting',
      '',
    ].join('\n');
    const parsed = parsePriorReviewFile(md);
    expect(parsed?.findings[0]?.file).toBe('(unknown file)');
  });

  it('ignores Resolved / Still-open blocks (does not double-count history)', () => {
    const md = [
      '### \u{1F534} Critical',
      '- **a.ts:1** — race: A',
      '',
      '**Resolved this round:**',
      '- `b.ts:2` — `race`: B (was 🔴 Critical)',
      '',
      '**Still open:**',
      '- `c.ts:3` — `race`: C (was 🔴 Critical)',
      '',
    ].join('\n');
    const parsed = parsePriorReviewFile(md);
    // Only the in-bucket finding is captured; Resolved/Still-open
    // entries are skipped because they describe PRIOR rounds.
    expect(parsed?.findings.length).toBe(1);
    expect(parsed?.findings[0]?.file).toBe('a.ts');
  });

  it('parses multi-pass attribution prefix and strips it from the bullet', () => {
    const md = [
      '### \u{1F534} Critical',
      '- [Pass 1 — Beetle · sonnet] **a.ts:1** — race: A',
      '',
    ].join('\n');
    const parsed = parsePriorReviewFile(md);
    expect(parsed?.findings.length).toBe(1);
    expect(parsed?.findings[0]?.file).toBe('a.ts');
    expect(parsed?.findings[0]?.skillName).toBe('race');
    expect(parsed?.findings[0]?.summary).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// diffFindings — split logic
// ---------------------------------------------------------------------------

describe('diffFindings: split logic', () => {
  const priorWithThree = {
    findings: [
      { file: 'a.ts', line: 1, severity: 'critical', skillName: 'race', summary: 'A' },
      { file: 'b.ts', line: 2, severity: 'critical', skillName: 'race', summary: 'B' },
      { file: 'c.ts', line: 3, severity: 'minor', skillName: 'style', summary: 'C' },
    ],
  };

  it('null prior → no resolved, no still-open', () => {
    const result = diffFindings(null, {
      critical_findings: [
        { skill: 'race', file: 'a.ts', line: 1, summary: 'A' },
      ],
    });
    expect(result.resolvedFindings).toEqual([]);
    expect(result.stillOpenFindings).toEqual([]);
  });

  it('empty current → all prior become resolved', () => {
    const result = diffFindings(priorWithThree, {
      critical_findings: [],
      minor_findings: [],
      preexisting_findings: [],
    });
    expect(result.resolvedFindings.length).toBe(3);
    expect(result.stillOpenFindings).toEqual([]);
  });

  it('completely empty current (no arrays at all) → all prior become resolved', () => {
    const result = diffFindings(priorWithThree, {});
    expect(result.resolvedFindings.length).toBe(3);
    expect(result.stillOpenFindings).toEqual([]);
  });

  it('identical → no resolved, all still-open', () => {
    const result = diffFindings(priorWithThree, {
      critical_findings: [
        { skill: 'race', file: 'a.ts', line: 1, summary: 'A' },
        { skill: 'race', file: 'b.ts', line: 2, summary: 'B' },
      ],
      minor_findings: [{ skill: 'style', file: 'c.ts', line: 3, summary: 'C' }],
    });
    expect(result.resolvedFindings).toEqual([]);
    expect(result.stillOpenFindings.length).toBe(3);
  });

  it('partial overlap → correct split', () => {
    // a.ts:1 (resolved), b.ts:2 (still open), c.ts:3 (resolved)
    const result = diffFindings(priorWithThree, {
      critical_findings: [{ skill: 'race', file: 'b.ts', line: 2, summary: 'B' }],
    });
    expect(result.resolvedFindings.length).toBe(2);
    expect(result.stillOpenFindings.length).toBe(1);
    expect(result.stillOpenFindings[0]?.file).toBe('b.ts');
    // Prior-order preserved in resolved (a.ts before c.ts).
    expect(result.resolvedFindings[0]?.file).toBe('a.ts');
    expect(result.resolvedFindings[1]?.file).toBe('c.ts');
  });

  it('severity-bucket change (critical → minor on the same line) counts as resolved + new', () => {
    // Same file/line/skill/summary, severity changed → DIFFERENT identity.
    // This is by design: a downgrade is a fix (full credit) + a new
    // finding (the bot still has a concern). The renderer surfaces both
    // in their respective buckets.
    const prior = {
      findings: [
        {
          file: 'a.ts',
          line: 1,
          severity: 'critical',
          skillName: 'race',
          summary: 'A',
        },
      ],
    };
    const result = diffFindings(prior, {
      minor_findings: [{ skill: 'race', file: 'a.ts', line: 1, summary: 'A' }],
    });
    expect(result.resolvedFindings.length).toBe(1);
    expect(result.resolvedFindings[0]?.severity).toBe('critical');
    expect(result.stillOpenFindings).toEqual([]);
  });

  it('malformed prior markdown → parse returns null → diff is no-op', () => {
    const prior = parsePriorReviewFile('not a review');
    expect(prior).toBeNull();
    const result = diffFindings(prior, {
      critical_findings: [{ skill: 'race', file: 'a.ts', line: 1, summary: 'A' }],
    });
    expect(result.resolvedFindings).toEqual([]);
    expect(result.stillOpenFindings).toEqual([]);
  });

  it('cross-cutting (line=0) findings diff correctly', () => {
    const prior = {
      findings: [
        {
          file: 'README.md',
          line: 0,
          severity: 'critical',
          skillName: 'docs',
          summary: 'missing intro',
        },
      ],
    };
    const result = diffFindings(prior, {
      critical_findings: [
        // Same file, no line (omitted), same skill + summary → identical id.
        { skill: 'docs', file: 'README.md', summary: 'missing intro' },
      ],
    });
    expect(result.resolvedFindings).toEqual([]);
    expect(result.stillOpenFindings.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findingIdentity — stability
// ---------------------------------------------------------------------------

describe('findingIdentity: hash shape stability', () => {
  it('produces identical id for identical fields', () => {
    const a = {
      file: 'a.ts',
      line: 1,
      severity: /** @type {const} */ ('critical'),
      skillName: 'race',
      summary: 'Race condition on token refresh',
    };
    const b = { ...a };
    expect(findingIdentity(a)).toBe(findingIdentity(b));
  });

  it('produces different id when severity differs (downgrade is a different finding)', () => {
    const a = {
      file: 'a.ts',
      line: 1,
      severity: /** @type {const} */ ('critical'),
      skillName: 'race',
      summary: 'A',
    };
    const b = { ...a, severity: /** @type {const} */ ('minor') };
    expect(findingIdentity(a)).not.toBe(findingIdentity(b));
  });

  it('truncates summary at 100 chars for identity', () => {
    // Two summaries differing only past character 100 should hash to
    // the same id — absorbs minor wording drift between rounds.
    const baseHundred = 'x'.repeat(100);
    const a = {
      file: 'a.ts',
      line: 1,
      severity: /** @type {const} */ ('critical'),
      skillName: 'race',
      summary: `${baseHundred}-rest-A`,
    };
    const b = {
      file: 'a.ts',
      line: 1,
      severity: /** @type {const} */ ('critical'),
      skillName: 'race',
      summary: `${baseHundred}-rest-B`,
    };
    expect(findingIdentity(a)).toBe(findingIdentity(b));
  });
});

// ---------------------------------------------------------------------------
// barrel re-export equivalence
// ---------------------------------------------------------------------------

describe('barrel: clud-bug/core re-exports diff-findings helpers', () => {
  it('parsePriorReviewFile is the same identity', () => {
    expect(barrelParse).toBe(parsePriorReviewFile);
  });
  it('diffFindings is the same identity', () => {
    expect(barrelDiff).toBe(diffFindings);
  });
  it('findingIdentity is the same identity', () => {
    expect(barrelIdentity).toBe(findingIdentity);
  });
});

// ---------------------------------------------------------------------------
// Roundtrip: render → parse → diff (smoke test for parse against the
// renderer's actual output shape). Catches drift between the two halves
// if either is later changed in isolation.
// ---------------------------------------------------------------------------

describe('roundtrip: renderReviewFile output is parsable by parsePriorReviewFile', () => {
  it('renderReviewFile → parsePriorReviewFile recovers the same findings', () => {
    const md = renderReviewFile({
      review: {
        status_header: 'critical findings',
        summary_counts: {
          critical: 2, minor: 1, preexisting: 0, resolved_from_prior: 0, still_open: 0,
        },
        per_skill_scan: [],
        critical_findings: [
          { skill: 'race', file: 'a.ts', line: 1, summary: 'A' },
          { skill: 'race', file: 'b.ts', line: 2, summary: 'B' },
        ],
        minor_findings: [{ skill: 'style', file: 'c.ts', line: 3, summary: 'C' }],
        preexisting_findings: [],
        skills_referenced: ['race', 'style'],
        last_reviewed_sha: '0'.repeat(40),
      },
      prNumber: 1,
      headSha: '1'.repeat(40),
      prUrl: 'https://github.com/foo/bar/pull/1',
    });
    const parsed = parsePriorReviewFile(md);
    expect(parsed?.findings.length).toBe(3);
    expect(parsed?.findings.map((f) => f.file)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
