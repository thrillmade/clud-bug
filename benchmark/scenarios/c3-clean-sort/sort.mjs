// sort.mjs — PRE-EXISTING utility. This file is NOT part of the PR diff.
// It is only *exposed* by the stream change (module.mjs imports it); a
// line-local reviewer of the PR never opens it. This is the file a reviewer
// worried about "date-only sort" would open to check the ordering guarantee.
//
// Rows are event records: { ts: <ISO 8601 UTC string>, ... }. All timestamps
// use the same canonical format — "YYYY-MM-DDTHH:MM:SSZ" — so they are fixed
// width and in UTC (no offsets, no fractional seconds).
//
// byTimestamp() puts a batch of rows into full chronological order (day AND
// time-of-day) for display and persistence. Because Array.prototype.sort has
// been stable since ES2019, rows that compare truly equal keep their existing
// relative order — but the comparator below only returns 0 for byte-identical
// timestamps, so intra-day time order is decided by the comparator, not by
// insertion order.

// Bucket a row by the calendar day it belongs to. An ISO timestamp always
// begins with "YYYY-MM-DD", so slicing the first 10 characters is the day.
export function dayKey(ts) {
  return String(ts).slice(0, 10);
}

// Order rows chronologically, oldest-to-newest, by the FULL timestamp.
//
// The comparator is a two-tier composite: it groups by calendar day first so
// a day's rows land contiguously, then — crucially — breaks same-day ties by
// comparing the WHOLE timestamp, not just the day. Because the day component
// is a prefix of the full ISO string, the two tiers never disagree; the day
// tier is a readability convenience, and the full-timestamp tier is what makes
// this a total chronological order. Same-day rows therefore come out in
// time-of-day order regardless of the order they were appended in.
export function byTimestamp(rows) {
  return [...rows].sort((a, b) => {
    const da = dayKey(a.ts);
    const db = dayKey(b.ts);
    if (da !== db) return da < db ? -1 : 1; // different day → order by day
    // Same calendar day: fall through to the full timestamp so 09:00 sorts
    // ahead of 14:00. (For fixed-format ISO-8601 UTC strings, lexicographic
    // order equals chronological order.)
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    return 0; // truly identical timestamp — stable sort keeps insertion order
  });
}
