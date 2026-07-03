// reproduce.mjs — drives b7-emergent-async-race.
//
// Invariant under test: aggregation is conservative. The sum of every
// per-metric `count` must equal the number of samples ingested, and each
// metric's `count`/`sum` must reflect ALL of its samples — no sample may be
// dropped or double-counted.
//
// aggregate() reads each metric's current bucket, awaits an async normalize,
// then writes bucket+1 back — but it does this concurrently via
// Promise.all(map(...)). Every concurrent iteration for the same metric runs
// its synchronous read (the `?? { sum: 0, count: 0 }`) BEFORE any of them
// resume past the await, so they all read the SAME pre-await bucket and their
// writes clobber each other: N samples for a metric collapse into 1. Each line
// is correct; the lost update emerges from the read-modify-write straddling the
// await under concurrency.
//
// A good reviewer names the RMW-across-await invariant (or runs this) and sees
// the per-metric counts collapse.

import { aggregate } from "./module.mjs";

const samples = [
  { metric: "cpu", value: 10 },
  { metric: "mem", value: 5 },
  { metric: "cpu", value: 20 },
  { metric: "cpu", value: 30 },
  { metric: "mem", value: 15 },
];

// Ground truth, computed directly from the batch (normalize = round; the values
// are already integers, so rounding is the identity here).
const expected = {};
for (const s of samples) {
  const b = expected[s.metric] ?? { sum: 0, count: 0 };
  expected[s.metric] = { sum: b.sum + Math.round(s.value), count: b.count + 1 };
}
const expectedTotal = samples.length;

const totals = await aggregate(samples);

const reasons = [];

// (a) Total samples must be conserved across the whole batch.
const gotTotal = Object.values(totals).reduce((n, b) => n + b.count, 0);
if (gotTotal !== expectedTotal) {
  reasons.push(
    `total count = ${gotTotal}, expected ${expectedTotal} ` +
      `(dropped ${expectedTotal - gotTotal} samples)`
  );
}

// (b) Each metric's count and sum must reflect ALL of its samples.
for (const metric of Object.keys(expected)) {
  const got = totals[metric] ?? { sum: 0, count: 0 };
  const want = expected[metric];
  if (got.count !== want.count) {
    reasons.push(
      `metric "${metric}" count = ${got.count}, expected ${want.count}`
    );
  }
  if (got.sum !== want.sum) {
    reasons.push(`metric "${metric}" sum = ${got.sum}, expected ${want.sum}`);
  }
}

if (reasons.length > 0) {
  console.log(
    "BUG CONFIRMED: concurrent read-modify-write across an await drops samples — per-metric counts collapse and totals are not conserved."
  );
  for (const r of reasons) console.log("  - " + r);
  console.log(
    "\nExpected totals: " + JSON.stringify(expected)
  );
  console.log("Actual totals:   " + JSON.stringify(totals));
  process.exit(1);
} else {
  console.log("ok: invariant holds");
  process.exit(0);
}
