// Tests for src/core/plan-review.ts — the shared `planReview` entry point
// (SPEC §11.5). It composes resolveReviewPasses + estimateBudget and applies the
// trigger / diff-size tiering (commit → a single fast pass; large diff → auto-tier).

import { describe, expect, it } from 'vitest';

import { planReview, LARGE_DIFF_THRESHOLD_BYTES } from '../../src/core/plan-review.js';

// Minimal `{ slug, frontmatter }` (core SkillFrontmatter) — planReview only
// forwards these to resolveReviewPasses, which reads slug + review_mode.
function makeSkill(slug, review_mode = 'shared') {
  return {
    slug,
    frontmatter: { name: slug, description: `Test ${slug}`, source: 'manual', review_mode },
  };
}

const SKILLS = [makeSkill('a'), makeSkill('b')];
// Repo-default 3 passes so the tier-down (3 → 1) is observable.
const CONFIG = { count: 3, mode: 'consensus' };

describe('planReview', () => {
  it('returns a full plan by default (no trigger): counts from the resolver, plus budget + roles + summary', () => {
    const plan = planReview({ skills: SKILLS, config: CONFIG });
    expect(plan.perSkill.map((p) => p.count)).toEqual([3, 3]);
    expect(plan.trigger).toBe('pr');
    expect(plan.tieredDown).toBeUndefined();
    expect(plan.budget.verdict).toBeDefined();
    expect(plan.budget.estimate.estimatedCalls).toBeGreaterThan(0);
    expect(plan.roles.length).toBeGreaterThan(0);
    expect(typeof plan.summary).toBe('string');
  });

  it('tiers down to a single fast pass on a commit trigger', () => {
    const full = planReview({ skills: SKILLS, config: CONFIG });
    const plan = planReview({ skills: SKILLS, config: CONFIG, trigger: 'commit' });
    expect(plan.perSkill.every((p) => p.count === 1)).toBe(true);
    expect(plan.tieredDown).toBe('commit');
    // fewer planned calls than the full plan → cheaper, the whole point.
    expect(plan.budget.estimate.estimatedCalls).toBeLessThan(full.budget.estimate.estimatedCalls);
    expect(plan.summary).toMatch(/tier/i);
  });

  it('auto-tiers down on a large diff (push trigger)', () => {
    const plan = planReview({
      skills: SKILLS,
      config: CONFIG,
      trigger: 'push',
      diffSizeBytes: LARGE_DIFF_THRESHOLD_BYTES + 1,
    });
    expect(plan.perSkill.every((p) => p.count === 1)).toBe(true);
    expect(plan.tieredDown).toBe('large-diff');
  });

  it('keeps the full plan on push with a small diff', () => {
    const plan = planReview({ skills: SKILLS, config: CONFIG, trigger: 'push', diffSizeBytes: 100 });
    expect(plan.perSkill.map((p) => p.count)).toEqual([3, 3]);
    expect(plan.tieredDown).toBeUndefined();
  });

  it('commit tiering takes precedence over diff size', () => {
    const plan = planReview({
      skills: SKILLS,
      config: CONFIG,
      trigger: 'commit',
      diffSizeBytes: 100,
    });
    expect(plan.perSkill.every((p) => p.count === 1)).toBe(true);
    expect(plan.tieredDown).toBe('commit');
  });

  it('tiers down when diffSizeBytes equals the threshold (>= boundary)', () => {
    const plan = planReview({
      skills: SKILLS,
      config: CONFIG,
      trigger: 'push',
      diffSizeBytes: LARGE_DIFF_THRESHOLD_BYTES,
    });
    expect(plan.tieredDown).toBe('large-diff');
    expect(plan.perSkill.every((p) => p.count === 1)).toBe(true);
  });

  it('costs a tiered plan at only the fast tier (does not bill the skipped deeper tiers)', () => {
    const full = planReview({ skills: SKILLS, config: CONFIG });
    const tiered = planReview({ skills: SKILLS, config: CONFIG, trigger: 'commit' });
    // Tiering runs only role[0] (beetle), so the per-call ceiling must drop —
    // not stay pinned at the max across the (unused) deeper tiers.
    expect(tiered.budget.estimate.perCallCeilingUsd).toBeLessThan(
      full.budget.estimate.perCallCeilingUsd,
    );
  });

  it('handles an empty skills array gracefully', () => {
    const plan = planReview({ skills: [], config: CONFIG });
    expect(plan.perSkill).toEqual([]);
    expect(plan.budget.estimate.estimatedCalls).toBe(0);
    expect(plan.budget.verdict).toBe('allow');
    expect(plan.summary).toMatch(/0 pass/);
  });

  it('reports budget-exceeded detail in the summary when the verdict is deny', () => {
    const plan = planReview({ skills: SKILLS, config: CONFIG, perPrCapUsd: 0.000001 });
    expect(plan.budget.verdict).toBe('deny');
    expect(plan.summary).toMatch(/budget exceeded/i);
  });
});
