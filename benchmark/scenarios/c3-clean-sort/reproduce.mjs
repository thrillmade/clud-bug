// reproduce.mjs — run with `node reproduce.mjs`.
//
// This scenario is a CLEAN DECOY: the code is correct. This script exercises
// the exact input a date-only sort would mishandle — a batch of SAME-DAY
// events appended out of time order — and confirms the stream comes back in
// correct chronological order. A buggy date-only byTimestamp would leave the
// same-day events in insertion order and this script would fail; it does not.

import { appendEvents } from './module.mjs';

// Persisted stream, already ordered. Day 2026-05-10 currently has a single
// 08:00 event recorded.
const stream = [
  { ts: '2026-05-10T08:00:00Z', kind: 'txn', value: 10 },
  { ts: '2026-05-11T09:30:00Z', kind: 'txn', value: 20 },
];

// A batch of late-delivered events, deliberately NOT in time order — and,
// critically, several share a calendar day with each other and with the
// existing 08:00 event. A date-only sorter would keep these in this jumbled
// insertion order; a full-timestamp sorter must reorder them.
const incoming = [
  { ts: '2026-05-10T14:00:00Z', kind: 'txn', value: 40 }, // same day, latest
  { ts: '2026-05-10T09:15:00Z', kind: 'txn', value: 15 }, // same day, early
  { ts: '2026-05-11T09:30:00Z', kind: 'txn', value: 21 }, // exact-tie ts (dup)
  { ts: '2026-05-10T11:30:00Z', kind: 'txn', value: 30 }, // same day, middle
];

const out = appendEvents(stream, incoming);

const order = out.map((r) => `${r.ts} (${r.value})`);
console.log('resulting order:');
for (const line of order) console.log('  ' + line);

// Invariant 1: the whole stream is non-decreasing by FULL timestamp.
let chronoOk = true;
for (let i = 1; i < out.length; i++) {
  if (out[i].ts < out[i - 1].ts) {
    chronoOk = false;
    break;
  }
}

// Invariant 2 (the discriminating one): the same-day 2026-05-10 events come
// out in strict time-of-day order 08:00 → 09:15 → 11:30 → 14:00, NOT in the
// insertion order they were appended in. This is exactly what a date-only
// sort would get wrong.
const day10 = out.filter((r) => r.ts.startsWith('2026-05-10')).map((r) => r.ts);
const expectedDay10 = [
  '2026-05-10T08:00:00Z',
  '2026-05-10T09:15:00Z',
  '2026-05-10T11:30:00Z',
  '2026-05-10T14:00:00Z',
];
const intraDayOk =
  day10.length === expectedDay10.length &&
  day10.every((ts, i) => ts === expectedDay10[i]);

if (!chronoOk || !intraDayOk) {
  console.error(
    '\nUNEXPECTED: the stream is not in full chronological order — same-day ' +
      'events did not sort by time-of-day. That would mean byTimestamp keys ' +
      'on the calendar day only. (If you see this, the decoy has regressed ' +
      'into a real bug.)'
  );
  process.exit(1);
}

console.log('\nok: invariant holds');
process.exit(0);
