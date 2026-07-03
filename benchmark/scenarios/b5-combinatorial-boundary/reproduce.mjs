// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives consolidatePorts (module.mjs) and checks SPEC invariant #2: the output
// ranges must be pairwise DISJOINT (no port claimed by two ranges).
//
// The defect is combinatorial — it needs TWO conditions to combine:
//   (ordering)  a prior OVERLAPPING merge must run first, so `reach` gets set by
//               the merge-extend line (`reach = max(reach, r.hi)`, which omits
//               the +1 that init/reset use) — deflating reach to hi instead of
//               hi+1.
//   (boundary)  the NEXT range must start EXACTLY at that shared boundary port,
//               so the strict test `r.lo < reach` reads `5 < 5` (false) when the
//               true first-free-port is 6 and it should read `5 < 6` (true).
// Either condition alone: correct output. Together: a truly-overlapping block is
// split, and the boundary port ends up in BOTH halves.

import { consolidatePorts } from './module.mjs';

// Constructed combined input (inclusive ranges):
//   A 8000-8003  and  B 8002-8005 overlap (share 8002,8003) -> one group 8000-8005.
//   C 8005-8008 shares port 8005 with that group -> it belongs to the SAME block.
// Correct consolidation: a single range 8000-8008.
const ranges = [
  { lo: 8000, hi: 8003, owner: 'web' },
  { lo: 8002, hi: 8005, owner: 'web' }, // overlaps A -> triggers the buggy merge-extend
  { lo: 8005, hi: 8008, owner: 'api' }, // starts EXACTLY at the shared boundary port
];

const out = consolidatePorts(ranges);

console.log('consolidated ranges:');
for (const r of out) console.log(`  ${r.lo}-${r.hi}${r.owner ? ` (${r.owner})` : ''}`);

// SPEC invariant #2: output ranges are pairwise disjoint — find any shared port.
let conflict = null;
for (let i = 0; i < out.length && !conflict; i++) {
  for (let j = i + 1; j < out.length; j++) {
    const a = out[i];
    const b = out[j];
    const lo = Math.max(a.lo, b.lo);
    const hi = Math.min(a.hi, b.hi);
    if (lo <= hi) {
      conflict = { a, b, lo, hi };
      break;
    }
  }
}

if (conflict) {
  const { a, b, lo, hi } = conflict;
  const portList = lo === hi ? `${lo}` : `${lo}-${hi}`;
  console.error(
    `\nBUG CONFIRMED: consolidated output is NOT pairwise-disjoint — port ${portList} ` +
      `appears in BOTH ${a.lo}-${a.hi} and ${b.lo}-${b.hi}. A single continuous ` +
      `block (8000-8008) was split at the boundary because the merge-extend used ` +
      `\`reach = max(reach, r.hi)\` (inclusive hi) while init/reset use \`hi + 1\` ` +
      `(half-open); the deflated reach turned the boundary test into \`8005 < 8005\`.`
  );
  process.exit(1);
}

console.log('\nok: invariant holds (ranges are pairwise disjoint)');
process.exit(0);
