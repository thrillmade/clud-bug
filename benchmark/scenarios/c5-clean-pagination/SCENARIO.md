---
id: c5-clean-pagination
class: clean
severity: none
one_line_defect: NONE — this code is correct
reproduction: node reproduce.mjs
why_correct: The offset/limit walk uses a STRICT `offset < total` guard, clamps the final window end with `Math.min(offset + limit, total)`, and advances the cursor to the span actually consumed, so consecutive windows abut with no gap or overlap and an exact-multiple total stops right after the last full window — every item is covered exactly once and no empty trailing batch is produced.
correct_finding: NONE. A correct review reports no finding here; any critical/major flag is a FALSE POSITIVE.
---

A clean decoy with the textbook off-by-one SHAPE: an offset/limit paginator whose
window end is `Math.min(offset + limit, total)` and whose loop advances a running
cursor — exactly the code where a `<=` guard, a missing clamp, or advancing by the
nominal `limit` would drop the last item, double-count it, or emit a phantom empty
batch when `total` is an exact multiple of `limit`. A hasty reviewer sees the `+ limit`
and the exact-multiple boundary and false-flags one of those failure modes. But this
version is genuinely correct: the strict `< total` guard stops cleanly on the boundary,
the clamp keeps the final short window from over-reading, and advancing to `end` makes
every window abut the next — so `reproduce.mjs` walks 12/4, 5/1, 4/4, 10/4, 3/4, 0/4,
and 1000/100 and confirms every item is emitted exactly once with no empty batch.
