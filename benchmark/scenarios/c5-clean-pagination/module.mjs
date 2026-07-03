// module.mjs — the "PR under review".
//
// Batched export: walk a backing list in fixed-size offset/limit windows and hand
// each window to a sink. CONTRACT (the invariant this must honor):
//   COVERAGE — every item is emitted EXACTLY once, in order, across all batches;
//   nothing is skipped, nothing is emitted twice, and NO empty trailing batch is
//   produced (an empty batch would trip a spurious downstream flush).
//
// SHAPE NOTE (this is the risky-looking part): an offset/limit walk is the textbook
// home of off-by-one bugs. Reach for `<=` instead of `<`, forget to clamp the final
// short window, or advance the cursor by the nominal `limit` instead of the span you
// actually consumed, and you either drop the last item, double-count it, or emit a
// phantom empty batch when `total` is an exact multiple of `limit`. A reviewer primed
// on those failure modes may flag one on sight — the `+ limit` in the window END and
// the exact-multiple boundary both look like a page could run one item long or one
// batch too many. Each hazard is genuinely avoided:
//   (1) the loop guard is STRICT `<` against total, so an exact-multiple total stops
//       right after the last FULL window — no empty batch is ever produced;
//   (2) the window END is clamped with `Math.min(offset + limit, total)`, so the
//       final short window carries exactly the remainder and never over-reads;
//   (3) the cursor advances to `end` — the span ACTUALLY consumed — so consecutive
//       windows abut with no gap and no overlap, and offset can never pass `total`.

/**
 * Compute the offset/limit windows that tile [0, total) with no gap or overlap.
 * Each window is half-open: [offset, end). The last window may be short.
 * @param {number} total  non-negative integer count of items
 * @param {number} limit  positive integer window size
 * @returns {{offset:number, end:number, count:number}[]}
 */
export function pageWindows(total, limit) {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError('total must be a non-negative integer');
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('limit must be a positive integer');
  }

  const windows = [];
  let offset = 0;
  // STRICT `<`: when total is an exact multiple of limit, offset lands ON total
  // after the last full window and the loop ends — no phantom empty tail window.
  while (offset < total) {
    const end = Math.min(offset + limit, total); // clamp: the final window is short
    windows.push({ offset, end, count: end - offset });
    offset = end; // advance by the span actually consumed, never past total
  }
  return windows;
}

/**
 * Walk `items` in windows of size `limit`, handing each non-empty slice to `sink`.
 * @param {readonly unknown[]} items
 * @param {number} limit
 * @param {(batch: unknown[], meta: {offset:number, pageIndex:number}) => void} sink
 * @returns {number} the number of (non-empty) batches emitted
 */
export function batchExport(items, limit, sink) {
  let pageIndex = 0;
  for (const { offset, end } of pageWindows(items.length, limit)) {
    sink(items.slice(offset, end), { offset, pageIndex });
    pageIndex += 1;
  }
  return pageIndex;
}
