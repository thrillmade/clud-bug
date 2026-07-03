// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives the bucketing PR (module.mjs) and checks the invariant it advertises:
// events are grouped by their UTC calendar day.
//
// This defect only surfaces when the process runs in a non-UTC timezone, so we
// pin one deterministically. America/New_York is UTC-5 in early March 2026
// (before DST begins March 8), so a 02:30Z event belongs to UTC day 03-02 but
// to *local* day 03-01. Setting TZ here forces the discrepancy on any machine.
process.env.TZ = 'America/New_York';

import { dailyCounts, eventsOnDay } from './module.mjs';

// Three events, all stamped in UTC. Two are safely mid-day; one is at 02:30Z,
// just past midnight UTC — still the SAME UTC day as required by the contract.
const events = [
  { ts: '2026-03-02T02:30:00Z', id: 'a' }, // UTC day 2026-03-02 (00:30-ish past midnight)
  { ts: '2026-03-02T12:00:00Z', id: 'b' }, // UTC day 2026-03-02
  { ts: '2026-03-03T12:00:00Z', id: 'c' }, // UTC day 2026-03-03
];

const counts = dailyCounts(events);
console.log('daily counts (report groups by UTC day):');
console.log(' ', JSON.stringify(counts));

// Invariant, per the report's contract: event 'a' occurred at 02:30 UTC on
// 2026-03-02, so it must be counted under the UTC day 2026-03-02 alongside 'b'.
const EXPECTED = { '2026-03-02': 2, '2026-03-03': 1 };

const ids0302 = eventsOnDay(events, '2026-03-02').map((e) => e.id).sort();
console.log("events attributed to UTC day 2026-03-02:", JSON.stringify(ids0302));

const holds =
  counts['2026-03-02'] === EXPECTED['2026-03-02'] &&
  counts['2026-03-03'] === EXPECTED['2026-03-03'] &&
  ids0302.join(',') === 'a,b';

if (!holds) {
  console.error(
    '\nBUG CONFIRMED: event at 02:30Z (UTC day 2026-03-02) was bucketed into ' +
      'the WRONG day. dayKey() derives the calendar day from LOCAL time ' +
      '(getFullYear/getMonth/getDate), so in a UTC-negative timezone a ' +
      'just-past-midnight-UTC event rolls back to the previous local day. ' +
      'Expected ' +
      JSON.stringify(EXPECTED) +
      ' but got ' +
      JSON.stringify(counts) +
      '.'
  );
  process.exit(1);
}

console.log('\nok: invariant holds');
process.exit(0);
