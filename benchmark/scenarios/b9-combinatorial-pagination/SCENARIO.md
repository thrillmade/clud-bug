---
id: b9-combinatorial-pagination
class: combinatorial
severity: MED-HIGH
one_line_defect: The offset/limit paginator applies "orphan control" in `pageCount` (returns one fewer page when `total % pageSize === 1`) but `pageWindow` is the plain clamp window that still hands the last page only `pageSize` items, so the merged orphan is never emitted and exactly one item is dropped whenever `total % pageSize === 1` and `total > pageSize`.
reproduction: node reproduce.mjs
why_no_single_line: No single line is wrong — `pageCount`'s orphan branch (`total % pageSize === 1 && base > 1 ? base - 1 : base`) correctly computes the intended post-merge page count, and `pageWindow`'s `Math.min(offset + pageSize, total)` is the textbook, individually-correct clamp window. The defect is the cross-function CONVENTION MISMATCH: the count function knows about orphan control and the window function does not, so their notions of "how many items the last page holds" diverge — but only for the one remainder (`total % pageSize === 1`) at the last-page boundary.
correct_finding: Report that the "every item appears exactly once" invariant is broken because `pageCount` and `pageWindow` encode the orphan policy inconsistently — `pageCount` merges the lone trailing item into the previous page (one fewer page) but `pageWindow` never widens the final page to `pageSize + 1`, so the orphan is dropped. Ground it either by running `node reproduce.mjs` (total=10,pageSize=3 → pages [[0,1,2],[3,4,5],[6,7,8]], item 9 lost) or by naming the invariant (concatenating windows over 0..pageCount-1 must reproduce the input; it under-covers by one item exactly when `total % pageSize === 1` and `total > pageSize`).
---

`paginate` slices a list into `pageSize` windows with "orphan control": a final page
that would hold a single item is merged up into the previous page. This PR taught
`pageCount` that policy (it returns one fewer page when `total % pageSize === 1`) but
left `pageWindow` as the textbook offset/limit clamp, which always caps the last page
at `pageSize`. The two functions are each individually correct, yet together they
disagree about the size of the final page: for `total % pageSize === 1` with
`total > pageSize`, the loop runs `ceil - 1` pages of `pageSize` items = `total - 1`
items, silently dropping the orphan. Every other remainder (0, or ≥2) skips the merge
branch, so the clamp window covers everything and the output is correct — which is why
a line-by-line reader sees only two defensible lines.

**Fix:** make the window honor the same policy as the count — on the last page emit
everything remaining rather than a fixed `pageSize`, e.g. compute `end` for
`page === pageCount(total, pageSize) - 1` as `total` (so the merged page carries
`pageSize + 1`). Equivalently, derive both the count and the per-page size from a
single orphan-aware page-boundary table so the two can't drift.
