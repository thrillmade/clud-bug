// module.mjs — THIS is the "PR under review": bucket.mjs.
//
// Context: an append-only stream of server events, each stamped with a UTC ISO
// timestamp (the trailing "Z" is load-bearing — everything upstream is UTC).
// Product wants a daily-activity report: how many events happened on each UTC
// calendar day, which day was busiest, and the raw rows per day so an analyst
// can drill in. The report's contract is "grouped by UTC day".
//
// We reuse the existing dayKey() helper to answer "which day is this event
// on?", then group on that key. Reviewed line-by-line, every line below is
// individually correct: we parse UTC timestamps, we key by dayKey(ts), we
// bucket, we count. Nothing here mentions local time.

import { dayKey } from './daycalc.mjs';

// Group events into per-day buckets. Events carry a UTC ISO timestamp; the
// report groups by the UTC calendar day the event occurred on.
export function bucketByDay(events) {
  const buckets = new Map();
  for (const ev of events) {
    const key = dayKey(ev.ts);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ev);
  }
  return buckets;
}

// Count events per UTC day, returned as a plain object keyed by "YYYY-MM-DD".
export function dailyCounts(events) {
  const out = {};
  for (const [day, rows] of bucketByDay(events)) {
    out[day] = rows.length;
  }
  return out;
}

// The single day with the most events (ties resolved by earliest day).
export function busiestDay(events) {
  const counts = dailyCounts(events);
  let best = null;
  for (const day of Object.keys(counts).sort()) {
    if (best === null || counts[day] > counts[best]) best = day;
  }
  return best;
}

// All events that landed in a given UTC day, in arrival order.
export function eventsOnDay(events, ymd) {
  return bucketByDay(events).get(ymd) ?? [];
}
