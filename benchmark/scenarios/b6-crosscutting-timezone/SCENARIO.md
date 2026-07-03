---
id: b6-crosscutting-timezone
class: cross-cutting
severity: MED-HIGH
one_line_defect: The bucketing PR groups UTC event timestamps via the pre-existing dayKey() helper, which derives the calendar day from LOCAL time, so in any non-UTC timezone a just-past-midnight-UTC event is filed under the wrong day.
reproduction: node reproduce.mjs
why_no_single_line: Every line of the bucket.mjs diff is individually correct — it parses UTC timestamps, keys each event by dayKey(ts), and groups on that key; the defect is the mismatch between what the diff assumes dayKey does (return the UTC day) and what it actually does (return the local day via getFullYear/getMonth/getDate), and that helper lives in daycalc.mjs, a file the diff only exposes, never changes.
correct_finding: Report that bucketByDay's "group by UTC day" contract is broken because dayKey (daycalc.mjs) reads the calendar day off local-time accessors (getFullYear/getMonth/getDate), so on a host whose TZ is behind UTC an event within a few hours past midnight UTC rolls back into the previous local day and is miscounted; ground it either by running `node reproduce.mjs` with TZ=America/New_York (the 02:30Z event lands under 2026-03-01 instead of 2026-03-02) or by naming the violated invariant (UTC-timestamped events must bucket by UTC day, but dayKey uses local time, so bucketing is host-timezone-dependent).
---

The report PR (module.mjs / bucket.mjs) groups UTC-stamped events into per-day buckets and advertises a "grouped by UTC day" contract, delegating the day derivation to the existing `dayKey()` in daycalc.mjs. But `dayKey()` builds its "YYYY-MM-DD" from `getFullYear`/`getMonth`/`getDate`, which are LOCAL-time accessors. On a UTC-negative host (e.g. America/New_York, UTC-5 in early March) an event at `2026-03-02T02:30:00Z` reads back as local `2026-03-01`, so it is bucketed and counted under the previous day — the counts and the busiest-day report silently disagree with the UTC contract, and the result depends on where the process happens to run.

Fix: derive the day from UTC in daycalc.mjs — use `getUTCFullYear`/`getUTCMonth`/`getUTCDate` (or `ts.slice(0, 10)` since the inputs are ISO-UTC), so `dayKey()` is timezone-independent. The root cause and fix live in daycalc.mjs, not in the reviewed bucket.mjs diff — which is exactly why a line-quoting reviewer that never opens daycalc.mjs, or that reviews on a UTC CI box, misses it.
