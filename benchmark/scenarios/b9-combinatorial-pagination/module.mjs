// module.mjs — THIS is the "PR under review": an offset/limit paginator with
// "orphan control".
//
// Context: a list view pages `items` into fixed windows of `pageSize`. Product
// added ONE requirement this PR: never leave a lone trailing item stranded on a
// page by itself. When the final page would hold exactly one item (the "orphan"),
// merge it up into the previous page instead — so that page carries pageSize + 1.
//
// SPEC (contract these functions must jointly honor):
//   1. `pageCount(total, pageSize)` returns how many pages the list occupies
//      AFTER orphan control (a lone trailing item does not get its own page).
//   2. `pageWindow(total, pageSize, page)` returns the `{ offset, limit }` slice
//      for a 0-based page index.
//   3. INVARIANT: concatenating `pageWindow(...)` over pages 0..pageCount-1 must
//      reproduce every item exactly once, in order — no item dropped, none dup'd.
//
// Reviewed line-by-line, every line is individually defensible. `pageCount`
// correctly subtracts the orphan page. `pageWindow` is the textbook offset/limit
// window: start at `page*pageSize`, take `pageSize`, clamp the tail to `total` so
// we never read past the end. Neither is wrong on its own. The defect is that the
// two functions encode the orphan policy INCONSISTENTLY, and that only bites for
// one specific `total % pageSize` at the last-page boundary.

/**
 * Number of pages `total` items occupy at `pageSize`, after orphan control.
 * A final page that would hold exactly one item is merged into the prior page.
 * @returns {number}
 */
export function pageCount(total, pageSize) {
  if (total <= 0) return 0;
  const base = Math.ceil(total / pageSize);
  // Orphan control: a lone trailing item rides along on the previous page,
  // so the list occupies one fewer page. (Guard base > 1 so a single-item
  // list still gets its one page rather than collapsing to zero.)
  if (total % pageSize === 1 && base > 1) return base - 1;
  return base;
}

/**
 * The `{ offset, limit }` slice for a 0-based `page`.
 * Textbook offset/limit window: start at page*pageSize, take pageSize, and clamp
 * the end to `total` so the last window never runs past the array.
 * @returns {{offset:number, limit:number}}
 */
export function pageWindow(total, pageSize, page) {
  const offset = page * pageSize;
  const end = Math.min(offset + pageSize, total);
  return { offset, limit: end - offset };
}

/**
 * Slice `items` into pages using pageCount + pageWindow (the two above).
 * @template T
 * @param {T[]} items
 * @param {number} pageSize
 * @returns {T[][]}
 */
export function paginate(items, pageSize) {
  const total = items.length;
  const n = pageCount(total, pageSize);
  const pages = [];
  for (let page = 0; page < n; page++) {
    const { offset, limit } = pageWindow(total, pageSize, page);
    pages.push(items.slice(offset, offset + limit));
  }
  return pages;
}
