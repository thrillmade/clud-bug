// sort.mjs — PRE-EXISTING utility. This file is NOT part of the PR diff.
// It is only *exposed* by the backfill change; a line-local reviewer of the
// PR never opens it.
//
// Rows are calendar-dated event records: { ts: <ISO 8601 string>, ... }.
// stableByDate() puts a batch of rows into chronological order for display
// and persistence. Because Array.prototype.sort has been stable since
// ES2019, rows that compare equal keep their existing relative order — hence
// the name.

// Bucket a row by the calendar day it belongs to. An ISO timestamp always
// begins with "YYYY-MM-DD", so slicing the first 10 characters is the day.
export function dateKey(ts) {
  return String(ts).slice(0, 10);
}

// Order rows chronologically. Callers rely on the returned array reading
// oldest-to-newest.
export function stableByDate(rows) {
  return [...rows].sort((a, b) => {
    const ka = dateKey(a.ts);
    const kb = dateKey(b.ts);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0; // same calendar day — leave in existing order
  });
}
