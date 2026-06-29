// Tests for src/core/multi-pass-aggregate.ts — ported from clud-bug-app's
// test/multi-pass-aggregator.test.ts. Behavior pinned identically; only the
// import paths differ (`Finding`/`Review`/`buildReviewFromFindings` come from
// core's review-schema-zod; the result types live in review-writeback and are
// not imported by the JS test). Every assertion is preserved.

import { describe, expect, it } from 'vitest';

import {
  aggregatePasses,
  deriveConsensus,
  resolveVerdict,
  shouldEscalate,
} from '../../src/core/multi-pass-aggregate.js';
import { buildReviewFromFindings } from '../../src/core/review-schema-zod.js';

// Tests focus on:
//   - cross-check: pass-1 verdicts attach as additional attributions; independent findings append
//   - consensus: tuple-key matching (file, line, skill) detects "same" findings; intersection labeled `agreed`
//   - independent: no merging — every pass's findings appear in order with provenance
//   - verdict resolution rules per mode (strict / consensus / independent)
//   - summary counts + skills_referenced derived from aggregated findings
//   - severity promotion in consensus (e.g. minor → critical when later pass disagrees on severity)

const ROLE_BEETLE = {
  name: 'Beetle',
  model: 'anthropic/claude-sonnet-4.6',
};
const ROLE_WASP = {
  name: 'Wasp',
  model: 'anthropic/claude-opus-4.7',
};
const ROLE_MANTIS = {
  name: 'Mantis',
  model: 'anthropic/claude-opus-4.7',
};

function f(severity, skill, file, line, summary, reasoning) {
  return { severity, skill, file, line, summary, reasoning };
}

function emptyReview() {
  return buildReviewFromFindings({ findings: [], status_header: 'clean' });
}

function reviewWith(findings) {
  return buildReviewFromFindings({ findings, status_header: 'clean' });
}

// ---------------------------------------------------------------------------
// Cross-check mode
// ---------------------------------------------------------------------------

describe('aggregatePasses — cross-check', () => {
  it('attaches Pass 2 verdicts to Pass 1 findings, appends independent findings', () => {
    const pass1 = reviewWith([
      f('critical', 'race-conditions', 'auth.ts', 42, 'Race condition'),
      f('minor', 'magic-numbers', 'utils.ts', 18, 'Magic number 7'),
    ]);
    const pass2CC = {
      verdicts: [
        { pass1Index: 0, verdict: 'agreed' },
        {
          pass1Index: 1,
          verdict: 'disagreed',
          rationale: 'constant is documented above',
        },
      ],
      independentFindings: [
        f('critical', 'secrets', 'auth.ts', 67, 'Token logged'),
      ],
    };

    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, crossCheck: pass2CC },
      ],
    });

    expect(agg.findings).toHaveLength(3);

    // Pass 1 findings — Pass 1 attribution + Pass 2 verdict attribution.
    const race = agg.findings[0];
    expect(race.summary).toBe('Race condition');
    expect(race.attributions).toHaveLength(2);
    expect(race.attributions[0]).toMatchObject({
      passNumber: 1,
      roleName: 'Beetle',
      source: 'first',
    });
    expect(race.attributions[1]).toMatchObject({
      passNumber: 2,
      roleName: 'Wasp',
      source: 'agreed',
    });

    const magic = agg.findings[1];
    expect(magic.attributions[1]).toMatchObject({
      source: 'disagreed',
      note: 'constant is documented above',
    });

    // Independent finding — only Pass 2 attribution.
    const indep = agg.findings[2];
    expect(indep.summary).toBe('Token logged');
    expect(indep.attributions).toHaveLength(1);
    expect(indep.attributions[0]).toMatchObject({
      passNumber: 2,
      source: 'independent',
    });

    expect(agg.passCount).toBe(2);
    expect(agg.mode).toBe('cross-check');
    expect(agg.roles).toEqual([
      { passNumber: 1, roleName: 'Beetle', model: ROLE_BEETLE.model },
      { passNumber: 2, roleName: 'Wasp', model: ROLE_WASP.model },
    ]);
  });

  it('ignores out-of-range pass1Index without crashing', () => {
    const pass1 = reviewWith([f('critical', 's', 'a.ts', 1, 'A')]);
    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        {
          passNumber: 2,
          role: ROLE_WASP,
          crossCheck: {
            verdicts: [{ pass1Index: 99, verdict: 'agreed' }],
            independentFindings: [],
          },
        },
      ],
    });
    expect(agg.findings).toHaveLength(1);
    expect(agg.findings[0]?.attributions).toHaveLength(1);
  });

  it('handles 3 passes — both Pass 2 and Pass 3 attach verdicts to Pass 1', () => {
    const pass1 = reviewWith([f('critical', 's', 'a.ts', 1, 'A')]);
    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        {
          passNumber: 2,
          role: ROLE_WASP,
          crossCheck: {
            verdicts: [{ pass1Index: 0, verdict: 'agreed' }],
            independentFindings: [],
          },
        },
        {
          passNumber: 3,
          role: ROLE_MANTIS,
          crossCheck: {
            verdicts: [
              { pass1Index: 0, verdict: 'disagreed', rationale: 'on second look' },
            ],
            independentFindings: [],
          },
        },
      ],
    });
    expect(agg.findings[0]?.attributions).toHaveLength(3);
    expect(agg.findings[0]?.attributions[1]?.source).toBe('agreed');
    expect(agg.findings[0]?.attributions[2]?.source).toBe('disagreed');
    expect(agg.passCount).toBe(3);
  });

  it('skips subsequent passes with missing crossCheck data', () => {
    const pass1 = reviewWith([f('critical', 's', 'a.ts', 1, 'A')]);
    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [{ passNumber: 2, role: ROLE_WASP }],
    });
    expect(agg.findings).toHaveLength(1);
    // Pass 1 attribution only.
    expect(agg.findings[0]?.attributions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Consensus mode
// ---------------------------------------------------------------------------

describe('aggregatePasses — consensus', () => {
  it('detects same (file, line, skill) tuples and labels them agreed', () => {
    const pass1 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'Race condition'),
      f('minor', 'naming', 'utils.ts', 5, 'Bad name'),
    ]);
    const pass2 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'A race here'), // same tuple
      f('critical', 'secrets', 'auth.ts', 67, 'Token logged'), // new tuple
    ]);

    const agg = aggregatePasses({
      mode: 'consensus',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
      ],
    });

    expect(agg.findings).toHaveLength(3);
    // Pass 1's first finding now has Pass 2 attribution as `agreed`.
    expect(agg.findings[0]?.attributions).toHaveLength(2);
    expect(agg.findings[0]?.attributions[1]).toMatchObject({
      source: 'agreed',
      passNumber: 2,
    });
    // Pass 1's second finding has only Pass 1's attribution.
    expect(agg.findings[1]?.attributions).toHaveLength(1);
    // Pass 2's new finding is at index 2.
    expect(agg.findings[2]?.summary).toBe('Token logged');
    expect(agg.findings[2]?.attributions[0]).toMatchObject({
      passNumber: 2,
      source: 'independent',
    });
  });

  it('treats file-level findings (no line) as same when (file, *, skill) match', () => {
    const pass1 = reviewWith([
      f('preexisting', 'tests', 'baz.ts', undefined, 'Lacks tests'),
    ]);
    const pass2 = reviewWith([
      f('preexisting', 'tests', 'baz.ts', undefined, 'No tests for this file'),
    ]);
    const agg = aggregatePasses({
      mode: 'consensus',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
      ],
    });
    expect(agg.findings).toHaveLength(1);
    expect(agg.findings[0]?.attributions).toHaveLength(2);
    expect(agg.findings[0]?.attributions[1]?.source).toBe('agreed');
  });

  it('promotes severity to the more conservative value on agreement', () => {
    const pass1 = reviewWith([
      f('minor', 'naming', 'utils.ts', 5, 'minor-leveled'),
    ]);
    const pass2 = reviewWith([
      f('critical', 'naming', 'utils.ts', 5, 'critical-leveled'),
    ]);
    const agg = aggregatePasses({
      mode: 'consensus',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
      ],
    });
    expect(agg.findings[0]?.severity).toBe('critical');
  });

  it('handles 3-pass consensus with mixed agreement', () => {
    const pass1 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'race'),
    ]);
    const pass2 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'race'), // agrees
      f('minor', 'docs', 'README.md', 1, 'fix typo'), // unique
    ]);
    const pass3 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'race'), // also agrees
      f('critical', 'secrets', 'auth.ts', 67, 'token'), // unique
    ]);
    const agg = aggregatePasses({
      mode: 'consensus',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
        { passNumber: 3, role: ROLE_MANTIS, review: pass3 },
      ],
    });
    expect(agg.findings).toHaveLength(3);
    // race: Pass 1 first, Pass 2 + 3 agreed → 3 attributions.
    expect(agg.findings[0]?.attributions).toHaveLength(3);
    expect(agg.findings[0]?.attributions[1]?.source).toBe('agreed');
    expect(agg.findings[0]?.attributions[2]?.source).toBe('agreed');
    // docs typo unique to Pass 2.
    expect(agg.findings[1]?.attributions).toHaveLength(1);
    expect(agg.findings[1]?.attributions[0]?.passNumber).toBe(2);
    // secrets unique to Pass 3.
    expect(agg.findings[2]?.attributions[0]?.passNumber).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Independent mode
// ---------------------------------------------------------------------------

describe('aggregatePasses — independent', () => {
  it('emits every finding side-by-side with no merging', () => {
    const pass1 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'race'),
    ]);
    const pass2 = reviewWith([
      f('critical', 'race', 'auth.ts', 42, 'race again'), // SAME tuple as Pass 1
      f('minor', 'docs', 'README.md', 1, 'typo'),
    ]);
    const agg = aggregatePasses({
      mode: 'independent',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
      ],
    });
    // No merging: same tuple appears twice, attributed to different passes.
    expect(agg.findings).toHaveLength(3);
    expect(agg.findings[0]?.attributions[0]?.passNumber).toBe(1);
    expect(agg.findings[1]?.attributions[0]?.passNumber).toBe(2);
    expect(agg.findings[1]?.attributions[0]?.source).toBe('independent');
    expect(agg.findings[2]?.attributions[0]?.passNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Derived counts + skills_referenced
// ---------------------------------------------------------------------------

describe('aggregatePasses — derived fields', () => {
  it('derives summary_counts from aggregated findings', () => {
    const pass1 = reviewWith([
      f('critical', 'a', 'x.ts', 1, 's1'),
      f('minor', 'b', 'x.ts', 2, 's2'),
    ]);
    const pass2 = reviewWith([
      f('preexisting', 'c', 'y.ts', 1, 's3'),
    ]);
    const agg = aggregatePasses({
      mode: 'independent',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
      ],
    });
    expect(agg.summary_counts).toEqual({
      critical: 1,
      minor: 1,
      preexisting: 1,
      resolved_from_prior: 0,
      still_open: 0,
    });
  });

  it('derives skills_referenced in citation order', () => {
    const pass1 = reviewWith([
      f('critical', 'first-skill', 'x.ts', 1, 's'),
      f('minor', 'second-skill', 'x.ts', 2, 's'),
    ]);
    const pass2 = reviewWith([
      f('preexisting', 'second-skill', 'y.ts', 1, 's'),
      f('preexisting', 'third-skill', 'z.ts', 1, 's'),
    ]);
    const agg = aggregatePasses({
      mode: 'independent',
      firstPass: pass1,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: pass2 },
      ],
    });
    expect(agg.skills_referenced).toEqual([
      'first-skill',
      'second-skill',
      'third-skill',
    ]);
  });

  it('emits "clean" status when no findings exist', () => {
    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: emptyReview(),
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [],
    });
    expect(agg.status_header).toBe('clean');
    expect(agg.verdict).toBe('clean');
  });

  it('emits "critical findings" when any critical present', () => {
    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: reviewWith([f('critical', 's', 'a.ts', 1, 'A')]),
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [],
    });
    expect(agg.status_header).toBe('critical findings');
  });

  it('emits "clean" when only minor/preexisting findings', () => {
    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass: reviewWith([
        f('minor', 's', 'a.ts', 1, 'A'),
        f('preexisting', 's', 'b.ts', 1, 'B'),
      ]),
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [],
    });
    expect(agg.status_header).toBe('clean');
  });
});

// ---------------------------------------------------------------------------
// Verdict resolution
// ---------------------------------------------------------------------------

describe('resolveVerdict', () => {
  function unifiedCritical() {
    return {
      severity: 'critical',
      skill: 's',
      file: 'a.ts',
      line: 1,
      summary: 'x',
      attributions: [
        {
          passNumber: 1,
          roleName: 'Beetle',
          model: 'm',
          source: 'first',
        },
      ],
      // Wave 4b — UnifiedFinding now carries SPEC §6.10.1 consensus.
      // 'first'-only attribution derives to '1-of-N' per deriveConsensus.
      consensus: '1-of-N',
    };
  }

  it('returns clean when there are no findings', () => {
    expect(resolveVerdict('cross-check', [], 2)).toBe('clean');
    expect(resolveVerdict('consensus', [], 2)).toBe('clean');
    expect(resolveVerdict('independent', [], 2)).toBe('clean');
  });

  it('returns review_only when there are no critical findings', () => {
    const u = { ...unifiedCritical(), severity: 'minor' };
    expect(resolveVerdict('cross-check', [u], 2)).toBe('review_only');
    expect(resolveVerdict('consensus', [u], 2)).toBe('review_only');
    expect(resolveVerdict('independent', [u], 2)).toBe('review_only');
  });

  it('cross-check: any critical → request_changes', () => {
    const u = unifiedCritical();
    expect(resolveVerdict('cross-check', [u], 2)).toBe('request_changes');
  });

  it('independent: any critical → request_changes (strict default)', () => {
    const u = unifiedCritical();
    expect(resolveVerdict('independent', [u], 2)).toBe('request_changes');
  });

  it('consensus: critical seen by only ONE pass → review_only', () => {
    const u = unifiedCritical(); // 1 attribution (first)
    expect(resolveVerdict('consensus', [u], 2)).toBe('review_only');
  });

  it('consensus: critical seen by 2+ passes → request_changes', () => {
    const u = unifiedCritical();
    u.attributions.push({
      passNumber: 2,
      roleName: 'Wasp',
      model: 'm',
      source: 'agreed',
    });
    expect(resolveVerdict('consensus', [u], 2)).toBe('request_changes');
  });

  it('consensus: critical raised by Pass 2 + confirmed by Pass 3 (Pass 1 missed) → request_changes', () => {
    // Regression test for the verdict-counts-attributions fix.
    // Before the fix, resolveVerdict counted only attributions with
    // source `first | agreed`; the Pass-2-raises + Pass-3-confirms case
    // produces `[independent, agreed]` and would silently fall through
    // to `review_only`. The fix counts attributions.length directly.
    const u = unifiedCritical();
    u.attributions = [
      { passNumber: 2, roleName: 'Wasp', model: 'm', source: 'independent' },
      { passNumber: 3, roleName: 'Mantis', model: 'm', source: 'agreed' },
    ];
    expect(resolveVerdict('consensus', [u], 3)).toBe('request_changes');
  });

  it('consensus with passCount = 1 → falls back to strict', () => {
    const u = unifiedCritical();
    expect(resolveVerdict('consensus', [u], 1)).toBe('request_changes');
  });
});

// ---------------------------------------------------------------------------
// Wave 4b — SPEC §6.10.1 consensus derivation
// ---------------------------------------------------------------------------

describe('deriveConsensus — SPEC §6.10.1', () => {
  const beetle = (source) => ({
    passNumber: 1,
    roleName: 'Beetle',
    model: 'm',
    source,
  });
  const wasp = (source) => ({
    passNumber: 2,
    roleName: 'Wasp',
    model: 'm',
    source,
  });

  it("'first' alone → '1-of-N' (single-pass, no cross-validation)", () => {
    expect(deriveConsensus([beetle('first')])).toBe('1-of-N');
  });

  it("'first' + 'agreed' → '2-of-2' (cross-check confirmed)", () => {
    // Auto-fix gate qualifies on this combination per §6.10.2.
    expect(deriveConsensus([beetle('first'), wasp('agreed')])).toBe('2-of-2');
  });

  it("'first' + 'disagreed' → 'arbitrated' (cross-check produced dissent)", () => {
    // The finding survives even after dissent — that IS our arbitration
    // model today. Auto-fix gate still refuses (no positive-arbitration
    // plumbing yet) but downstream renderers can surface the dissent
    // for human-reviewer visibility.
    expect(deriveConsensus([beetle('first'), wasp('disagreed')])).toBe(
      'arbitrated',
    );
  });

  it("'first' + 'agreed' + 'disagreed' → '2-of-2' (agreed wins priority)", () => {
    // 3-pass setup: if any pass agrees, we have consensus regardless of
    // a separate dissent. Priority order is agreed > disagreed > default.
    expect(
      deriveConsensus([
        beetle('first'),
        wasp('agreed'),
        { passNumber: 3, roleName: 'Mantis', model: 'm', source: 'disagreed' },
      ]),
    ).toBe('2-of-2');
  });

  it("'independent' alone → '1-of-N' (single-pass discovery)", () => {
    expect(deriveConsensus([wasp('independent')])).toBe('1-of-N');
  });

  it('empty attributions → 1-of-N (defensive default)', () => {
    // Should never happen in practice (every finding has at least one
    // attribution) but the function MUST NOT throw on empty input.
    expect(deriveConsensus([])).toBe('1-of-N');
  });
});

describe('aggregator populates UnifiedFinding.consensus', () => {
  it('cross-check: Pass-1-only finding gets 1-of-N; Pass-2-agreed gets 2-of-2', () => {
    const passF1 = {
      severity: 'critical',
      skill: 's',
      file: 'a.ts',
      line: 1,
      summary: 'x',
    };
    const passF2 = {
      severity: 'critical',
      skill: 's',
      file: 'a.ts',
      line: 2,
      summary: 'y',
    };
    const firstPass = buildReviewFromFindings({
      findings: [passF1, passF2],
      status_header: 'critical findings',
    });
    const crossCheck = {
      verdicts: [
        { pass1Index: 0, verdict: 'agreed' },
        // Index 1 → no verdict from Wasp → stays 1-of-N.
      ],
      independentFindings: [],
    };

    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        {
          passNumber: 2,
          role: ROLE_WASP,
          crossCheck,
        },
      ],
    });

    expect(agg.findings).toHaveLength(2);
    // Pass-1 + Pass-2 agreed → consensus reached.
    expect(agg.findings[0]?.consensus).toBe('2-of-2');
    // Pass-1 only (Wasp didn't verdict on this one) → no consensus.
    expect(agg.findings[1]?.consensus).toBe('1-of-N');
  });

  it("cross-check: 'disagreed' verdict produces 'arbitrated'", () => {
    const passF = {
      severity: 'minor',
      skill: 's',
      file: 'a.ts',
      line: 5,
      summary: 'maybe a bug',
    };
    const firstPass = buildReviewFromFindings({
      findings: [passF],
      status_header: 'clean',
    });
    const crossCheck = {
      verdicts: [{ pass1Index: 0, verdict: 'disagreed', rationale: 'nope' }],
      independentFindings: [],
    };

    const agg = aggregatePasses({
      mode: 'cross-check',
      firstPass,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [{ passNumber: 2, role: ROLE_WASP, crossCheck }],
    });

    expect(agg.findings[0]?.consensus).toBe('arbitrated');
  });

  it('consensus mode: same-tuple match across passes → 2-of-2', () => {
    const dup = {
      severity: 'critical',
      skill: 's',
      file: 'a.ts',
      line: 42,
      summary: 'race condition',
    };
    const firstPass = buildReviewFromFindings({
      findings: [dup],
      status_header: 'critical findings',
    });
    const secondPass = buildReviewFromFindings({
      findings: [dup],
      status_header: 'critical findings',
    });

    const agg = aggregatePasses({
      mode: 'consensus',
      firstPass,
      firstPassRole: ROLE_BEETLE,
      subsequentPasses: [
        { passNumber: 2, role: ROLE_WASP, review: secondPass },
      ],
    });

    expect(agg.findings).toHaveLength(1);
    expect(agg.findings[0]?.consensus).toBe('2-of-2');
  });
});

// ---------------------------------------------------------------------------
// 6c — shouldEscalate (conditional Mantis-arbiter gate)
// ---------------------------------------------------------------------------

describe('shouldEscalate', () => {
  // Pass 1 (flattenFindings order: critical → minor → preexisting):
  //   index 0 = critical, 1 = minor, 2 = preexisting.
  const firstPass = reviewWith([
    f('critical', 'race-conditions', 'auth.ts', 42, 'Race condition'),
    f('minor', 'magic-numbers', 'utils.ts', 18, 'Magic number'),
    f('preexisting', 'legacy', 'old.ts', 5, 'Legacy pattern'),
  ]);
  const pass2 = (verdicts) => ({
    passNumber: 2,
    role: ROLE_WASP,
    crossCheck: { verdicts, independentFindings: [] },
  });

  it('escalates when a 2-pass cross-check disagrees on a critical finding', () => {
    expect(
      shouldEscalate({
        mode: 'cross-check',
        passCount: 2,
        firstPass,
        subsequentPasses: [pass2([{ pass1Index: 0, verdict: 'disagreed' }])],
      }),
    ).toBe(true);
  });

  it('escalates when a 2-pass cross-check disagrees on a minor finding', () => {
    expect(
      shouldEscalate({
        mode: 'cross-check',
        passCount: 2,
        firstPass,
        subsequentPasses: [pass2([{ pass1Index: 1, verdict: 'disagreed' }])],
      }),
    ).toBe(true);
  });

  it('does NOT escalate when the only disagreement is on a preexisting finding', () => {
    expect(
      shouldEscalate({
        mode: 'cross-check',
        passCount: 2,
        firstPass,
        subsequentPasses: [pass2([{ pass1Index: 2, verdict: 'disagreed' }])],
      }),
    ).toBe(false);
  });

  it('does NOT escalate when every verdict agrees', () => {
    expect(
      shouldEscalate({
        mode: 'cross-check',
        passCount: 2,
        firstPass,
        subsequentPasses: [
          pass2([
            { pass1Index: 0, verdict: 'agreed' },
            { pass1Index: 1, verdict: 'agreed' },
          ]),
        ],
      }),
    ).toBe(false);
  });

  it('does NOT escalate for consensus or independent modes', () => {
    for (const mode of ['consensus', 'independent']) {
      expect(
        shouldEscalate({
          mode,
          passCount: 2,
          firstPass,
          subsequentPasses: [pass2([{ pass1Index: 0, verdict: 'disagreed' }])],
        }),
      ).toBe(false);
    }
  });

  it('does NOT escalate at passCount 1 or 3 (a static 3-pass already runs Mantis)', () => {
    for (const passCount of [1, 3]) {
      expect(
        shouldEscalate({
          mode: 'cross-check',
          passCount,
          firstPass,
          subsequentPasses: [pass2([{ pass1Index: 0, verdict: 'disagreed' }])],
        }),
      ).toBe(false);
    }
  });

  it('does NOT escalate when the disagreed pass1Index is out of range', () => {
    expect(
      shouldEscalate({
        mode: 'cross-check',
        passCount: 2,
        firstPass,
        subsequentPasses: [pass2([{ pass1Index: 99, verdict: 'disagreed' }])],
      }),
    ).toBe(false);
  });
});
