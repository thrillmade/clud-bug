import type { ResolvedReviewPasses } from './review-plan.js';

/**
 * Layer 1 cost gate — pre-flight estimator for multi-pass review.
 *
 * D.2.5 introduces a cost multiplier — a 3-pass review of a 5-skill catalog
 * is 15 AI calls instead of 5. Without a gate, a misconfigured `reviewPasses`
 * block can quietly burn through the AI Gateway budget on a single PR. This
 * module decides BEFORE any AI call whether the review is cheap enough to
 * run, and if not, returns a structured "deny" verdict the orchestrator
 * surfaces as a friendly comment.
 *
 * Two layers, only the first lands in D.2.5:
 *
 *   - Layer 1 (this module): per-PR estimate. Sums `skill_loads × pass_count`
 *     to produce an `estimatedCalls` count and an `estimatedCostUsd`
 *     ceiling. If `estimatedCostUsd > cap`, we deny.
 *
 *   - Layer 2 (D.4 — NOT in this module): per-install rolling spend. Reads
 *     `INSTALLS:{id}.spend_usd_30d` from Redis. D.4 wires the actual gating;
 *     here we just stub the interface.
 *
 * The gate is BEST-EFFORT, intentionally pessimistic. We over-estimate cost
 * (worst-case tokens × highest-tier model) because the alternative is the
 * customer eating a surprise bill. A 20% over-estimate that occasionally
 * causes a "we paused; raise the cap" comment is the right failure mode.
 *
 * SPEC §4.9 — THREE MECHANISMS LIVE NEARBY; DO NOT CONFLATE THEM:
 *
 *   1. This module's `perPrCapUsd` — the REPOSITORY's own ceiling, and the
 *      one §4.9 governs. It defaults to UNSET: "no ceiling until someone
 *      chooses one, because a default cap silently truncates reviews nobody
 *      asked to truncate." It used to default to $5, which is the bug this
 *      docblock now exists to keep fixed.
 *
 *   2. clud-bug-app's `lib/runaway-guard.ts` — the OPERATOR's floor on its
 *      OWN spend ($5/PR/24h + a review-count cap, applied to every install
 *      including billing-exempt ones). §4.9 explicitly protects it: it "MUST
 *      NOT be read as forbidden by the rule above." Not this module's
 *      business, and not ours to unset.
 *
 *   3. `estimateVerifierBudget` below — the D.2.6 fix-verifier's own per-PR
 *      budget. A separate surface with a separate failure mode (denying it
 *      routes threads through the heuristic fallback rather than truncating
 *      a review), so it keeps its default; see its own docblock.
 *
 * With (1) unset by default, `estimateBudget` returns `{ verdict: 'allow' }`
 * on every path unless a caller passes a ceiling. The implementation stays
 * complete so wiring a per-install ceiling is a plumbing change here, not a
 * redesign of the orchestrator surface.
 */

// ---------------------------------------------------------------------------
// Constants — worst-case cost ceilings
// ---------------------------------------------------------------------------

/**
 * Rough USD-per-call ceiling across the model tiers we route to.
 *
 * Numbers are deliberately over-stated — we'd rather deny a borderline
 * review than blow past a billing cap. Reconciled monthly from the AI
 * Gateway dashboard; the D.4 billing module replaces this with live data.
 *
 * Picking the max(model) across the roles array keeps the math local — we
 * don't need per-pass attribution for the estimate, only for billing
 * reconciliation later.
 */
const MODEL_CEILING_USD: Record<string, number> = {
  'anthropic/claude-haiku-4.5': 0.02,
  'anthropic/claude-sonnet-4.6': 0.08,
  'anthropic/claude-opus-4.6': 0.4,
  'anthropic/claude-opus-4.7': 0.5,
  'openai/gpt-5': 0.4,
  'openai/gpt-5.2': 0.04,
  'google/gemini-3-flash': 0.02,
  'google/gemini-3.1-pro-preview': 0.3,
};

/** Fallback ceiling for unknown model slugs. Conservative. */
const DEFAULT_PER_CALL_USD = 0.5;

/**
 * A *suggested* per-PR ceiling for an operator or repository that wants one.
 * NOT applied by default — see `estimateBudget` and SPEC §4.9.
 *
 * $5 = a 3-pass review across 10 expensive skills (~30 calls × $0.15 avg).
 * Anything above that is almost certainly a misconfigured `reviewPasses`,
 * which makes it a sane number to *offer*. It is only ever in force when a
 * caller passes it as `perPrCapUsd`.
 */
export const SUGGESTED_PER_PR_CAP_USD = 5.0;

/**
 * @deprecated Renamed to {@link SUGGESTED_PER_PR_CAP_USD}. This value is no
 * longer a default — SPEC §4.9 requires the repository-facing ceiling to
 * default to unset, so nothing applies it unless a caller passes
 * `perPrCapUsd`. Kept as an alias so existing importers (notably
 * clud-bug-app's `lib/budget-gate.ts` re-export shim) keep compiling; it will
 * go in a major (SPEC §7.5).
 */
export const DEFAULT_PER_PR_CAP_USD = SUGGESTED_PER_PR_CAP_USD;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BudgetEstimateInput {
  /** Resolved per-skill config — one entry per skill in the catalog. */
  resolved: ResolvedReviewPasses[];
  /** Model slugs the orchestrator plans to route to, in pass order. */
  roleModels: string[];
  /**
   * The repository's per-PR USD ceiling, when it has chosen one.
   *
   * **Omitted / `undefined` means UNSET — no ceiling, never a deny.** SPEC
   * §4.9: the customer-facing ceiling is "configurable per install and
   * defaulting to unset — no ceiling until someone chooses one, because a
   * default cap silently truncates reviews nobody asked to truncate."
   *
   * This is NOT the operator's own runaway guard. §4.9 keeps those separate:
   * "Whoever pays for the inference MAY cap what a single pull request can
   * consume of it, at a default of their choosing." That guard lives in
   * clud-bug-app (`lib/runaway-guard.ts`, $5/PR/24h, applies to every install
   * including billing-exempt) and is untouched by this default.
   */
  perPrCapUsd?: number;
  /**
   * Installation flag — `billing === 'exempt'` orgs bypass the cap entirely.
   * D.4 reads this from the install record. For D.2.5, the orchestrator
   * passes the env-allowlist result here.
   */
  billingExempt?: boolean;
}

export interface BudgetEstimate {
  /** Total AI calls = sum(skill_count × pass_count). */
  estimatedCalls: number;
  /** Worst-case cost in USD across all planned calls. */
  estimatedCostUsd: number;
  /** Per-call ceiling used (max across the role models). */
  perCallCeilingUsd: number;
  /**
   * The cap the estimate was checked against, or `null` when no ceiling is
   * configured (the SPEC §4.9 default). A `null` cap can never deny.
   */
  capUsd: number | null;
}

/** A `deny` always has a ceiling — you cannot exceed a cap nobody set. */
export type CappedBudgetEstimate = BudgetEstimate & { capUsd: number };

export type BudgetVerdict =
  | {
      verdict: 'allow';
      estimate: BudgetEstimate;
    }
  | {
      verdict: 'deny';
      estimate: CappedBudgetEstimate;
      /** Friendly reason for the orchestrator's "we paused this review" comment. */
      reason: string;
    };

// ---------------------------------------------------------------------------
// Estimator
// ---------------------------------------------------------------------------

/**
 * Returns the per-call USD ceiling — max across the role models.
 */
export function perCallCeiling(models: string[]): number {
  if (models.length === 0) return DEFAULT_PER_CALL_USD;
  let max = 0;
  for (const m of models) {
    const c = MODEL_CEILING_USD[m] ?? DEFAULT_PER_CALL_USD;
    if (c > max) max = c;
  }
  return max;
}

/**
 * Layer-1 cost gate. Decides whether the planned passes fit under the
 * repository's ceiling — **if it has set one**.
 *
 * Behavior matrix:
 *   perPrCapUsd omitted (UNSET)      → allow, always (SPEC §4.9 default)
 *   billingExempt = true             → allow (skip cap entirely)
 *   estimatedCostUsd > cap           → deny + friendly reason
 *   estimatedCostUsd <= cap          → allow
 *   resolved.length === 0            → allow (single-pass D.2.0 path)
 *
 * The unset default is the SPEC §4.9 rule, quoted verbatim: a reviewer
 * exposes a cost ceiling "configurable per install and defaulting to unset —
 * no ceiling until someone chooses one, because a default cap silently
 * truncates reviews nobody asked to truncate." An operator's own floor on its
 * own spend is a different mechanism §4.9 explicitly permits ("MUST NOT be
 * read as forbidden by the rule above") and lives elsewhere — see
 * `perPrCapUsd`'s doc comment.
 */
export function estimateBudget(input: BudgetEstimateInput): BudgetVerdict {
  // UNSET by default. `?? null`, never `?? SUGGESTED_PER_PR_CAP_USD`.
  const cap = input.perPrCapUsd ?? null;
  const ceiling = perCallCeiling(input.roleModels);
  // The orchestrator (runMultiPass) sends all skills in a SINGLE prompt
  // each pass and loops only the max skill's count times. Real call count
  // is max(counts), not sum(counts). Summing over-estimates linearly with
  // catalog size, making multi-pass unreachable for medium+ skill sets.
  const calls = input.resolved.length === 0
    ? 0
    : input.resolved.reduce((max, r) => Math.max(max, r.count), 0);
  const cost = calls * ceiling;

  const estimate: BudgetEstimate = {
    estimatedCalls: calls,
    estimatedCostUsd: cost,
    perCallCeilingUsd: ceiling,
    capUsd: cap,
  };

  if (input.billingExempt) {
    return { verdict: 'allow', estimate };
  }
  if (cap !== null && cost > cap) {
    return {
      verdict: 'deny',
      estimate: { ...estimate, capUsd: cap },
      reason: friendlyDenyReason({ cost, cap, calls, ceiling }),
    };
  }
  return { verdict: 'allow', estimate };
}

function friendlyDenyReason(args: {
  cost: number;
  cap: number;
  calls: number;
  ceiling: number;
}): string {
  return [
    `clud-bug paused this review — estimated cost \`$${args.cost.toFixed(2)}\``,
    `exceeds the per-PR cap of \`$${args.cap.toFixed(2)}\`.`,
    `(${args.calls} planned AI call${args.calls === 1 ? '' : 's'} ×`,
    `worst-case \`$${args.ceiling.toFixed(2)}\` per call.)`,
    'Lower `reviewPasses.count` in `.claude/skills/.clud-bug.json` and re-trigger.',
  ].join(' ');
}

/**
 * Exposed for tests + future D.4 wiring. Lets callers register a cost
 * ceiling for a newly-routed model without editing this module.
 */
export function __setModelCeilingForTests(
  model: string,
  usd: number | null,
): void {
  if (usd === null) {
    delete MODEL_CEILING_USD[model];
    return;
  }
  MODEL_CEILING_USD[model] = usd;
}

// ---------------------------------------------------------------------------
// D.2.6 — auto-resolve verifier cost surface
// ---------------------------------------------------------------------------

/**
 * Per-call ceiling for the D.2.6 fix-verifier. Each verifier call is small —
 * ~500 token I/O at Sonnet rates — so a more aggressive ceiling makes sense
 * vs the main-review per-call ceiling. We over-state by ~2x to keep the
 * "$0.10 per PR with 5 findings × 3 fix-pushes" plan budget honest.
 *
 * Sonnet 4.6 at $3/$15 per million tokens × 500 token I/O ≈ $0.005;
 * we use $0.01 as the gate ceiling so a borderline-overbudget verifier doesn't
 * silently silently flip the install over the cap.
 */
const VERIFIER_PER_CALL_CEILING_USD = 0.01;

/**
 * Default per-PR budget for D.2.6 verifier calls. The spec calls $0.10 the
 * "5 findings × 3 fix-pushes" ceiling; we use 2x that as the cap so a
 * sufficiently-large PR (20 threads × 3 fix-pushes = 60 calls) still fits.
 *
 * D.4 will plumb per-install caps; for D.2.6 we use a single repo-wide
 * default. Installs in BILLING_EXEMPT_ORGS bypass this entirely.
 *
 * This default is deliberately NOT unset (unlike the review ceiling above).
 * It is mechanism (3) in the module docblock: denying it does not truncate a
 * review — it routes the open threads through the heuristic auto-resolve
 * fallback, so the review still lands complete. Changing it is a separate
 * decision from the SPEC §4.9 fix; do not fold the two together.
 */
export const DEFAULT_VERIFIER_PER_PR_CAP_USD = 0.6;

export interface VerifierBudgetInput {
  /** Number of open threads we plan to verify on this fix-push. */
  threadCount: number;
  /**
   * Pass count from D.2.5 multi-pass — we call the verifier once per pass
   * per thread (see resolve-verifier integration doc). Defaults to 1
   * for single-pass installs.
   */
  passesPerThread?: number;
  /**
   * Optional per-PR cap override. Defaults to DEFAULT_VERIFIER_PER_PR_CAP_USD.
   */
  perPrCapUsd?: number;
  /** BILLING_EXEMPT installs bypass the cap. */
  billingExempt?: boolean;
}

export interface VerifierBudgetEstimate {
  /** Total verifier AI calls = threadCount × passesPerThread. */
  estimatedCalls: number;
  /** Worst-case cost. */
  estimatedCostUsd: number;
  /** Per-call ceiling used. */
  perCallCeilingUsd: number;
  /** Cap checked against. */
  capUsd: number;
}

export type VerifierBudgetVerdict =
  | { verdict: 'allow'; estimate: VerifierBudgetEstimate }
  | {
      verdict: 'deny';
      estimate: VerifierBudgetEstimate;
      /** Friendly reason for the orchestrator's "skipped: verifier-budget" log. */
      reason: string;
    };

/**
 * Pre-flight gate for the D.2.6 fix-verifier. Called once per fix-push,
 * BEFORE any verifier call runs. If denied, the orchestrator emits
 * `skipped: budget` for the entire auto-resolve cycle and routes the
 * threads through the heuristic fallback (see auto-resolve).
 *
 * Behavior:
 *   billingExempt = true  → allow (bypass cap)
 *   estimated > cap       → deny
 *   threadCount === 0     → allow with 0 calls (no-op fix-push, no threads to verify)
 *   otherwise             → allow
 */
export function estimateVerifierBudget(
  input: VerifierBudgetInput,
): VerifierBudgetVerdict {
  const cap = input.perPrCapUsd ?? DEFAULT_VERIFIER_PER_PR_CAP_USD;
  const passes = input.passesPerThread ?? 1;
  const calls = input.threadCount * Math.max(1, passes);
  const cost = calls * VERIFIER_PER_CALL_CEILING_USD;

  const estimate: VerifierBudgetEstimate = {
    estimatedCalls: calls,
    estimatedCostUsd: cost,
    perCallCeilingUsd: VERIFIER_PER_CALL_CEILING_USD,
    capUsd: cap,
  };

  if (input.billingExempt) {
    return { verdict: 'allow', estimate };
  }
  if (cost > cap) {
    return {
      verdict: 'deny',
      estimate,
      reason: friendlyVerifierDenyReason({ cost, cap, calls }),
    };
  }
  return { verdict: 'allow', estimate };
}

function friendlyVerifierDenyReason(args: {
  cost: number;
  cap: number;
  calls: number;
}): string {
  return [
    `clud-bug paused D.2.6 fix-verification — estimated cost`,
    `\`$${args.cost.toFixed(2)}\` exceeds the per-PR cap of`,
    `\`$${args.cap.toFixed(2)}\`. (${args.calls} planned verifier call${args.calls === 1 ? '' : 's'} ×`,
    `worst-case \`$${VERIFIER_PER_CALL_CEILING_USD.toFixed(2)}\` per call.)`,
    'Lower `autoResolve.max_threads_per_fix_push` in',
    '`.claude/skills/.clud-bug.json` or set `autoResolve.mode = "heuristic"`',
    'to opt out of verified-mode for this install.',
  ].join(' ');
}
