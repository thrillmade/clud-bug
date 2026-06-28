// The single shared review planner (SPEC §11.5). Composes the per-skill pass
// resolver (`review-plan.ts`) and the Layer-1 budget gate (`budget-plan.ts`),
// then applies trigger / diff-size tiering. Every consumer — the hosted bot,
// the npm workflow, and local mode — runs THIS function so they plan
// identically; only the tier → concrete-model binding differs per consumer.
//
// Lives in its own module (not in `review-plan.ts`) because it imports
// `estimateBudget`, and `budget-plan.ts` already imports from `review-plan.ts`
// — keeping `planReview` here avoids a review-plan ↔ budget-plan cycle.

import {
  resolveReviewPasses,
  type ReviewPlanSkill,
  type ReviewPassesConfig,
  type ResolvedReviewPasses,
  type ReviewRole,
  type ApplyTo,
} from './review-plan.js';
import { estimateBudget, type BudgetVerdict } from './budget-plan.js';

/** Trigger context that selects plan depth (SPEC §11.5). */
export type ReviewTrigger = 'commit' | 'push' | 'pr';

/** Why a plan was tiered down from its fully-resolved passes. */
export type TierDownReason = 'commit' | 'large-diff';

/**
 * Diff size (bytes) at/above which the planner auto-tiers down to a single
 * fast pass to protect cost + latency. A very large diff rarely benefits from
 * multi-pass depth as much as it costs.
 */
export const LARGE_DIFF_THRESHOLD_BYTES = 50_000;

export interface PlanReviewInput {
  /** Loaded skills — the caller does the consumer-specific I/O to load them. */
  skills: ReviewPlanSkill[];
  /** Parsed `.clud-bug.json` `reviewPasses` block (may be null). */
  config: ReviewPassesConfig | null;
  /** Raw SKILL.md text per slug, for the frontmatter `review_passes` override. */
  rawSkillMd?: Record<string, string>;
  /** Trigger context. Defaults to `pr` (the full plan). */
  trigger?: ReviewTrigger;
  /** Diff size under review, in bytes — enables large-diff auto-tiering. */
  diffSizeBytes?: number;
  /** Optional per-PR USD cap forwarded to the budget gate. */
  perPrCapUsd?: number;
  /** Billing-exempt installs bypass the budget cap. */
  billingExempt?: boolean;
}

export interface ReviewPlan {
  /** Effective per-skill passes (after any tier-down). */
  perSkill: ResolvedReviewPasses[];
  /** Role tiers in pass order — the consumer binds each tier → a concrete model. */
  roles: ReviewRole[];
  /** Multi-pass apply scope. */
  applyTo: ApplyTo;
  /** Layer-1 budget verdict over the effective (post-tiering) plan. */
  budget: BudgetVerdict;
  /** The trigger this plan was computed for. */
  trigger: ReviewTrigger;
  /** Present when the resolved passes were tiered down, with the reason. */
  tieredDown?: TierDownReason;
  /** One-line human summary. */
  summary: string;
}

/**
 * Plan a review. Tiering (a commit-time review runs on every commit, and a very
 * large diff shouldn't pay for full multi-pass depth):
 *   - `trigger: 'commit'`                           → a single fast pass per skill.
 *   - `diffSizeBytes` >= `LARGE_DIFF_THRESHOLD_BYTES` → a single fast pass per skill.
 *   - otherwise (push/pr, normal diff)               → the fully-resolved plan.
 * `commit` takes precedence over diff size.
 *
 * Tiering to one pass means pass 1 / role[0] (the `beetle` fast tier) runs — so
 * "fast model for commits" falls out of the tier system, never hand-picked.
 */
export function planReview(input: PlanReviewInput): ReviewPlan {
  const trigger: ReviewTrigger = input.trigger ?? 'pr';

  const resolved = resolveReviewPasses({
    skills: input.skills,
    config: input.config,
    ...(input.rawSkillMd !== undefined ? { rawSkillMd: input.rawSkillMd } : {}),
  });

  let tieredDown: TierDownReason | undefined;
  if (trigger === 'commit') {
    tieredDown = 'commit';
  } else if (
    input.diffSizeBytes !== undefined &&
    input.diffSizeBytes >= LARGE_DIFF_THRESHOLD_BYTES
  ) {
    tieredDown = 'large-diff';
  }

  const perSkill: ResolvedReviewPasses[] = tieredDown
    ? resolved.perSkill.map((p) => ({ ...p, count: 1 }))
    : resolved.perSkill;

  // Cost only the passes that actually run: a tiered plan runs a single
  // (role[0] / beetle) pass, so don't bill the skipped deeper tiers.
  const roleModels = (tieredDown ? resolved.roles.slice(0, 1) : resolved.roles).map(
    (r) => r.model,
  );
  const budget = estimateBudget({
    resolved: perSkill,
    roleModels,
    ...(input.perPrCapUsd !== undefined ? { perPrCapUsd: input.perPrCapUsd } : {}),
    ...(input.billingExempt !== undefined ? { billingExempt: input.billingExempt } : {}),
  });

  // Report the per-skill pass DEPTH (max), not the summed call count — the
  // recipe branches on this same depth, so "1-pass" here agrees with "single
  // pass" there. (Total call count drives the budget below, not the summary.)
  const passesPerSkill = perSkill.length
    ? Math.max(...perSkill.map((p) => p.count))
    : 0;
  const tierNote = tieredDown ? `, tiered down (${tieredDown})` : '';
  const budgetNote =
    budget.verdict === 'deny'
      ? `; budget exceeded ($${budget.estimate.estimatedCostUsd.toFixed(2)} > $${budget.estimate.capUsd.toFixed(2)})`
      : `; est $${budget.estimate.estimatedCostUsd.toFixed(2)}`;
  const summary = `${passesPerSkill}-pass review across ${perSkill.length} skill(s) [${trigger}]${tierNote}${budgetNote}`;

  return {
    perSkill,
    roles: resolved.roles,
    applyTo: resolved.applyTo,
    budget,
    trigger,
    ...(tieredDown !== undefined ? { tieredDown } : {}),
    summary,
  };
}
