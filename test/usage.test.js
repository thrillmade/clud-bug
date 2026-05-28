import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  PRICING,
  computeReviewCost,
  costPerLOC,
  cacheHitRate,
  extractTokensFromLog,
  rollup,
  formatRollup,
} from '../lib/usage.js';

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

test('extractTokensFromLog: parses a single result-message JSON', () => {
  const log = `
    2026-05-28T15:44:31Z [info] Running...
    {"type": "result", "model": "claude-sonnet-4-6", "input_tokens": 1234, "output_tokens": 567, "cache_read_input_tokens": 8000, "cache_creation_input_tokens": 1000}
    2026-05-28T15:44:35Z [info] Done.
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

test('extractTokensFromLog: sums tokens across multiple result messages (multi-turn review)', () => {
  const log = `
    {"message": {"model": "claude-sonnet-4-6", "input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 0}}
    {"message": {"model": "claude-sonnet-4-6", "input_tokens": 200, "output_tokens": 75, "cache_read_input_tokens": 2000, "cache_creation_input_tokens": 0}}
  `;
  const result = extractTokensFromLog(log);
  assert.equal(result.ok, true);
  assert.equal(result.tokens.input_tokens, 300);          // 100 + 200
  assert.equal(result.tokens.output_tokens, 125);         // 50 + 75
  assert.equal(result.tokens.cache_read_input_tokens, 3000);
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

function fixture(repo, pr, modifier = {}) {
  return {
    repo,
    pr,
    createdAt: modifier.createdAt || '2026-05-25T00:00:00Z',
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
