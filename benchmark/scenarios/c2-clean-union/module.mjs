// module.mjs — the "PR under review".
//
// Merge two keyed record lists into one. Keys must stay UNIQUE, so a colliding
// key is de-duplicated by appending `-1`, `-2`, … in order. Records keep their
// original order; base records come before incoming ones.
//
// SHAPE NOTE (this is the risky-looking part): a per-original-key counter picks
// the next `-N` suffix. That is EXACTLY the pattern that can emit a suffix which
// happens to equal a pre-existing literal `-N` key in the input — a hasty reader
// might flag a duplicate-key bug here. But this implementation avoids it two ways:
//   (1) `emitted` records every key we ACTUALLY put in the output (originals AND
//       generated suffixes), not just the original keys, and
//   (2) the suffix search does not trust the counter blindly — it probes forward
//       until it finds a candidate that is genuinely free among `emitted`.
// So even an organic collision whose `-N` suffix meets a literal `-N` key stays
// unique.

export function mergeKeyed(base, incoming) {
  const out = [];
  const emitted = new Set(); // every key actually emitted (originals + suffixes)
  const counts = new Map(); // per-original-key hint: where to START probing suffixes

  for (const rec of [...base, ...incoming]) {
    let key = rec.key;
    if (emitted.has(key)) {
      // Collision. Start probing from this original key's last suffix, and keep
      // advancing until the candidate is free among EVERYTHING already emitted —
      // this skips over any literal `-N` key that organically occupies a slot.
      let n = counts.get(rec.key) ?? 0;
      do {
        n += 1;
        key = `${rec.key}-${n}`;
      } while (emitted.has(key));
      counts.set(rec.key, n); // next collision on this key starts after where we landed
    }
    emitted.add(key); // remember the ACTUAL emitted key, not just the original
    out.push({ ...rec, key });
  }

  return out;
}
