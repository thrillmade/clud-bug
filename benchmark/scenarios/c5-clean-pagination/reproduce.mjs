// reproduce.mjs — proves the COVERAGE invariant HOLDS on the exact inputs that
// break the off-by-one variants a hasty reviewer expects here.
// Run: node reproduce.mjs   (exit 0 = invariant holds, exit 1 = would be a bug)
//
// The invariant, stated precisely: concatenating every emitted batch in order must
// reproduce the input array exactly — each item once, none dropped, none duplicated,
// none reordered — with NO empty batch and NO batch larger than `limit`, and the
// batch count must be exactly ceil(total / limit).
//
// The headline adversarial case is the EXACT-MULTIPLE boundary (total = k * limit):
//   - a naive `offset <= total` guard emits a phantom empty batch at offset==total;
//   - a naive "advance by limit, stop when returned < limit" cursor also over-runs.
// This implementation stops cleanly at the boundary and still covers every item.

import { batchExport } from './module.mjs';

function checkCoverage(label, items, limit) {
  const seen = [];
  let batchCount = 0;

  batchExport(items, limit, (batch, meta) => {
    if (batch.length === 0) {
      console.log(`BUG: [${label}] empty batch emitted at offset ${meta.offset}`);
      process.exit(1);
    }
    if (batch.length > limit) {
      console.log(`BUG: [${label}] oversized batch (${batch.length} > limit ${limit})`);
      process.exit(1);
    }
    if (meta.pageIndex !== batchCount) {
      console.log(`BUG: [${label}] pageIndex ${meta.pageIndex} != running count ${batchCount}`);
      process.exit(1);
    }
    if (meta.offset !== seen.length) {
      console.log(`BUG: [${label}] window offset ${meta.offset} skips/overlaps (expected ${seen.length})`);
      process.exit(1);
    }
    for (const x of batch) seen.push(x);
    batchCount += 1;
  });

  // Coverage: concatenated batches must equal the original array, in order.
  const covered = seen.length === items.length && seen.every((v, i) => v === items[i]);
  if (!covered) {
    console.log(`BUG: [${label}] coverage broken — got [${seen.join(',')}], want [${items.join(',')}]`);
    process.exit(1);
  }

  // Batch count must be exactly ceil(total / limit) — no phantom empty tail batch.
  const expected = Math.ceil(items.length / limit);
  if (batchCount !== expected) {
    console.log(`BUG: [${label}] emitted ${batchCount} batches, want ceil(${items.length}/${limit})=${expected}`);
    process.exit(1);
  }
  return batchCount;
}

const seq = (n) => Array.from({ length: n }, (_, i) => i);

// THE adversarial input: total is an exact multiple of limit (12 = 3 * 4).
// Naive `<=` / "returned < limit" variants emit a 4th, empty batch here.
checkCoverage('exact-multiple 12/4', seq(12), 4);

// limit === 1 on an exact multiple — every item its own batch, boundary hit N times.
checkCoverage('limit-1 5/1', seq(5), 1);

// total === limit — one full batch; must NOT produce an empty second batch.
checkCoverage('single-full 4/4', seq(4), 4);

// Non-multiple total — final short window carries the remainder (4,4,2).
checkCoverage('remainder 10/4', seq(10), 4);

// total < limit — a single short batch, not a dropped/oversized one.
checkCoverage('short 3/4', seq(3), 4);

// Empty input — zero batches, no empty batch emitted.
checkCoverage('empty 0/4', seq(0), 4);

// Large-ish exact multiple to stress the boundary far from index 0.
checkCoverage('exact-multiple 1000/100', seq(1000), 100);

console.log('ok: invariant holds');
process.exit(0);
