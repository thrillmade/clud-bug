---
id: s3-crosscutting-sort
class: cross-cutting
severity: MED-HIGH
one_line_defect: Backfill hands full-timestamp rows to stableByDate(), which sorts by calendar day only, so each synthetic 09:00 snapshot loses its intended chronological position and sinks below the same day's real transactions.
reproduction: node reproduce.mjs
why_no_single_line: Every line of the backfill diff is correct on its own — it stamps snapshots with full date+time and calls the existing "order chronologically" helper; the defect is the mismatch between what the diff assumes stableByDate does (order by time) and what it actually does (order by day), and that helper lives in sort.mjs, a file the diff only exposes, never changes.
correct_finding: Report that backfill's chronological guarantee is broken because stableByDate (sort.mjs) keys on date-only (`ts.slice(0,10)`) and, being a stable sort, leaves same-day rows in array/insertion order — the appended snapshots therefore land after that day's transactions; ground it either by running `node reproduce.mjs` (09:00 snapshot appears after 10:00/14:00 txns) or by naming the violated invariant (stableByDate promises chronological order but compares only the day component, so intra-day time order is not honored).
---

The backfill PR (module.mjs) synthesizes a start-of-business snapshot at 09:00Z for every active day and expects `stableByDate` to interleave it ahead of that day's 10:00/14:00 transactions. But `stableByDate` in the pre-existing sort.mjs compares only `dateKey(ts) = ts.slice(0,10)` — the calendar day — and returns 0 for any two rows sharing a day. Because `Array.prototype.sort` is stable, same-day rows retain their position in the `merged` array, and since the snapshots are concatenated after `existing`, they end up last within their day: the persisted stream reads 10:00 txn → 14:00 txn → 09:00 snapshot, violating both "chronological" and "snapshot precedes the day's transactions."

Fix: make the comparator order by the full timestamp when the day keys tie (e.g. fall through to comparing `a.ts` vs `b.ts`), or change the sort key from `ts.slice(0,10)` to the full `ts`. Either way the root cause and fix live in sort.mjs, not in the reviewed backfill diff — which is exactly why a line-quoting reviewer that never opens sort.mjs misses it.
