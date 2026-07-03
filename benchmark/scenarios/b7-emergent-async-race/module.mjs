// module.mjs — the "PR under review".
//
// Ingest a batch of metric samples and roll them up into per-metric
// accumulators: a running `sum` of normalized values and a `count` of how many
// samples landed in each metric. Normalization is async because in the real
// system it consults a unit-conversion table over the network; here it is
// stubbed but kept async so the control-flow shape matches production.
//
// Samples are normalized concurrently for throughput — a hot ingest path
// shouldn't serialize network-bound normalization one sample at a time. Every
// individual step below (default an empty bucket, await the normalizer, fold
// the value in) is ordinary and correct on its own line. The defect is
// emergent: it only appears once separate iterations for the same metric race
// through the read-modify-write that straddles the await.

/**
 * Async unit-normalizer. In production this consults a conversion table / cache;
 * here it just rounds to an integer. Returns a promise, so callers must await.
 */
export async function normalizeSample(value) {
  // Simulate an async lookup (conversion table, remote cache, ...).
  await Promise.resolve();
  return Math.round(value);
}

/**
 * Roll a batch of `{ metric, value }` samples up into
 * `{ [metric]: { sum, count } }`. Samples are normalized concurrently.
 * @param {{ metric: string, value: number }[]} samples
 * @returns {Promise<Record<string, { sum: number, count: number }>>}
 */
export async function aggregate(samples) {
  const totals = {};

  await Promise.all(
    samples.map(async (sample) => {
      // Read the metric's current running bucket (or start a fresh one).
      const bucket = totals[sample.metric] ?? { sum: 0, count: 0 };
      // Normalize this sample's value (async).
      const value = await normalizeSample(sample.value);
      // Fold it in: one more sample, its value added to the running sum.
      totals[sample.metric] = {
        sum: bucket.sum + value,
        count: bucket.count + 1,
      };
    })
  );

  return totals;
}

/** Convenience: total number of samples folded across all metrics. */
export async function totalCount(samples) {
  const totals = await aggregate(samples);
  return Object.values(totals).reduce((n, b) => n + b.count, 0);
}

/** Convenience: the metric carrying the largest running sum. */
export async function heaviestMetric(samples) {
  const totals = await aggregate(samples);
  let best = null;
  for (const [metric, bucket] of Object.entries(totals)) {
    if (!best || bucket.sum > best.sum) best = { metric, sum: bucket.sum };
  }
  return best ? best.metric : null;
}
