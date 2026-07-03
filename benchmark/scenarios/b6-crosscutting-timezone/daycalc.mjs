// daycalc.mjs — PRE-EXISTING utility. This file is NOT part of the PR diff.
// It is only *exposed* by the bucketing change; a line-local reviewer of the
// PR never opens it.
//
// Event records carry a UTC ISO timestamp: { ts: "2026-03-02T02:30:00Z", ... }.
// dayKey() answers "which calendar day did this event fall on?" as the string
// "YYYY-MM-DD", suitable for grouping a day's worth of activity together.

// Derive the calendar day for a timestamp. An ISO string parses cleanly via
// the Date constructor, and the day/month/year accessors read the pieces back
// out. Zero-pad month and day so keys sort lexicographically.
export function dayKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Convenience: is this timestamp on the given "YYYY-MM-DD" day?
export function isOnDay(ts, ymd) {
  return dayKey(ts) === ymd;
}
