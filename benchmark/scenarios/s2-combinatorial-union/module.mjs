// module.mjs — the "PR under review".
//
// Merge two keyed record lists into one. Keys must stay UNIQUE, so a colliding
// key is de-duplicated by appending `-1`, `-2`, … in order. Records keep their
// original order; base records come before incoming ones.
//
// (Every line here looks individually reasonable. The defect is combinatorial:
// it only surfaces for an input that COMBINES an organic collision with a
// pre-existing literal `-N` key.)

export function mergeKeyed(base, incoming) {
  const out = [];
  const seen = new Set(); // keys we've already emitted an original for
  const counts = new Map(); // per-original-key collision counter

  for (const rec of [...base, ...incoming]) {
    let key = rec.key;
    if (seen.has(rec.key)) {
      const n = (counts.get(rec.key) ?? 0) + 1;
      counts.set(rec.key, n);
      key = `${rec.key}-${n}`; // resolve the collision with the next suffix
    }
    seen.add(rec.key); // remember the original key
    out.push({ ...rec, key });
  }

  return out;
}
