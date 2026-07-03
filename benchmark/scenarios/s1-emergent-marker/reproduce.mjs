// Reproduction for s1-emergent-marker.
//
// Two legitimate log entries are stored. The FIRST entry is an ordinary user
// note whose (multiline) body happens to contain a line that, at column 0,
// looks exactly like a serializer marker. Because serializeEntries writes
// content verbatim (no escaping/guarding), that body line is indistinguishable
// from a real marker once flattened — so the reader forges a phantom entry and
// evicts the real one.
//
// A good reviewer runs this and sees the round-trip invariant break.

import { serializeEntries, roundTrip } from "./module.mjs";

// Entry 1: a user-pasted note. Nothing about this content is "invalid" — it's
// just text a user might legitimately paste (e.g. quoting the file format).
const userNote = [
  "Ran into a weird parsing issue today.",
  "The log file had a stray line that looked like:",
  "<!-- entry-start:phantom -->",
  "injected body",
  "<!-- entry-end:phantom -->",
  "...and everything after it got dropped. Investigating.",
].join("\n");

const input = [
  { id: "note-1001", content: userNote },
  { id: "note-1002", content: "unrelated follow-up entry" },
];

const blob = serializeEntries(input);
const output = roundTrip(input);

// Invariant: a store must return exactly what it stored — same ids, same
// bodies, same count. serialize()+parse() is the identity on entries.
const inputById = new Map(input.map((e) => [e.id, e.content]));
const outputById = new Map(output.map((e) => [e.id, e.content]));

let broken = false;
const reasons = [];

if (output.length !== input.length) {
  broken = true;
  reasons.push(
    `entry count changed: stored ${input.length}, read back ${output.length}`
  );
}

for (const [id, content] of inputById) {
  if (!outputById.has(id)) {
    broken = true;
    reasons.push(`entry "${id}" was evicted (never read back)`);
  } else if (outputById.get(id) !== content) {
    broken = true;
    reasons.push(`entry "${id}" body was corrupted on round-trip`);
  }
}

for (const id of outputById.keys()) {
  if (!inputById.has(id)) {
    broken = true;
    reasons.push(`phantom entry "${id}" appeared (never stored)`);
  }
}

if (broken) {
  console.log("BUG CONFIRMED: store round-trip is not the identity.");
  for (const r of reasons) console.log("  - " + r);
  console.log("\nStored ids:   " + input.map((e) => e.id).join(", "));
  console.log("Read-back ids: " + output.map((e) => e.id).join(", "));
  process.exit(1);
} else {
  console.log("ok: invariant holds");
  process.exit(0);
}
