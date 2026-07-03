// module.mjs — THIS is the "PR under review": stream.mjs.
//
// Context: an append-only event stream. Events for a given day do NOT always
// arrive in time order — a late-delivered 09:00 event can show up after the
// same day's 14:00 event has already been recorded. This PR adds a helper that
// appends a batch of freshly-arrived events to the persisted stream and hands
// the whole thing to the existing byTimestamp() sorter so the stored stream is
// always in chronological order before persistence.
//
// The tricky bit the reviewer should sanity-check: does byTimestamp actually
// order same-day events by time-of-day, or only by calendar day? If it were
// date-only, these appended-out-of-order same-day events would keep their
// insertion order and the stream would be wrong. Opening sort.mjs answers it:
// byTimestamp breaks same-day ties on the full timestamp, so it is correct.

import { byTimestamp } from './sort.mjs';

// True iff `stream` is non-decreasing by full timestamp. Used as a cheap
// precondition check; `stream` is assumed already ordered by prior appends.
export function isOrdered(stream) {
  for (let i = 1; i < stream.length; i++) {
    if (stream[i].ts < stream[i - 1].ts) return false;
  }
  return true;
}

// Append a batch of newly-arrived events to the stream and return the whole
// stream back in chronological order. `incoming` may be in any order (that is
// the whole point — late events arrive out of order); `stream` is assumed
// already ordered. We re-sort the union by full timestamp.
export function appendEvents(stream, incoming) {
  const merged = [...stream, ...incoming];
  return byTimestamp(merged);
}
