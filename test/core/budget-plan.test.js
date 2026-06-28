// Tests for src/core/budget-plan.ts — ported from clud-bug-app's
// test/budget-gate.test.ts. Behavior pinned identically; only the import
// path differs. `__setModelCeilingForTests` is exported from budget-plan and
// the override test path is preserved verbatim.

import { afterEach, describe, expect, it } from 'vitest';

import {
  __setModelCeilingForTests,
  DEFAULT_PER_PR_CAP_USD,
  DEFAULT_VERIFIER_PER_PR_CAP_USD,
  estimateBudget,
  estimateVerifierBudget,
  perCallCeiling,
} from '../../src/core/budget-plan.js';

// Tests focus on:
//   - Per-PR cap blocks an obviously expensive plan
//   - billingExempt bypasses the cap entirely
//   - empty resolved (single-pass D.2.0 path) always allows
//   - unknown models fall back to the conservative ceiling
//   - per-call ceiling is max(ceilings of involved models)

function pass(slug, count) {
  return {
    slug,
    count,
    mode: 'cross-check',
    roles: [],
    source: 'repoDefault',
  };
}

// ---------------------------------------------------------------------------
// perCallCeiling
// ---------------------------------------------------------------------------

describe('perCallCeiling', () => {
  it('returns max across known models', () => {
    const ceiling = perCallCeiling([
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-opus-4.7',
    ]);
    // opus 4.7 = 0.5
    expect(ceiling).toBe(0.5);
  });

  it('falls back to DEFAULT for empty list', () => {
    expect(perCallCeiling([])).toBe(0.5);
  });

  it('falls back to DEFAULT for unknown models (conservative)', () => {
    expect(perCallCeiling(['provider/unknown-model'])).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// estimateBudget — allow / deny
// ---------------------------------------------------------------------------

describe('estimateBudget', () => {
  it('allows the single-pass D.2.0 path (empty resolved)', () => {
    const verdict = estimateBudget({
      resolved: [],
      roleModels: ['anthropic/claude-sonnet-4.6'],
    });
    expect(verdict.verdict).toBe('allow');
    expect(verdict.estimate.estimatedCalls).toBe(0);
    expect(verdict.estimate.estimatedCostUsd).toBe(0);
  });

  it('allows a normal multi-pass plan under the cap', () => {
    const verdict = estimateBudget({
      resolved: [pass('a', 1), pass('b', 2), pass('c', 1)],
      roleModels: ['anthropic/claude-sonnet-4.6'],
    });
    expect(verdict.verdict).toBe('allow');
    // Orchestrator sends all skills in ONE prompt per pass, so call count
    // is max(counts), not sum(counts). max(1,2,1) = 2.
    expect(verdict.estimate.estimatedCalls).toBe(2);
    // 2 × $0.08 = $0.16, well below $5
    expect(verdict.estimate.estimatedCostUsd).toBeCloseTo(0.16, 2);
  });

  it('denies when estimated cost exceeds the cap', () => {
    // 3 passes × $0.50/call opus = $1.50. With a custom $1 cap → deny.
    // (Default $5 cap with the new max-based math is not reachable via
    // the count: 3 HARD CAP; this case validates the deny path explicitly.)
    const verdict = estimateBudget({
      resolved: Array.from({ length: 20 }, (_, i) => pass(`s${i}`, 3)),
      roleModels: ['anthropic/claude-opus-4.7'],
      perPrCapUsd: 1,
    });
    expect(verdict.verdict).toBe('deny');
    if (verdict.verdict === 'deny') {
      expect(verdict.reason).toMatch(/clud-bug paused this review/);
      expect(verdict.reason).toMatch(/reviewPasses\.count/);
      expect(verdict.estimate.estimatedCalls).toBe(3);
    }
  });

  it('billingExempt = true bypasses the cap', () => {
    const verdict = estimateBudget({
      resolved: Array.from({ length: 20 }, (_, i) => pass(`s${i}`, 3)),
      roleModels: ['anthropic/claude-opus-4.7'],
      billingExempt: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('respects a custom perPrCapUsd', () => {
    const verdict = estimateBudget({
      resolved: [pass('a', 2)],
      roleModels: ['anthropic/claude-sonnet-4.6'],
      // 2 × $0.08 = $0.16
      perPrCapUsd: 0.1,
    });
    expect(verdict.verdict).toBe('deny');
    if (verdict.verdict === 'deny') {
      expect(verdict.estimate.capUsd).toBe(0.1);
    }
  });

  it('reports the default cap when none provided', () => {
    const verdict = estimateBudget({
      resolved: [pass('a', 1)],
      roleModels: ['anthropic/claude-sonnet-4.6'],
    });
    expect(verdict.estimate.capUsd).toBe(DEFAULT_PER_PR_CAP_USD);
  });
});

// ---------------------------------------------------------------------------
// Model ceiling override (D.4 hook)
// ---------------------------------------------------------------------------

describe('__setModelCeilingForTests', () => {
  afterEach(() => {
    __setModelCeilingForTests('test/super-cheap-model', null);
  });

  it('lets future D.4 wiring register a new model ceiling', () => {
    __setModelCeilingForTests('test/super-cheap-model', 0.001);
    expect(perCallCeiling(['test/super-cheap-model'])).toBe(0.001);
    __setModelCeilingForTests('test/super-cheap-model', null);
    // Fall back to DEFAULT after removal.
    expect(perCallCeiling(['test/super-cheap-model'])).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// D.2.6 verifier budget — estimateVerifierBudget
// ---------------------------------------------------------------------------

describe('estimateVerifierBudget', () => {
  it('allows zero-thread fix-pushes (no work, no cost)', () => {
    const verdict = estimateVerifierBudget({ threadCount: 0 });
    expect(verdict.verdict).toBe('allow');
    expect(verdict.estimate.estimatedCalls).toBe(0);
    expect(verdict.estimate.estimatedCostUsd).toBe(0);
  });

  it('allows the plan-spec ceiling (5 findings × 3 fix-pushes ≈ 15 calls)', () => {
    // 5 threads × 1 pass = 5 calls × $0.01 = $0.05, under $0.60 cap.
    const verdict = estimateVerifierBudget({ threadCount: 5 });
    expect(verdict.verdict).toBe('allow');
    expect(verdict.estimate.estimatedCalls).toBe(5);
    expect(verdict.estimate.estimatedCostUsd).toBeCloseTo(0.05, 5);
    expect(verdict.estimate.capUsd).toBe(DEFAULT_VERIFIER_PER_PR_CAP_USD);
  });

  it('scales calls by passesPerThread for D.2.5 multi-pass installs', () => {
    // 5 threads × 3 passes = 15 calls × $0.01 = $0.15, still under $0.60 cap.
    const verdict = estimateVerifierBudget({
      threadCount: 5,
      passesPerThread: 3,
    });
    expect(verdict.estimate.estimatedCalls).toBe(15);
    expect(verdict.verdict).toBe('allow');
  });

  it('denies when the planned calls exceed the cap', () => {
    // 100 threads × 1 pass = 100 calls × $0.01 = $1.00 > $0.60.
    const verdict = estimateVerifierBudget({ threadCount: 100 });
    expect(verdict.verdict).toBe('deny');
    if (verdict.verdict === 'deny') {
      expect(verdict.reason).toMatch(/paused D\.2\.6 fix-verification/);
      expect(verdict.reason).toMatch(/autoResolve\.max_threads_per_fix_push/);
    }
  });

  it('billingExempt = true bypasses the cap', () => {
    const verdict = estimateVerifierBudget({
      threadCount: 1000,
      billingExempt: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('honors a custom perPrCapUsd override', () => {
    const verdict = estimateVerifierBudget({
      threadCount: 10, // 10 × $0.01 = $0.10
      perPrCapUsd: 0.05,
    });
    expect(verdict.verdict).toBe('deny');
    if (verdict.verdict === 'deny') {
      expect(verdict.estimate.capUsd).toBe(0.05);
    }
  });

  it('clamps passesPerThread to a minimum of 1 (defensive)', () => {
    // passesPerThread = 0 would zero out cost — defensively floor at 1.
    const verdict = estimateVerifierBudget({
      threadCount: 5,
      passesPerThread: 0,
    });
    expect(verdict.estimate.estimatedCalls).toBe(5);
  });
});
