// Tests for src/core/benchmark-score.ts — the planted-defect scorer (#270,
// SPEC 2.0 §8.2).
//
// The four cases that decide whether a published number is honest: a miss, a
// false positive on a decoy, a decoy left alone, and a scenario that was
// never reviewed (SPEC §4.9: "A review cut short for cost is unverified,
// never clean").

import { describe, expect, it } from 'vitest';

import { scoreRun } from '../../src/core/benchmark-score.js';

const BUG = {
  id: 'b1-bug',
  class: 'emergent',
  severity: 'MAJOR',
  expected: 'finding',
  file: 'module.mjs',
  lineRange: [20, 30],
};

const BUG_CROSSCUTTING = {
  id: 'b2-crosscutting',
  class: 'cross-cutting',
  severity: 'MED-HIGH',
  expected: 'finding',
  file: 'module.mjs',
  lineRange: [40, 45],
  acceptAlso: [{ file: 'helper.mjs', lineRange: [10, 20] }],
};

const DECOY = {
  id: 'c1-clean',
  class: 'clean',
  severity: 'none',
  expected: 'clean',
  file: 'module.mjs',
  lineRange: [10, 40],
};

function review(id, findings, extra = {}) {
  return { id, review: { critical_findings: findings }, ...extra };
}

function verdictOf(score, id) {
  return score.scenarios.find((s) => s.id === id).verdict;
}

describe('scoreRun — planted defects', () => {
  it('counts a finding at the planted site as caught', () => {
    const score = scoreRun([review('b1-bug', [{ file: 'module.mjs', line: 24 }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('caught');
    expect(score.totals.caught).toBe(1);
    expect(score.totals.total).toBe(1);
    expect(score.totals.recallPct).toBe(100);
  });

  it('counts a finding somewhere else in the file as missed', () => {
    const score = scoreRun([review('b1-bug', [{ file: 'module.mjs', line: 90 }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
    expect(score.totals.caught).toBe(0);
    expect(score.totals.total).toBe(1);
    expect(score.totals.recallPct).toBe(0);
  });

  it('counts a clean review of a planted defect as missed', () => {
    const score = scoreRun([review('b1-bug', [])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
    expect(score.totals.caught).toBe(0);
  });

  it('does not accept a minor-severity note as a catch', () => {
    const score = scoreRun(
      [{ id: 'b1-bug', review: { critical_findings: [], minor_findings: [{ file: 'module.mjs', line: 24 }] } }],
      [BUG],
    );
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
  });

  it('accepts either site of a cross-cutting defect', () => {
    const atCaller = scoreRun([review('b2-crosscutting', [{ file: 'module.mjs', line: 42 }])], [BUG_CROSSCUTTING]);
    const atHelper = scoreRun([review('b2-crosscutting', [{ file: 'helper.mjs', line: 14 }])], [BUG_CROSSCUTTING]);
    expect(verdictOf(atCaller, 'b2-crosscutting')).toBe('caught');
    expect(verdictOf(atHelper, 'b2-crosscutting')).toBe('caught');
  });

  it('accepts a file-level finding that names the right file without a line', () => {
    const score = scoreRun([review('b1-bug', [{ file: 'module.mjs' }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('caught');
  });

  it('accepts a repo-relative path for the scenario file', () => {
    const score = scoreRun(
      [review('b1-bug', [{ file: 'benchmark/scenarios/b1-bug/module.mjs', line: 24 }])],
      [BUG],
    );
    expect(verdictOf(score, 'b1-bug')).toBe('caught');
  });
});

describe('scoreRun — a finding the scorer cannot place', () => {
  // The schema permits a critical finding with no `file` ("Optional when the
  // finding is cross-cutting"), and five of the twenty committed scenarios are
  // cross-cutting. Such a finding is read for the site instead: its own text
  // either names the planted file or it does not, and that is the whole
  // question. Scoring it `unverified` lost a genuine catch and reported the
  // scenario as unscored when it had been scored and answered.
  it('credits a file-less finding whose own text names the planted site', () => {
    const score = scoreRun(
      [
        review('b1-bug', [
          {
            summary: 'serializeEntries in module.mjs writes entry content verbatim, forging a delimiter',
            reasoning: 'the marker is not escaped',
            grounding: 'module.mjs',
          },
        ]),
      ],
      [BUG],
    );
    expect(verdictOf(score, 'b1-bug')).toBe('caught');
    expect(score.totals.caught).toBe(1);
    expect(score.totals.total).toBe(1);
  });

  it('credits a file-less finding that names the second site of a cross-cutting defect', () => {
    const score = scoreRun(
      [review('b2-crosscutting', [{ summary: 'the cause is in helper.mjs, which the diff only exposes' }])],
      [BUG_CROSSCUTTING],
    );
    expect(verdictOf(score, 'b2-crosscutting')).toBe('caught');
  });

  it('counts a file-less finding that names no site at all as missed, never unverified', () => {
    const score = scoreRun([review('b1-bug', [{ summary: 'something is wrong somewhere' }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
    // In both terms: the reviewer was asked and did not report the defect.
    expect(score.totals.caught).toBe(0);
    expect(score.totals.total).toBe(1);
    expect(score.totals.unverified).toBe(0);
  });

  it('does not credit a file-less finding whose text names some other file', () => {
    const score = scoreRun([review('b1-bug', [{ summary: 'other.mjs looks wrong to me' }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
  });

  it('does not credit a file-less finding whose text only contains the site name as a substring', () => {
    // `presort.mjs` contains `sort.mjs` as a suffix but is a different file —
    // crediting the substring would let a decoy's neighbor name the planted
    // site by accident, which is exactly the false LOCATED the header rule
    // ("a catch must be LOCATED at the planted site") forbids.
    const site = { ...BUG, file: 'sort.mjs' };
    const score = scoreRun([review('b1-bug', [{ summary: 'presort.mjs looks suspicious' }])], [site]);
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
  });

  it('credits a file-less finding that names the site as a whole path token', () => {
    const site = { ...BUG, file: 'sort.mjs' };
    const score = scoreRun([review('b1-bug', [{ summary: 'the bug is in sort.mjs, on the merge step' }])], [site]);
    expect(verdictOf(score, 'b1-bug')).toBe('caught');
  });

  it('counts a finding whose line is not a line number as missed, never caught', () => {
    // `line: "24"` names the right file and a line the scorer cannot compare.
    // Treating it as the schema's absent-line case made the file match alone
    // a catch, which is how an unvalidated payload scored itself right. The
    // `file` field is not read as text for the same reason.
    const score = scoreRun([review('b1-bug', [{ file: 'module.mjs', line: '24' }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
    // Control: the same finding with a real line number is a catch, so the
    // verdict is the line's type and not the fixture.
    expect(verdictOf(scoreRun([review('b1-bug', [{ file: 'module.mjs', line: 24 }])], [BUG]), 'b1-bug')).toBe(
      'caught',
    );
  });

  it('survives a findings array carrying something that is not a finding', () => {
    // The fenced-`result` branch is whatever the model typed, so the scorer
    // owns the per-finding shape question rather than the runner voiding the
    // whole payload over one entry.
    const score = scoreRun([review('b1-bug', [null, 'nonsense', { file: 'module.mjs', line: 24 }])], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('caught');
  });

  it('still counts a located finding elsewhere in the file as a miss', () => {
    // Only a reviewer that placed nothing at all is unscoreable. One that
    // placed a finding and got the site wrong was read and was wrong.
    const score = scoreRun(
      [review('b1-bug', [{ file: 'module.mjs', line: 90 }, { summary: 'and something else' }])],
      [BUG],
    );
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
  });

  it('counts a file-less finding on a decoy as the false flag it would be', () => {
    // A 🔴 with no file still blocks the merge, and the decoy is correct code
    // everywhere — there is no site where flagging it is right, so nothing
    // about the location is in question here.
    const score = scoreRun([review('c1-clean', [{ summary: 'cross-cutting worry' }])], [DECOY]);
    expect(verdictOf(score, 'c1-clean')).toBe('false-positive');
    expect(score.totals.falsePositives).toBe(1);
  });
});

describe('scoreRun — clean decoys', () => {
  it('counts a critical finding on a decoy as a false positive', () => {
    const score = scoreRun([review('c1-clean', [{ file: 'module.mjs', line: 12 }])], [DECOY]);
    expect(verdictOf(score, 'c1-clean')).toBe('false-positive');
    expect(score.totals.falsePositives).toBe(1);
    expect(score.totals.decoysClean).toBe(0);
    expect(score.totals.decoysTotal).toBe(1);
  });

  it('counts a critical finding anywhere in a decoy as a false positive', () => {
    // The whole scenario is correct code — a flag off the decoy's own lines
    // is still a flag on code that has no defect.
    const score = scoreRun([review('c1-clean', [{ file: 'other.mjs', line: 3 }])], [DECOY]);
    expect(verdictOf(score, 'c1-clean')).toBe('false-positive');
  });

  it('counts a decoy left alone as clean', () => {
    const score = scoreRun([review('c1-clean', [])], [DECOY]);
    expect(verdictOf(score, 'c1-clean')).toBe('caught');
    expect(score.totals.decoysClean).toBe(1);
    expect(score.totals.falsePositives).toBe(0);
  });
});

describe('scoreRun — unverified', () => {
  it('reports a scenario stopped for cost as unverified, never clean', () => {
    const score = scoreRun(
      [
        review('b1-bug', [{ file: 'module.mjs', line: 24 }]),
        { id: 'c1-clean', review: null, unverifiedReason: 'cost cap reached' },
      ],
      [BUG, DECOY],
    );
    expect(verdictOf(score, 'c1-clean')).toBe('unverified');
    expect(score.scenarios.find((s) => s.id === 'c1-clean').note).toBe('cost cap reached');
    expect(score.totals.decoysClean).toBe(0);
    expect(score.totals.decoysTotal).toBe(0);
    expect(score.totals.unverified).toBe(1);
  });

  it('keeps an unverified planted defect out of both recall terms', () => {
    const score = scoreRun(
      [
        review('b1-bug', [{ file: 'module.mjs', line: 24 }]),
        { id: 'b2-crosscutting', review: null, unverifiedReason: 'cost cap reached' },
      ],
      [BUG, BUG_CROSSCUTTING],
    );
    expect(score.totals.caught).toBe(1);
    expect(score.totals.total).toBe(1);
    expect(score.totals.recallPct).toBe(100);
    expect(score.totals.unverified).toBe(1);
  });

  it('reports a scenario with no review at all as unverified', () => {
    const score = scoreRun([], [BUG]);
    expect(verdictOf(score, 'b1-bug')).toBe('unverified');
    expect(score.totals.total).toBe(0);
    expect(score.totals.unverified).toBe(1);
  });
});

describe('scoreRun — several reviewers per scenario', () => {
  it('needs every reviewer to catch it', () => {
    const score = scoreRun(
      [
        review('b1-bug', [{ file: 'module.mjs', line: 24 }]),
        review('b1-bug', []),
      ],
      [BUG],
    );
    expect(verdictOf(score, 'b1-bug')).toBe('missed');
    expect(score.scenarios.find((s) => s.id === 'b1-bug').reviews).toBe(2);
  });

  it('takes one reviewer flagging a decoy as a false positive', () => {
    const score = scoreRun(
      [review('c1-clean', []), review('c1-clean', [{ file: 'module.mjs', line: 12 }])],
      [DECOY],
    );
    expect(verdictOf(score, 'c1-clean')).toBe('false-positive');
  });
});

describe('scoreRun — totals', () => {
  it('computes recall and precision over the verified scenarios', () => {
    const score = scoreRun(
      [
        review('b1-bug', [{ file: 'module.mjs', line: 24 }]),
        review('b2-crosscutting', []),
        review('c1-clean', [{ file: 'module.mjs', line: 12 }]),
      ],
      [BUG, BUG_CROSSCUTTING, DECOY],
    );
    expect(score.totals).toEqual({
      caught: 1,
      total: 2,
      decoysClean: 0,
      decoysTotal: 1,
      falsePositives: 1,
      unverified: 0,
      recallPct: 50,
      precisionPct: 50,
    });
  });

  it('rounds a repeating percentage to one decimal', () => {
    const keys = [BUG, BUG_CROSSCUTTING, { ...BUG, id: 'b3-bug' }];
    const score = scoreRun(
      [
        review('b1-bug', [{ file: 'module.mjs', line: 24 }]),
        review('b2-crosscutting', []),
        review('b3-bug', []),
      ],
      keys,
    );
    expect(score.totals.recallPct).toBe(33.3);
  });

  it('reports 0% precision when nothing was flagged at all', () => {
    const score = scoreRun([review('b1-bug', []), review('c1-clean', [])], [BUG, DECOY]);
    expect(score.totals.precisionPct).toBe(0);
  });
});
