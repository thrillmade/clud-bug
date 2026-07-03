// module.mjs — THIS is the "PR under review": backfill.mjs.
//
// Context: an append-only event stream of transactions. Analysts want a
// synthetic "start-of-business" snapshot injected for every day that has
// activity, positioned *before* that day's real transactions, so a report
// reads:  09:00 snapshot → 10:00 txn → 14:00 txn.
//
// The snapshots carry a full date+time timestamp (09:00Z). We hand the merged
// stream to the existing stableByDate() helper to put everything back into
// chronological order before persisting. Reviewed line-by-line, every line
// below is individually correct.

import { stableByDate } from './sort.mjs';

// Distinct calendar days present in the input, in first-seen order.
function daysPresent(rows) {
  const seen = new Set();
  const days = [];
  for (const r of rows) {
    const day = r.ts.slice(0, 10);
    if (!seen.has(day)) {
      seen.add(day);
      days.push(day);
    }
  }
  return days;
}

// Build one snapshot row per active day, stamped at 09:00Z — the marker
// analysts expect to see ahead of the day's transactions.
export function synthesizeSnapshots(existing) {
  return daysPresent(existing).map((day) => ({
    ts: `${day}T09:00:00Z`,
    kind: 'snapshot',
    value: 0,
  }));
}

// Merge the synthetic snapshots into the real stream and re-order the whole
// thing chronologically. `existing` is assumed already time-ordered.
export function backfill(existing) {
  const snapshots = synthesizeSnapshots(existing);
  const merged = [...existing, ...snapshots];
  return stableByDate(merged);
}
