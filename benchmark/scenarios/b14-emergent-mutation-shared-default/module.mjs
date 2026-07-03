// module.mjs — the "PR under review".
//
// A small "receipt" layer for an audit log. `record(event, options)` returns a
// receipt for one event and, as a side effect, stamps some bookkeeping onto the
// options object it was handed: it appends the event id to an `audit` trail and
// remembers the `lastId` it saw. Callers that don't care about options can just
// omit them and fall back to the module's baseline options.
//
// Every line below is individually defensible — a module-level baseline, an
// ordinary default parameter, an in-place "stamp these fields" helper, a couple
// of straight-line reads. The defect is emergent: it appears only once two
// independent callers each OMIT options and thereby, unknowingly, share and
// mutate the very same object across separate calls.

// Baseline options used when a caller doesn't supply their own.
const DEFAULT_OPTIONS = {
  channel: "default",
  audit: [], // running trail of ids stamped through these options
  lastId: null, // most recent id stamped through these options
};

// Stamp bookkeeping onto whatever options object we were given, in place.
// (In-place is intentional: a caller that passes its OWN options object wants
// the trail written back onto it so it can inspect what flowed through.)
function stamp(options, event) {
  options.audit.push(event.id);
  options.lastId = event.id;
  return options;
}

/**
 * Record one event and return its receipt.
 * @param {{ id: string, kind?: string }} event
 * @param {{ channel: string, audit: string[], lastId: string|null }} [options]
 * @returns {{ id: string, kind: string, channel: string, trailLength: number }}
 */
export function record(event, options = DEFAULT_OPTIONS) {
  stamp(options, event);
  return {
    id: event.id,
    kind: event.kind ?? "generic",
    channel: options.channel,
    trailLength: options.audit.length,
  };
}

/**
 * Record a batch of events that intentionally share one options object.
 * @param {{ id: string, kind?: string }[]} events
 * @param {object} [options]
 */
export function recordBatch(events, options = DEFAULT_OPTIONS) {
  return events.map((event) => record(event, options));
}
