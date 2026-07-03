// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives paginate (module.mjs) and checks the SPEC invariant: flattening every
// page must reproduce the input exactly — no item dropped, none duplicated.
//
// The defect is combinatorial — it needs TWO conditions to combine:
//   (remainder) total % pageSize === 1, so `pageCount` fires its orphan-merge
//               branch and returns one FEWER page than `ceil(total/pageSize)`.
//   (boundary)  that shrink lands on the LAST page: `pageWindow` — the textbook
//               clamp window — still hands the final page only `pageSize` items,
//               never the merged orphan, because it knows nothing of the policy.
// Either alone: correct output. `total % pageSize !== 1` → no merge, the clamp
// window covers everything. `total % pageSize === 1` but the orphan-aware count
// isn't matched by an orphan-aware window → the lone trailing item is dropped.

import { paginate } from './module.mjs';

// Check one (total, pageSize) pair: does flatten(paginate) === the input?
function check(total, pageSize) {
  const items = Array.from({ length: total }, (_, i) => i); // 0..total-1
  const flat = paginate(items, pageSize).flat();

  // Multiset/order comparison against the source of truth.
  const seen = new Set(flat);
  const dropped = items.filter((x) => !seen.has(x));
  const dupSet = new Set();
  const seenOnce = new Set();
  for (const x of flat) {
    if (seenOnce.has(x)) dupSet.add(x);
    seenOnce.add(x);
  }
  const duplicated = [...dupSet];
  const ok = dropped.length === 0 && duplicated.length === 0;
  return { total, pageSize, ok, dropped, duplicated };
}

// Sweep a range of totals and page sizes to locate any invariant breach.
let firstBreach = null;
for (let pageSize = 1; pageSize <= 6 && !firstBreach; pageSize++) {
  for (let total = 0; total <= 40; total++) {
    const r = check(total, pageSize);
    if (!r.ok) {
      firstBreach = r;
      break;
    }
  }
}

// Canonical demonstration case: 10 items, pageSize 3 (10 % 3 === 1).
const demo = check(10, 3);
console.log('paginate([0..9], pageSize=3):');
console.log('  pages =', JSON.stringify(paginate([...Array(10).keys()], 3)));

if (firstBreach) {
  const { total, pageSize, dropped, duplicated } = firstBreach;
  const what =
    dropped.length > 0
      ? `item ${dropped.join(',')} DROPPED`
      : `item ${duplicated.join(',')} DUPLICATED`;
  console.error(
    `\nBUG CONFIRMED: paginated output does NOT reproduce the input — with ` +
      `total=${total}, pageSize=${pageSize} (total%pageSize=${total % pageSize}), ` +
      `${what}. \`pageCount\` applies orphan control (returns one fewer page when ` +
      `total%pageSize===1) but \`pageWindow\` is the plain clamp window and never ` +
      `hands the final page the merged orphan, so exactly one item at the last-page ` +
      `boundary is lost. (Demo total=10,pageSize=3: item 9 is missing from the pages above.)`
  );
  process.exit(1);
}

// Belt-and-suspenders: even if the sweep missed it, flag the demo directly.
if (!demo.ok) {
  console.error(
    `\nBUG CONFIRMED: demo total=10,pageSize=3 dropped item ${demo.dropped.join(',')}.`
  );
  process.exit(1);
}

console.log('\nok: invariant holds (every item appears exactly once, in order)');
process.exit(0);
