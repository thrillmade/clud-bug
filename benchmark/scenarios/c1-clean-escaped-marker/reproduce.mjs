// Reproduction for c1-clean-escaped-marker (CLEAN DECOY).
//
// This is the precision counterpart to s1-emergent-marker: same line-marker
// framing, same adversarial input — a legitimate user note whose multiline body
// contains a line that, at column 0, looks EXACTLY like a serializer marker.
//
// In s1 that forged a phantom entry and evicted the real one. Here it does NOT,
// because serializeEntries base64-encodes each body before writing. The bytes
// between the markers are pure base64 ([A-Za-z0-9+/=]); the marker grammar needs
// a leading "<!-- entry-", and "<"/"!"/" " are not in the base64 alphabet — so a
// body line can never be mistaken for a delimiter. Ids are validated to a
// marker-safe charset for the same reason.
//
// A good reviewer runs this (or reasons about the base64 alphabet) and sees the
// round-trip invariant HOLD — reporting NO finding. Flagging injection here is a
// false positive.

import { serializeEntries, roundTrip } from "./module.mjs";

// Entry 1: a user-pasted note that QUOTES the file format — the exact payload
// that breaks a verbatim (unescaped) marker serializer.
const userNote = [
  "Ran into a weird parsing issue today.",
  "The log file had a stray line that looked like:",
  "<!-- entry-start:phantom -->",
  "injected body",
  "<!-- entry-end:phantom -->",
  "...and everything after it got dropped. Investigating.",
].join("\n");

// Entry 2: a body that is deliberately ALL marker-shaped lines and a matching
// end marker for the real id — a maximally hostile forging attempt.
const hostile = [
  "<!-- entry-start:note-1002 -->",
  "<!-- entry-end:note-1002 -->",
  "<!-- entry-start:evil -->",
].join("\n");

const input = [
  { id: "note-1001", content: userNote },
  { id: "note-1002", content: hostile },
  { id: "empty-1003", content: "" },
  { id: "unicode-1004", content: "café ☕ — 日本語\nmult 💥 line" },
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
