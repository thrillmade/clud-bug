// src/cli/usage.ts — Q7-clud-bug $/LOC compute.
//
// Pure functions, no I/O. Driven from bin/clud-bug.js which fetches workflow
// run JSON + PR metadata via gh CLI. Implementation of the 0.0.M.1 dashboard
// per the Phase 0.5 plan.
//
// Reads:
//   - clud-bug-review job logs (via `gh api .../jobs/<id>/logs`), which
//     contain the SDK's `result` messages including:
//       "model": "claude-sonnet-4-6"
//       "input_tokens": N
//       "output_tokens": N
//       "cache_read_input_tokens": N
//       "cache_creation_input_tokens": N
//   - `gh pr view --json additions,deletions` for the LOC denominator.
//
// Computes:
//   $/LOC = total_cost(tokens, model) / (additions + deletions)
//
// Q7-clud-bug enforcement: dashboard reports the 30-day rolling trend; the
// next Phase 0.5 PR ships when the trend stops declining.

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Anthropic pricing as of 2026-05 (per MTok). Cache write is 1.25× input
// per Anthropic's published 5-min-TTL ephemeral cache rate.
export const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75,
  },
  'claude-haiku-4-5-20251001': {
    input: 0.80, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0,
  },
  'claude-opus-4-7': {
    input: 15.0, output: 75.0, cacheRead: 1.50, cacheWrite: 18.75,
  },
};

// Fallback when the model field is missing or new. Use Sonnet pricing —
// conservative for unknown-but-likely-Sonnet, undercounts Opus until we
// update the table. The `unknown` flag in the result lets callers warn.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface TokenCounts {
  input_tokens?: number | undefined;
  output_tokens?: number | undefined;
  cache_read_input_tokens?: number | undefined;
  cache_creation_input_tokens?: number | undefined;
}

export interface CostParts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ReviewCost {
  total: number;
  parts: CostParts;
  model: string;
  unknownModel: boolean;
}

/**
 * Compute the USD cost of a single clud-bug review from token counts +
 * model. All four token classes are billed independently.
 */
export function computeReviewCost(tokens: TokenCounts, model: string | null | undefined): ReviewCost {
  const t = {
    input: tokens.input_tokens || 0,
    output: tokens.output_tokens || 0,
    cacheRead: tokens.cache_read_input_tokens || 0,
    cacheWrite: tokens.cache_creation_input_tokens || 0,
  };
  const normalized = model && PRICING[model] ? model : DEFAULT_MODEL;
  // PRICING[normalized] is guaranteed to exist (normalized is either a
  // known key or DEFAULT_MODEL which is defined above). Non-null assert
  // to satisfy noUncheckedIndexedAccess.
  const p = PRICING[normalized]!;
  const parts: CostParts = {
    input: (t.input / 1e6) * p.input,
    output: (t.output / 1e6) * p.output,
    cacheRead: (t.cacheRead / 1e6) * p.cacheRead,
    cacheWrite: (t.cacheWrite / 1e6) * p.cacheWrite,
  };
  const total = parts.input + parts.output + parts.cacheRead + parts.cacheWrite;
  return {
    total,
    parts,
    model: normalized,
    unknownModel: !(model && PRICING[model]),
  };
}

/**
 * $/LOC for a single review. PR size denominator is additions + deletions
 * — the same metric `gh pr view --json additions,deletions` returns.
 *
 * Returns 0 if additions + deletions === 0 (avoid div-by-zero on
 * docs-only / empty PRs); callers can filter zero-LOC reviews out of
 * trend lines as outliers.
 */
export function costPerLOC(cost: number, additions: number | null | undefined, deletions: number | null | undefined): number {
  const loc = (additions || 0) + (deletions || 0);
  if (loc === 0) return 0;
  return cost / loc;
}

/**
 * Cache hit rate: cached_read / (cached_read + creation + input).
 * Cached creation is the cost of WRITING new entries (paid 1.25× per
 * Anthropic); cached read is what we get back at 10% of input price.
 * High hit rate proves the v0.6.3 caching layer is firing on
 * re-reviews and fix-pushes.
 */
export function cacheHitRate(tokens: TokenCounts): number {
  const read = tokens.cache_read_input_tokens || 0;
  const write = tokens.cache_creation_input_tokens || 0;
  const input = tokens.input_tokens || 0;
  const denom = read + write + input;
  if (denom === 0) return 0;
  return read / denom;
}

export interface ExtractedTokens {
  model: string | null;
  tokens: Required<TokenCounts> | null;
  ok: boolean;
}

/**
 * Parse the model + token counts from a clud-bug-review job log dump.
 *
 * PR #104 fix (token double-count): the SDK's stream-output emits a
 * `"type": "result"` event at the end of a review with a CUMULATIVE
 * `usage` block. It ALSO emits per-turn `"type": "assistant"` events
 * (each with its own usage), AND the result event's usage contains an
 * `iterations` array of per-message breakdowns. Naively summing every
 * `"input_tokens"` occurrence in the log would triple-or-more count
 * the same tokens.
 *
 * Right approach: locate the FINAL `"type": "result"` event and extract
 * the FIRST `"usage": {`-block within it. That's the cumulative bill,
 * the same number Anthropic charges. If no result event exists, the
 * review didn't complete successfully — return ok:false so the caller
 * skips this run rather than trusting partial token data.
 */
export function extractTokensFromLog(logText: unknown): ExtractedTokens {
  if (typeof logText !== 'string' || logText.length === 0) {
    return { model: null, tokens: null, ok: false };
  }

  // The LAST model field — final message wins (a multi-turn review
  // uses the same model throughout). Captured before the usage parse
  // so model is reported even when we can't find a result event.
  const modelMatches = [...logText.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
  // matchAll yields RegExpMatchArray entries; capture group 1 is the
  // model string. Under noUncheckedIndexedAccess every index is typed
  // possibly-undefined — coalesce so the return type stays string|null.
  const model: string | null = modelMatches.length > 0
    ? (modelMatches[modelMatches.length - 1]?.[1] ?? null)
    : null;

  // Locate the final result event. There may be multiple over the
  // life of a long-running session — take the LAST one.
  const resultMarkerRe = /"type"\s*:\s*"result"/g;
  let lastResultIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = resultMarkerRe.exec(logText)) !== null) {
    lastResultIdx = m.index;
  }

  if (lastResultIdx < 0) {
    // No result event — partial log or job that errored before
    // emitting one. Don't sum the per-turn fields; the data isn't
    // billable-equivalent.
    return { model, tokens: null, ok: false };
  }

  // Within the result event, find the first `"usage": {` and extract
  // its top-level token fields. We scope each field's regex to a window
  // starting at the usage block so we don't pick up the `iterations`
  // array's per-message fields (which are nested deeper but still
  // appear within the same overall result block).
  const fromResult = logText.slice(lastResultIdx);
  const usageIdx = fromResult.search(/"usage"\s*:\s*\{/);
  if (usageIdx < 0) {
    return { model, tokens: null, ok: false };
  }
  // Slice up to the start of `"iterations"` (if present) so we don't
  // double-count per-iteration breakdowns nested inside usage.
  const fromUsage = fromResult.slice(usageIdx);
  const iterationsIdx = fromUsage.search(/"iterations"\s*:/);
  const usageOnly = iterationsIdx >= 0
    ? fromUsage.slice(0, iterationsIdx)
    : fromUsage;

  const pluck = (re: RegExp): number => {
    const match = usageOnly.match(re);
    return match && match[1] !== undefined ? Number(match[1]) : 0;
  };

  const input = pluck(/"input_tokens"\s*:\s*(\d+)/);
  const output = pluck(/"output_tokens"\s*:\s*(\d+)/);
  const cacheRead = pluck(/"cache_read_input_tokens"\s*:\s*(\d+)/);
  const cacheWrite = pluck(/"cache_creation_input_tokens"\s*:\s*(\d+)/);

  const anyTokens = input + output + cacheRead + cacheWrite;
  if (anyTokens === 0) {
    return { model, tokens: null, ok: false };
  }

  return {
    model,
    tokens: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    },
    ok: true,
  };
}

export interface ReviewRecord {
  repo: string;
  pr: number;
  createdAt: string;
  model: string;
  tokens: TokenCounts;
  additions: number;
  deletions: number;
  cost: number;
  costPerLOC: number;
  cacheRate: number;
  unknownModel?: boolean | undefined;
  modelObserved?: string | undefined;
}

export interface RollupGroupStats {
  reviews: number;
  cost: number;
  loc: number;
  costPerLOC: number;
  cacheRate: number;
}

export interface RollupTotal {
  reviews: number;
  cost: number;
  loc: number;
  costPerLOC: number;
  cacheRate: number;
}

export interface RollupTrend {
  current: number;
  previous: number | null;
  slopePct: number | null;
}

export interface RollupOutlier {
  repo: string;
  pr: number;
  costPerLOC: number;
  multiple: number;
  cost: number;
  reason: string;
}

export interface UnknownModelReview {
  repo: string;
  pr: number;
  modelObserved: string | undefined;
}

export interface Rollup {
  total: RollupTotal;
  perRepo: Record<string, RollupGroupStats>;
  perModel: Record<string, RollupGroupStats>;
  trend30d: RollupTrend;
  outliers: RollupOutlier[];
  unknownModelReviews: UnknownModelReview[];
}

// Internal mutable form used during group-by build-up — the *s arrays
// disappear before return; we type the in-progress shape separately.
interface GroupAccumulator {
  reviews: number;
  cost: number;
  loc: number;
  costPerLOCs: number[];
  cacheRates: number[];
  costPerLOC?: number;
  cacheRate?: number;
}

/**
 * Roll up an array of per-review records into a structured summary.
 *
 * Pre-conditions: callers should drop zero-LOC reviews before passing in.
 */
export function rollup(reviews: ReviewRecord[]): Rollup {
  const valid = reviews.filter((r) => r.costPerLOC > 0);

  const total: RollupTotal = {
    reviews: valid.length,
    cost: valid.reduce((a, r) => a + r.cost, 0),
    loc: valid.reduce((a, r) => a + (r.additions + r.deletions), 0),
    costPerLOC: median(valid.map((r) => r.costPerLOC)),
    cacheRate: median(valid.map((r) => r.cacheRate)),
  };

  const groupBy = (key: 'repo' | 'model'): Record<string, RollupGroupStats> => {
    const out: Record<string, GroupAccumulator> = {};
    for (const r of valid) {
      const k = String(r[key]);
      let bucket = out[k];
      if (!bucket) {
        bucket = { reviews: 0, cost: 0, loc: 0, costPerLOCs: [], cacheRates: [] };
        out[k] = bucket;
      }
      bucket.reviews += 1;
      bucket.cost += r.cost;
      bucket.loc += r.additions + r.deletions;
      bucket.costPerLOCs.push(r.costPerLOC);
      bucket.cacheRates.push(r.cacheRate);
    }
    const finalized: Record<string, RollupGroupStats> = {};
    for (const k of Object.keys(out)) {
      const bucket = out[k]!;
      finalized[k] = {
        reviews: bucket.reviews,
        cost: bucket.cost,
        loc: bucket.loc,
        costPerLOC: median(bucket.costPerLOCs),
        cacheRate: median(bucket.cacheRates),
      };
    }
    return finalized;
  };

  const perRepo = groupBy('repo');
  const perModel = groupBy('model');

  // Outliers: > 2× total.costPerLOC.
  const outliers: RollupOutlier[] = valid
    .filter((r) => r.costPerLOC > total.costPerLOC * 2)
    .map((r) => ({
      repo: r.repo,
      pr: r.pr,
      costPerLOC: r.costPerLOC,
      multiple: r.costPerLOC / total.costPerLOC,
      cost: r.cost,
      reason: r.cacheRate < 0.3 ? 'low cache hit' : 'unknown',
    }));

  // 30-day trend: median $/LOC per calendar day. Bucket by createdAt date.
  // Slope reported as MoM % change between the most recent 30-day window's
  // median and the previous 30-day window's median.
  const trend30d = computeTrend(valid);

  // PR #104 fix: surface reviews whose model wasn't in PRICING. The
  // computeReviewCost fallback applied Sonnet rates to unknown models
  // (~5× undercount of Opus), AND bucketed them under Sonnet in the
  // per-model table — exactly the false-good signal Q7 must NOT produce.
  // Caller renders this as a loud warning so the dashboard reader knows
  // to update the PRICING table.
  const unknownModelReviews: UnknownModelReview[] = valid
    .filter((r) => r.unknownModel === true)
    .map((r) => ({ repo: r.repo, pr: r.pr, modelObserved: r.modelObserved }));

  return { total, perRepo, perModel, trend30d, outliers, unknownModelReviews };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // sorted is non-empty here so sorted[mid] is defined; the `!`
  // satisfies noUncheckedIndexedAccess and matches JS semantics.
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function computeTrend(reviews: ReviewRecord[]): RollupTrend {
  // PR #104 fix: distinguish "no prior window" (previous bucket empty)
  // from "exactly flat trend" (current === previous > 0). The original
  // code returned slopePct=0 for both, which masked the dangerous case
  // — a stable expensive month-over-month trend rendered as if there
  // were no comparison data, hiding the very signal Q7 enforces.
  // `previous: null` now means "no prior window"; renderer keys on this.
  if (reviews.length === 0) {
    return { current: 0, previous: null, slopePct: null };
  }
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const currentWindow = reviews.filter((r) => now - new Date(r.createdAt).getTime() <= 30 * day);
  const previousWindow = reviews.filter((r) => {
    const age = now - new Date(r.createdAt).getTime();
    return age > 30 * day && age <= 60 * day;
  });
  const current = median(currentWindow.map((r) => r.costPerLOC));
  if (previousWindow.length === 0) {
    return { current, previous: null, slopePct: null };
  }
  const previous = median(previousWindow.map((r) => r.costPerLOC));
  // previous > 0 because every review in valid[] has costPerLOC > 0
  // (zero-LOC reviews dropped upstream).
  const slopePct = previous > 0 ? ((current - previous) / previous) * 100 : null;
  return { current, previous, slopePct };
}

export interface FormatRollupOptions {
  json?: boolean | undefined;
}

/**
 * Render the rollup as a human-readable table. Mirrors the sample output
 * from the Phase 0.5 plan.
 *
 * Pass `{ json: true }` for the machine-readable form (the same data
 * the rollup() function returns).
 */
export function formatRollup(rollup: Rollup, opts: FormatRollupOptions = {}): string {
  if (opts.json) {
    return JSON.stringify(rollup, null, 2);
  }
  const lines: string[] = [];
  const t = rollup.total;
  const trend = rollup.trend30d;
  // PR #104 fix: null slopePct = "no prior window" (prior 30d bucket
  // was empty). A REAL 0% slope (flat trend) renders as "→ 0% MoM",
  // not as "(no prior window)" — masking the latter was the bug.
  let trendStr;
  if (trend.slopePct === null) {
    trendStr = '(no prior window)';
  } else {
    const trendArrow = trend.slopePct < 0 ? '↓' : trend.slopePct > 0 ? '↑' : '→';
    trendStr = `${trendArrow} ${trend.slopePct.toFixed(0)}% MoM`;
  }
  lines.push(`ok: ${t.reviews} reviews, 30-day $/LOC trend: ${trendStr}`);

  const perRepoEntries = Object.entries(rollup.perRepo)
    .sort((a, b) => b[1].costPerLOC - a[1].costPerLOC);
  if (perRepoEntries.length > 0) {
    lines.push('  per-repo $/LOC (most → least expensive):');
    for (const [repo, stats] of perRepoEntries) {
      const cache = `${(stats.cacheRate * 100).toFixed(0)}% cached`;
      lines.push(
        `    ${repo.padEnd(28)} ${`$${stats.costPerLOC.toFixed(4)}/LOC`.padEnd(16)} · ${String(stats.reviews).padStart(2)} reviews · ${cache}`
      );
    }
  }

  lines.push(
    `  org median $/LOC: $${t.costPerLOC.toFixed(4)} · org cache hit: ${(t.cacheRate * 100).toFixed(0)}%`
  );
  lines.push(`  total spend: $${t.cost.toFixed(2)} across ${(t.loc).toLocaleString()} LOC`);

  if (rollup.outliers.length > 0) {
    lines.push(`  outliers (>2× median):`);
    for (const o of rollup.outliers) {
      lines.push(
        `    ${o.repo}#${o.pr} ($${o.costPerLOC.toFixed(4)}/LOC, ${o.multiple.toFixed(1)}× median — ${o.reason})`
      );
    }
  }

  // PR #104 fix: loud warning when one or more reviews used a model
  // not in PRICING (we fell back to Sonnet rates — that can undercount
  // by ~5× if the real model was an Opus variant). Update PRICING and
  // re-run.
  if (rollup.unknownModelReviews && rollup.unknownModelReviews.length > 0) {
    lines.push(
      `  ⚠️  ${rollup.unknownModelReviews.length} review${rollup.unknownModelReviews.length === 1 ? '' : 's'} used model${rollup.unknownModelReviews.length === 1 ? '' : 's'} not in PRICING; cost may be undercounted:`
    );
    const observed = new Set(rollup.unknownModelReviews.map((u) => u.modelObserved));
    for (const m of observed) {
      lines.push(`    seen: "${m}" — add to lib/usage.js PRICING table`);
    }
  }

  return lines.join('\n') + '\n';
}
