import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  PRICING,
  computeReviewCost,
  costPerLOC,
  cacheHitRate,
  extractTokensFromLog,
  rollup,
  formatRollup,
} from '../src/cli/usage.js';

// --- PRICING table ---

test('PRICING: Sonnet 4.6 input is $3/MTok, cache read is $0.30/MTok (10% of input)', () => {
  assert.equal(PRICING['claude-sonnet-4-6'].input, 3.0);
  assert.equal(PRICING['claude-sonnet-4-6'].cacheRead, 0.30);
  // Sonnet output is 5× input per Anthropic's published table.
  assert.equal(PRICING['claude-sonnet-4-6'].output, 15.0);
});

test('PRICING: Haiku 4.5 input is $0.80/MTok — ~1/4 Sonnet', () => {
  assert.equal(PRICING['claude-haiku-4-5-20251001'].input, 0.80);
  // Cache read is 10% of input.
  assert.equal(PRICING['claude-haiku-4-5-20251001'].cacheRead, 0.08);
});

test('PRICING: Opus 4.7 is the priciest tier — 5× Sonnet input', () => {
  assert.equal(PRICING['claude-opus-4-7'].input, 15.0);
});

// --- computeReviewCost ---

test('computeReviewCost: standard Sonnet review with cache hits', () => {
  const tokens = {
    input_tokens: 1000,             // 1k uncached input → $0.003
    output_tokens: 500,             // 500 output → $0.0075
    cache_read_input_tokens: 10000, // 10k cache reads → $0.003
    cache_creation_input_tokens: 0,
  };
  const result = computeReviewCost(tokens, 'claude-sonnet-4-6');
  // 0.003 + 0.0075 + 0.003 + 0 = 0.0135
  assert.equal(result.total.toFixed(6), '0.013500');
  assert.equal(result.model, 'claude-sonnet-4-6');
  assert.equal(result.unknownModel, false);
});

test('computeReviewCost: unknown model falls back to Sonnet pricing + flags unknown', () => {
  const tokens = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const result = computeReviewCost(tokens, 'claude-future-9-9');
  assert.equal(result.total, 3.0);                  // Sonnet price applied
  assert.equal(result.model, 'claude-sonnet-4-6');  // normalized to default
  assert.equal(result.unknownModel, true);
});

test('computeReviewCost: missing model also falls back to default + flags unknown', () => {
  const tokens = { input_tokens: 1e6 };
  const result = computeReviewCost(tokens, null);
  assert.equal(result.unknownModel, true);
});

test('computeReviewCost: zero tokens → zero cost', () => {
  const result = computeReviewCost({}, 'claude-sonnet-4-6');
  assert.equal(result.total, 0);
});

test('computeReviewCost: Haiku is ~5× cheaper than Sonnet for identical token mix', () => {
  const tokens = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const sonnet = computeReviewCost(tokens, 'claude-sonnet-4-6').total;
  const haiku = computeReviewCost(tokens, 'claude-haiku-4-5-20251001').total;
  // Sonnet $3, Haiku $0.80 → ratio ~3.75
  assert.ok(sonnet / haiku > 3.5 && sonnet / haiku < 4.0, `ratio: ${sonnet / haiku}`);
});

// --- costPerLOC ---

test('costPerLOC: $0.0135 / (100 + 50) = $0.00009 per LOC', () => {
  const result = costPerLOC(0.0135, 100, 50);
  assert.equal(result.toFixed(6), '0.000090');
});

test('costPerLOC: zero LOC → 0 (no div-by-zero)', () => {
  assert.equal(costPerLOC(0.50, 0, 0), 0);
});

test('costPerLOC: only additions or only deletions count too', () => {
  assert.equal(costPerLOC(0.10, 100, 0).toFixed(6), '0.001000');
  assert.equal(costPerLOC(0.10, 0, 100).toFixed(6), '0.001000');
});

// --- cacheHitRate ---

test('cacheHitRate: heavy cache hit case → ~95%', () => {
  const tokens = { cache_read_input_tokens: 19000, cache_creation_input_tokens: 1000, input_tokens: 0 };
  // 19k / (19k + 1k + 0) = 0.95
  assert.equal(cacheHitRate(tokens), 0.95);
});

test('cacheHitRate: first review in window (cache write only) → 0%', () => {
  const tokens = { cache_read_input_tokens: 0, cache_creation_input_tokens: 50000, input_tokens: 10000 };
  assert.equal(cacheHitRate(tokens), 0);
});

test('cacheHitRate: zero tokens → 0', () => {
  assert.equal(cacheHitRate({}), 0);
});

// --- extractTokensFromLog ---

test('extractTokensFromLog: parses tokens from the result-event usage block', () => {
  const log = `
    "type": "result",
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567,
      "cache_read_input_tokens": 8000,
      "cache_creation_input_tokens": 1000
    }
    "model": "claude-sonnet-4-6"
  `;
  const result = extractTokensFromLog(log);
  assert.equal(result.ok, true);
  assert.equal(result.model, 'claude-sonnet-4-6');
  assert.deepEqual(result.tokens, {
    input_tokens: 1234,
    output_tokens: 567,
    cache_read_input_tokens: 8000,
    cache_creation_input_tokens: 1000,
  });
});

test('extractTokensFromLog: PR #104 regression — does NOT double-count assistant turns', () => {
  // The SDK emits a "type": "assistant" event per turn AND a final
  // "type": "result" event with CUMULATIVE usage. A naive regex
  // summing every "input_tokens" occurrence in the log would
  // double-count (or more). Real log shape:
  const log = `
    "type": "assistant", "message": { "usage": { "input_tokens": 10 } }
    "type": "assistant", "message": { "usage": { "input_tokens": 20 } }
    "type": "result",
    "usage": {
      "input_tokens": 35,
      "output_tokens": 7000,
      "cache_read_input_tokens": 1000000,
      "cache_creation_input_tokens": 60000
    }
  `;
  const result = extractTokensFromLog(log);
  // The billed value is the result-event's 35, NOT 10 + 20 + 35 = 65.
  assert.equal(result.tokens.input_tokens, 35,
    'must use result-event cumulative usage, not sum of per-turn assistants');
  assert.equal(result.tokens.cache_read_input_tokens, 1000000);
});

test('extractTokensFromLog: ignores iterations array within usage (real SDK shape)', () => {
  // The result-event's usage block contains an `iterations` array of
  // per-message breakdowns. Their per-iteration fields must NOT pollute
  // the top-level usage extraction. Matches the structure seen in
  // logmind PR #72 logs.
  const log = `
    "type": "result",
    "usage": {
      "input_tokens": 35,
      "output_tokens": 7000,
      "cache_read_input_tokens": 1000000,
      "cache_creation_input_tokens": 60000,
      "iterations": [
        {
          "input_tokens": 999,
          "cache_read_input_tokens": 99999,
          "cache_creation_input_tokens": 1410
        }
      ]
    }
  `;
  const result = extractTokensFromLog(log);
  assert.equal(result.tokens.input_tokens, 35,
    'must skip the iterations[].input_tokens (999); use top-level usage only');
  assert.equal(result.tokens.cache_read_input_tokens, 1000000);
});

test('extractTokensFromLog: no result event → ok:false (partial / errored job)', () => {
  // Job hit a spend cap or API error before emitting a result event.
  // Returning ok:false makes the dashboard skip the run rather than
  // trust partial per-turn usage data.
  const log = `
    "type": "assistant", "message": { "usage": { "input_tokens": 100 } }
    [error] API Error: 400 spend cap exceeded
  `;
  assert.equal(extractTokensFromLog(log).ok, false);
});

test('extractTokensFromLog: empty log returns ok:false', () => {
  assert.equal(extractTokensFromLog('').ok, false);
  assert.equal(extractTokensFromLog(null).ok, false);
});

test('extractTokensFromLog: log without token fields returns ok:false (job errored)', () => {
  const log = '2026-05-28T15:44:35Z [error] API Error: 400 spend cap';
  assert.equal(extractTokensFromLog(log).ok, false);
});

// --- rollup ---

// Default fixture createdAt is "7 days ago" relative to test-run time —
// keeps the fixture inside the rollup's 30-day current window even as the
// system clock advances. Previously a hardcoded literal (2026-05-25) drifted
// outside the window once the calendar moved on, inverting the "no prior
// window" test semantics. The relative form is stable across clock motion.
const DEFAULT_FIXTURE_CREATED_AT = new Date(
  Date.now() - 7 * 24 * 60 * 60 * 1000,
).toISOString();

function fixture(repo, pr, modifier = {}) {
  return {
    repo,
    pr,
    createdAt: modifier.createdAt || DEFAULT_FIXTURE_CREATED_AT,
    model: modifier.model || 'claude-sonnet-4-6',
    tokens: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
    additions: modifier.additions ?? 100,
    deletions: modifier.deletions ?? 50,
    cost: modifier.cost ?? 0.015,
    costPerLOC: modifier.costPerLOC ?? 0.0001,
    cacheRate: modifier.cacheRate ?? 0.9,
  };
}

test('rollup: drops zero-LOC reviews from the trend (avoids div-by-zero outliers)', () => {
  const reviews = [
    fixture('repo/a', 1, { costPerLOC: 0 }),  // dropped
    fixture('repo/a', 2, { costPerLOC: 0.0002 }),
  ];
  const result = rollup(reviews);
  assert.equal(result.total.reviews, 1);
});

test('rollup: per-repo and per-model bucketing', () => {
  const reviews = [
    fixture('repo/a', 1, { model: 'claude-sonnet-4-6', cost: 0.10, costPerLOC: 0.001 }),
    fixture('repo/a', 2, { model: 'claude-sonnet-4-6', cost: 0.20, costPerLOC: 0.002 }),
    fixture('repo/b', 3, { model: 'claude-haiku-4-5-20251001', cost: 0.05, costPerLOC: 0.0005 }),
  ];
  const result = rollup(reviews);
  assert.equal(result.perRepo['repo/a'].reviews, 2);
  assert.equal(result.perRepo['repo/b'].reviews, 1);
  assert.ok(result.perModel['claude-sonnet-4-6'].reviews === 2);
  assert.ok(result.perModel['claude-haiku-4-5-20251001'].reviews === 1);
});

test('rollup: outliers are > 2× the org median costPerLOC', () => {
  const reviews = [
    fixture('repo/a', 1, { costPerLOC: 0.001 }),
    fixture('repo/a', 2, { costPerLOC: 0.001 }),
    fixture('repo/a', 3, { costPerLOC: 0.001 }),
    fixture('repo/b', 4, { costPerLOC: 0.003 }),  // 3× median → outlier
  ];
  const result = rollup(reviews);
  assert.equal(result.outliers.length, 1);
  assert.equal(result.outliers[0].pr, 4);
});

test('rollup: 30-day vs prior 30-day trend slope (negative = good, monotonically declining)', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = new Date(now - 10 * day).toISOString();
  const older = new Date(now - 45 * day).toISOString();
  const reviews = [
    fixture('repo/a', 1, { createdAt: recent, costPerLOC: 0.0010 }),
    fixture('repo/a', 2, { createdAt: older,  costPerLOC: 0.0020 }),  // 100% higher previously
  ];
  const result = rollup(reviews);
  // current = 0.001, previous = 0.002, slope = -50%
  assert.ok(result.trend30d.slopePct < -40);
});

// PR #104 fix: computeTrend distinguishes "no prior window" (previous=null)
// from "exactly flat trend" (previous>0, slopePct=0). The original code
// reported slopePct=0 for both, masking the dangerous flat-expensive case.

test('rollup: no prior window → slopePct null, previous null (not 0)', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = new Date(now - 10 * day).toISOString();
  // Only recent reviews; previous bucket (30–60d ago) is empty.
  const reviews = [
    fixture('repo/a', 1, { createdAt: recent, costPerLOC: 0.0010 }),
    fixture('repo/a', 2, { createdAt: recent, costPerLOC: 0.0011 }),
  ];
  const result = rollup(reviews);
  assert.equal(result.trend30d.previous, null,
    'previous=null marks "no prior window" so the renderer can distinguish from a real flat trend');
  assert.equal(result.trend30d.slopePct, null,
    'slopePct=null when there is no prior window — DO NOT collapse to 0');
});

test('rollup: real flat trend → slopePct 0, previous > 0 (NOT null)', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = new Date(now - 10 * day).toISOString();
  const older = new Date(now - 45 * day).toISOString();
  const reviews = [
    fixture('repo/a', 1, { createdAt: recent, costPerLOC: 0.0020 }),
    fixture('repo/a', 2, { createdAt: older,  costPerLOC: 0.0020 }),  // same as current → flat
  ];
  const result = rollup(reviews);
  assert.equal(result.trend30d.slopePct, 0,
    'real flat trend → slopePct=0 (so the gradient gate fires on actual stagnation)');
  assert.ok(result.trend30d.previous > 0,
    'previous>0 (NOT null) — there IS a prior window with data');
});

test('formatRollup: distinguishes "no prior window" from real flat trend', () => {
  const noPrior = rollup([fixture('r/a', 1, { costPerLOC: 0.001 })]);
  const noPriorOut = formatRollup(noPrior);
  assert.match(noPriorOut, /\(no prior window\)/);

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const flat = rollup([
    fixture('r/a', 1, { createdAt: new Date(now - 10 * day).toISOString(), costPerLOC: 0.001 }),
    fixture('r/a', 2, { createdAt: new Date(now - 45 * day).toISOString(), costPerLOC: 0.001 }),
  ]);
  const flatOut = formatRollup(flat);
  assert.doesNotMatch(flatOut, /\(no prior window\)/,
    'a real flat trend must NOT render as "no prior window" — masks the Q7 stagnation signal');
  assert.match(flatOut, /→ 0% MoM/);
});

// PR #104 fix: rollup must surface reviews whose model wasn't in PRICING.
// The compute fallback applied Sonnet rates (under-counting Opus by ~5×).

test('rollup: surfaces unknownModelReviews so the dashboard can warn', () => {
  const reviews = [
    {
      ...fixture('r/a', 1, { costPerLOC: 0.001 }),
      unknownModel: false,
      modelObserved: 'claude-sonnet-4-6',
    },
    {
      ...fixture('r/a', 2, { costPerLOC: 0.002 }),
      unknownModel: true,                            // future model variant
      modelObserved: 'claude-opus-4-7-20251218',
    },
  ];
  const result = rollup(reviews);
  assert.equal(result.unknownModelReviews.length, 1);
  assert.equal(result.unknownModelReviews[0].modelObserved, 'claude-opus-4-7-20251218');
});

test('formatRollup: loud warning when unknownModelReviews exists', () => {
  const reviews = [
    {
      ...fixture('r/a', 1, { costPerLOC: 0.001 }),
      unknownModel: true,
      modelObserved: 'claude-opus-4-7-20251218',
    },
  ];
  const result = rollup(reviews);
  const out = formatRollup(result);
  assert.match(out, /not in PRICING/);
  assert.match(out, /claude-opus-4-7-20251218/);
});

// --- formatRollup ---

test('formatRollup: human-readable summary contains ok line + per-repo + median', () => {
  const reviews = [fixture('thrillmade/logmind', 73, { costPerLOC: 0.0021 })];
  const summary = rollup(reviews);
  const out = formatRollup(summary);
  assert.match(out, /ok: 1 reviews/);
  assert.match(out, /thrillmade\/logmind/);
  assert.match(out, /\$0\.0021/);
});

test('formatRollup: JSON output is parseable + matches summary shape', () => {
  const summary = rollup([fixture('repo/a', 1, { costPerLOC: 0.001 })]);
  const json = formatRollup(summary, { json: true });
  const parsed = JSON.parse(json);
  assert.ok(parsed.total);
  assert.ok(parsed.perRepo);
  assert.ok(parsed.perModel);
  assert.ok(parsed.trend30d);
});
