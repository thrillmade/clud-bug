// reproduce.mjs — proves the "keys stay unique" invariant HOLDS on the exact
// adversarial input that breaks the naive implementation (see s2-combinatorial-union).
// Run: node reproduce.mjs   (exit 0 = invariant holds, exit 1 = would be a bug)
//
// The crafted input combines the TWO mechanisms that trip the naive version:
//   - an ORGANIC collision on "foo" (two records) → the second wants suffix "foo-1"
//   - a PRE-EXISTING LITERAL key "foo-1" in the incoming list
// A correct merge must keep all three output keys distinct.

import { mergeKeyed } from './module.mjs';

function assertUnique(label, base, incoming) {
  const merged = mergeKeyed(base, incoming);
  const keys = merged.map((r) => r.key);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dupes.length > 0) {
    console.log(`BUG: [${label}] duplicate key(s): ${dupes.join(', ')}`);
    console.log(`  keys: ${keys.join(', ')}`);
    process.exit(1);
  }
  return keys;
}

// The exact adversarial input: organic collision meeting a literal "-N" key.
const keys = assertUnique(
  'foo,foo + foo-1',
  [
    { key: 'foo', v: 1 },
    { key: 'foo', v: 2 }, // organic collision → wants "foo-1"
  ],
  [
    { key: 'foo-1', v: 3 }, // literal "foo-1" already present
  ],
);
// Naive impl yields ['foo','foo-1','foo-1'] (duplicate). Correct impl keeps them apart.
console.log(`  keys: ${keys.join(', ')}`);

// A harder stress case that also forces the forward-probe loop to iterate past an
// ALREADY-EMITTED literal suffix ("a-2"), exercising the while-free check itself.
assertUnique(
  'a,a + a-2,a,a',
  [
    { key: 'a', v: 1 },
    { key: 'a', v: 2 }, // → "a-1"
  ],
  [
    { key: 'a-2', v: 3 }, // literal "a-2" occupies that slot early
    { key: 'a', v: 4 }, // counter hint points at "a-2" (taken) → must advance to "a-3"
    { key: 'a', v: 5 }, // → "a-4"
  ],
);

console.log('ok: invariant holds');
process.exit(0);
