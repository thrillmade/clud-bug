// module.mjs — THIS is the "PR under review": port-range consolidation.
//
// Context: a firewall/allowlist config accumulates many inclusive port ranges
// `{ lo, hi }` (both endpoints inclusive; a range owns every integer port from
// lo..hi). Before persisting we consolidate them into a canonical set.
//
// SPEC (contract this function must honor):
//   1. Two ranges are merged iff they SHARE at least one port (they overlap).
//      Ranges that are merely contiguous-but-disjoint (e.g. 20-24 and 25-30,
//      no shared port) stay SEPARATE — each is a distinct rule with its own
//      owner, and coalescing them would misattribute ports.
//   2. The returned ranges are pairwise DISJOINT and cover exactly the union
//      of the inputs. No port may appear in two output ranges.
//
// Reviewed line-by-line, every line below is individually defensible. The hot
// loop tracks the running group's coverage as `reach` — the first free port
// just past the group (half-open end = hi + 1) — which makes the overlap test
// a clean strict compare. The defect is a convention mismatch, not a line.

/**
 * Do two inclusive ranges share at least one port? (used by callers/validation)
 * @returns {boolean}
 */
export function overlaps(a, b) {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/**
 * Consolidate inclusive port ranges per the SPEC above.
 * @param {{lo:number, hi:number, owner?:string}[]} ranges
 * @returns {{lo:number, hi:number, owner?:string}[]}
 */
export function consolidatePorts(ranges) {
  if (ranges.length === 0) return [];

  // Sort by lower bound, then by upper bound, so a group is built left-to-right.
  const sorted = ranges
    .slice()
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);

  const out = [];
  let cur = { ...sorted[0] };
  // `reach` = first free port past the current group (half-open end).
  let reach = cur.hi + 1;

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];

    // Strict compare: r shares a port with the group iff it starts before the
    // first free port. (r.lo < cur.hi + 1  <=>  r.lo <= cur.hi.)
    if (r.lo < reach) {
      // Absorb r into the current group; extend the running coverage.
      cur.hi = Math.max(cur.hi, r.hi);
      reach = Math.max(reach, r.hi);
    } else {
      // Disjoint: close out the current group and start a fresh one.
      out.push(cur);
      cur = { ...r };
      reach = cur.hi + 1;
    }
  }

  out.push(cur);
  return out;
}
