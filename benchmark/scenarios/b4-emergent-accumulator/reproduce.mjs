// reproduce.mjs — drives b4-emergent-accumulator.
//
// Invariant under test: each actor's summary holds EXACTLY that actor's own
// event ids (buckets are DISJOINT), and a fresh call must not inherit anything
// from a prior one. Buckets are built from a single frozen template via a
// shallow spread, so every bucket ends up aliasing the SAME nested `ids`/`tags`
// arrays. The corruption is emergent — it appears only once separate buckets
// (and separate calls) start writing through the shared array.
//
// A good reviewer runs this and watches the disjointness invariant break.

import { rollUp } from "./module.mjs";

const reasons = [];

// --- Call 1: three actors, distinct events. -------------------------------
const events = [
  { actor: "alice", id: "e1", tags: ["login"] },
  { actor: "bob", id: "e2", tags: ["upload"] },
  { actor: "alice", id: "e3", tags: ["logout"] },
  { actor: "carol", id: "e4", tags: ["billing"] },
];

const expectedIds = {
  alice: ["e1", "e3"],
  bob: ["e2"],
  carol: ["e4"],
};

const summaries = rollUp(events);

// (a) Each actor must hold exactly its own event ids.
for (const actor of Object.keys(expectedIds)) {
  const got = (summaries[actor]?.ids ?? []).slice().sort();
  const want = expectedIds[actor].slice().sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    reasons.push(
      `actor "${actor}" ids = [${got.join(", ")}], expected [${want.join(", ")}]`
    );
  }
}

// (b) Buckets must be disjoint: no id may surface under two actors.
const owner = new Map();
for (const actor of Object.keys(summaries)) {
  for (const id of summaries[actor].ids) {
    if (owner.has(id) && owner.get(id) !== actor) {
      reasons.push(
        `id "${id}" appears under both "${owner.get(id)}" and "${actor}"`
      );
    }
    owner.set(id, actor);
  }
}

// --- Call 2: a brand-new, unrelated batch on a fresh invocation. ----------
const later = rollUp([{ actor: "dave", id: "z9", tags: ["login"] }]);
const daveIds = later.dave?.ids ?? [];
if (daveIds.length !== 1 || daveIds[0] !== "z9") {
  reasons.push(
    `fresh call polluted: dave.ids = [${daveIds.join(", ")}], expected [z9]`
  );
}

// --- Verdict --------------------------------------------------------------
if (reasons.length > 0) {
  console.log(
    "BUG CONFIRMED: per-actor summaries share mutable state — buckets are not disjoint and calls are not independent."
  );
  for (const r of reasons) console.log("  - " + r);
  process.exit(1);
} else {
  console.log("ok: invariant holds");
  process.exit(0);
}
