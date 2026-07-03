// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives the backfill (module.mjs) and checks the invariant the PR claims to
// establish: the persisted stream is in ascending timestamp order, with each
// day's 09:00 snapshot appearing BEFORE that day's real transactions.

import { backfill } from './module.mjs';

// Two active days, each with real transactions at 10:00 and 14:00.
// `existing` is already in chronological order, exactly as backfill assumes.
const existing = [
  { ts: '2026-03-01T10:00:00Z', kind: 'txn', value: 100 },
  { ts: '2026-03-01T14:00:00Z', kind: 'txn', value: 200 },
  { ts: '2026-03-02T10:00:00Z', kind: 'txn', value: 300 },
  { ts: '2026-03-02T14:00:00Z', kind: 'txn', value: 400 },
];

const out = backfill(existing);

const order = out.map((r) => `${r.ts} ${r.kind}`);
console.log('resulting order:');
for (const line of order) console.log('  ' + line);

// Invariant 1: the full stream must be non-decreasing by timestamp.
let chronoOk = true;
for (let i = 1; i < out.length; i++) {
  if (out[i].ts < out[i - 1].ts) {
    chronoOk = false;
    break;
  }
}

// Invariant 2: each day's 09:00 snapshot must precede that day's first txn.
let snapshotFirst = true;
for (const day of ['2026-03-01', '2026-03-02']) {
  const idxSnap = out.findIndex((r) => r.kind === 'snapshot' && r.ts.startsWith(day));
  const idxTxn = out.findIndex((r) => r.kind === 'txn' && r.ts.startsWith(day));
  if (!(idxSnap >= 0 && idxSnap < idxTxn)) snapshotFirst = false;
}

if (!chronoOk || !snapshotFirst) {
  console.error(
    '\nBUG CONFIRMED: backfilled stream is not chronological — the 09:00 ' +
      'snapshot lands AFTER the same day\'s 10:00/14:00 transactions. ' +
      'stableByDate() compares by calendar day only, so same-day rows keep ' +
      'array (insertion) order instead of timestamp order; the appended ' +
      'snapshots sink to the end of their day.'
  );
  process.exit(1);
}

console.log('\nok: invariant holds');
process.exit(0);
