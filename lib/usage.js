// lib/usage.js — Q7-clud-bug $/LOC compute.
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

// Anthropic pricing as of 2026-05 (per MTok). Cache write is 1.25× input
// per Anthropic's published 5-min-TTL ephemeral cache rate.
export const PRICING = {
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

/**
 * Compute the USD cost of a single clud-bug review from token counts +
 * model. All four token classes are billed independently.
 *
 * Returns:
 *   {
 *     total: number  USD,
 *     parts: { input, output, cacheRead, cacheWrite } USD breakdown,
 *     model: string (normalized),
 *     unknownModel: boolean (true if we used DEFAULT_MODEL pricing),
 *   }
 */
export function computeReviewCost(tokens, model) {
  const t = {
    input: tokens.input_tokens || 0,
    output: tokens.output_tokens || 0,
    cacheRead: tokens.cache_read_input_tokens || 0,
    cacheWrite: tokens.cache_creation_input_tokens || 0,
  };
  const normalized = model && PRICING[model] ? model : DEFAULT_MODEL;
  const p = PRICING[normalized];
  const parts = {
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
export function costPerLOC(cost, additions, deletions) {
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
export function cacheHitRate(tokens) {
  const read = tokens.cache_read_input_tokens || 0;
  const write = tokens.cache_creation_input_tokens || 0;
  const input = tokens.input_tokens || 0;
  const denom = read + write + input;
  if (denom === 0) return 0;
  return read / denom;
}

/**
 * Parse the model + token counts from a clud-bug-review job log dump.
 * The `gh api .../jobs/<id>/logs` output interleaves the SDK's result
 * messages (multi-line JSON blobs) with shell trace. We extract the
 * LAST `"model"` and the totals of each token-class field.
 *
 * Why totals: a single review may emit several `result` messages
 * across turns. The total is the sum we're billed for; the model is the
 * last (final) message's model (they should all match — the pin
 * doesn't change mid-review).
 *
 * Returns:
 *   {
 *     model: string | null,
 *     tokens: { input, output, cacheRead, cacheWrite } | null,
 *     ok: boolean (false if no tokens found — job probably errored),
 *   }
 */
export function extractTokensFromLog(logText) {
  if (typeof logText !== 'string' || logText.length === 0) {
    return { model: null, tokens: null, ok: false };
  }

  // Find every occurrence of each field. JSON lives mid-line in the log;
  // anchor the regex to the JSON-key shape so we don't catch stray quoted
  // strings.
  const sum = (re) => {
    const matches = [...logText.matchAll(re)];
    return matches.reduce((acc, m) => acc + Number(m[1] || 0), 0);
  };

  const input = sum(/"input_tokens"\s*:\s*(\d+)/g);
  const output = sum(/"output_tokens"\s*:\s*(\d+)/g);
  const cacheRead = sum(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
  const cacheWrite = sum(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);

  // The LAST model field — final result message wins (a multi-turn
  // review keeps the same model anyway; this is just the deterministic
  // pick).
  const modelMatches = [...logText.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
  const model = modelMatches.length > 0
    ? modelMatches[modelMatches.length - 1][1]
    : null;

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

/**
 * Roll up an array of per-review records into a structured summary.
 *
 * Each review record:
 *   {
 *     repo: "owner/name",
 *     pr: number,
 *     createdAt: ISO 8601,
 *     model: string,
 *     tokens: { ... },
 *     additions: number,
 *     deletions: number,
 *     cost: number (USD, total),
 *     costPerLOC: number,
 *     cacheRate: number (0..1),
 *   }
 *
 * Returns:
 *   {
 *     total: { reviews, cost, loc, costPerLOC (median), cacheRate (median) },
 *     perRepo: { [repo]: { ... } },
 *     perModel: { [model]: { ... } },
 *     trend30d: { dailyMedians: [...], slopePct (MoM) },
 *     outliers: [{ review, severity }],
 *   }
 *
 * Pre-conditions: callers should drop zero-LOC reviews before passing in.
 */
export function rollup(reviews) {
  const valid = reviews.filter((r) => r.costPerLOC > 0);

  const total = {
    reviews: valid.length,
    cost: valid.reduce((a, r) => a + r.cost, 0),
    loc: valid.reduce((a, r) => a + (r.additions + r.deletions), 0),
    costPerLOC: median(valid.map((r) => r.costPerLOC)),
    cacheRate: median(valid.map((r) => r.cacheRate)),
  };

  const groupBy = (key) => {
    const out = {};
    for (const r of valid) {
      const k = r[key];
      if (!out[k]) out[k] = { reviews: 0, cost: 0, loc: 0, costPerLOCs: [], cacheRates: [] };
      out[k].reviews += 1;
      out[k].cost += r.cost;
      out[k].loc += r.additions + r.deletions;
      out[k].costPerLOCs.push(r.costPerLOC);
      out[k].cacheRates.push(r.cacheRate);
    }
    for (const k of Object.keys(out)) {
      out[k].costPerLOC = median(out[k].costPerLOCs);
      out[k].cacheRate = median(out[k].cacheRates);
      delete out[k].costPerLOCs;
      delete out[k].cacheRates;
    }
    return out;
  };

  const perRepo = groupBy('repo');
  const perModel = groupBy('model');

  // Outliers: > 2× total.costPerLOC.
  const outliers = valid
    .filter((r) => r.costPerLOC > total.costPerLOC * 2)
    .map((r) => ({
      repo: r.repo, pr: r.pr,
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
  const unknownModelReviews = valid
    .filter((r) => r.unknownModel === true)
    .map((r) => ({ repo: r.repo, pr: r.pr, modelObserved: r.modelObserved }));

  return { total, perRepo, perModel, trend30d, outliers, unknownModelReviews };
}

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function computeTrend(reviews) {
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

/**
 * Render the rollup as a human-readable table. Mirrors the sample output
 * from the Phase 0.5 plan.
 *
 * Pass `{ json: true }` for the machine-readable form (the same data
 * the rollup() function returns).
 */
export function formatRollup(rollup, opts = {}) {
  if (opts.json) {
    return JSON.stringify(rollup, null, 2);
  }
  const lines = [];
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
