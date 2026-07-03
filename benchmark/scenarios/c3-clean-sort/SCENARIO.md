---
id: c3-clean-sort
class: clean
severity: none
one_line_defect: NONE — this code is correct
reproduction: node reproduce.mjs
why_correct: byTimestamp breaks same-day ties on the FULL ISO timestamp (not the calendar day), so appending same-day events out of order still yields correct time-of-day chronological order.
correct_finding: NONE. A correct review reports no finding here; any critical/major flag is a FALSE POSITIVE.
---

The stream PR (module.mjs) appends out-of-order, same-day events and re-sorts the union with the pre-existing `byTimestamp` in sort.mjs — the exact cross-cutting shape of the s3 date-only-sort bug, and the `dayKey(ts) = ts.slice(0,10)` helper at the top of sort.mjs is bait for a reviewer primed to shout "date-only sort, intra-day order lost." But the comparator only *groups* by day, then falls through to comparing the whole timestamp on a same-day tie (returning 0 only for byte-identical `ts`), which is a total chronological order. A hasty reviewer who stops at the `slice(0,10)` line false-flags it; a reviewer who reads the comparator to its end, or runs `node reproduce.mjs`, sees the same-day 08:00→09:15→11:30→14:00 events come out correctly ordered and reports nothing.
