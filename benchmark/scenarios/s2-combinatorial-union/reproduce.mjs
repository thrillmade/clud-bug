// reproduce.mjs — demonstrates the combinatorial duplicate-key defect.
// Run: node reproduce.mjs   (exit 1 = bug present, exit 0 = invariant holds)
//
// The crafted input combines the TWO mechanisms:
//   - an ORGANIC collision on "foo" (two records) → the second is suffixed "foo-1"
//   - a PRE-EXISTING LITERAL key "foo-1" in the incoming list
// The suffix logic never checks whether "foo-1" is already taken, and it only
// records ORIGINAL keys in `seen`, so both records end up with key "foo-1".

import { mergeKeyed } from './module.mjs';

const base = [
  { key: 'foo', v: 1 },
  { key: 'foo', v: 2 }, // organic collision → resolves to "foo-1"
];
const incoming = [
  { key: 'foo-1', v: 3 }, // literal "foo-1" that already exists
];

const merged = mergeKeyed(base, incoming);
const keys = merged.map((r) => r.key);
const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];

if (dupes.length > 0) {
  console.log(`BUG CONFIRMED: merged output has duplicate key(s): ${dupes.join(', ')}`);
  console.log(`  keys: ${keys.join(', ')}`);
  console.log(`  (the "unique keys" invariant is violated)`);
  process.exit(1);
} else {
  console.log('ok: invariant holds (all keys unique)');
  process.exit(0);
}
