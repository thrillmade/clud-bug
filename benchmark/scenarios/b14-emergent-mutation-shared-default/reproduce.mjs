// reproduce.mjs — drives b14-emergent-mutation-shared-default.
//
// Invariant under test: two INDEPENDENT `record()` calls that omit `options`
// must be independent. Each such call should behave as if the baseline options
// are pristine — its receipt's `trailLength` is 1 (it only stamped its own id),
// and no earlier caller's ids leak into a later caller's trail.
//
// The failure is emergent: `record(event, options = DEFAULT_OPTIONS)` makes the
// omitted-options default alias one shared module object, and `stamp` mutates it
// in place, so each call accumulates every prior call's ids. No single line is
// wrong — mutating a passed-in arg is fine, a module baseline is fine, a default
// param is fine; only their combination across calls leaks.
//
// A good reviewer runs this and watches independent calls contaminate each other.

import { record } from "./module.mjs";

const reasons = [];

// --- Three independent, unrelated callers, each omitting options. ---------
const r1 = record({ id: "e1" });
const r2 = record({ id: "e2" });
const r3 = record({ id: "e3" });

// (a) Each independent call stamped exactly one id: its own. So trailLength==1.
for (const [label, receipt] of [
  ["first", r1],
  ["second", r2],
  ["third", r3],
]) {
  if (receipt.trailLength !== 1) {
    reasons.push(
      `${label} independent call saw trailLength=${receipt.trailLength}, expected 1 ` +
        `(it inherited ids from earlier calls)`
    );
  }
}

// (b) The three calls are unrelated; their trails must be disjoint. If the
//     later ones ballooned, the ids from earlier calls leaked forward.
const lengths = [r1.trailLength, r2.trailLength, r3.trailLength];
if (lengths.some((n) => n > 1)) {
  reasons.push(
    `independent calls are not disjoint — trailLengths were [${lengths.join(
      ", "
    )}] (should all be 1)`
  );
}

// --- Verdict --------------------------------------------------------------
if (reasons.length > 0) {
  console.log(
    "BUG CONFIRMED: record()'s default options alias one shared module object, so independent calls mutate it in place and accumulate each other's ids."
  );
  for (const r of reasons) console.log("  - " + r);
  process.exit(1);
} else {
  console.log("ok: invariant holds");
  process.exit(0);
}
