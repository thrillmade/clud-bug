// module.mjs — the "PR under review".
//
// Roll up a stream of activity events into per-actor summaries. Every summary
// bucket has the same shape: a running event `count`, the list of event `ids`
// attributed to that actor, and the de-duplicated `tags` seen for that actor.
//
// New actors are initialized from a single frozen template, so every bucket
// starts from an identical, immutable-looking default shape.
//
// (Every line here is individually reasonable — a frozen template, a spread
// copy, ordinary counter/push updates. The defect is emergent: it only shows
// up once separate buckets start INTERACTING through state they never meant to
// share.)

// A frozen "empty summary" so no caller can accidentally clobber the defaults.
const EMPTY_SUMMARY = Object.freeze({
  count: 0,
  ids: [],
  tags: [],
});

// Hand out a bucket shaped like EMPTY_SUMMARY for a newly seen actor.
function freshBucket() {
  return { ...EMPTY_SUMMARY };
}

/**
 * Group events by actor.
 * @param {{ actor: string, id: string, tags?: string[] }[]} events
 * @returns {Record<string, { count: number, ids: string[], tags: string[] }>}
 */
export function rollUp(events) {
  const summaries = {};

  for (const ev of events) {
    if (!summaries[ev.actor]) {
      summaries[ev.actor] = freshBucket();
    }

    const bucket = summaries[ev.actor];
    bucket.count += 1;
    bucket.ids.push(ev.id);

    for (const tag of ev.tags ?? []) {
      if (!bucket.tags.includes(tag)) {
        bucket.tags.push(tag);
      }
    }
  }

  return summaries;
}

/**
 * Higher-level view: rollUp, then present as a sorted array of rows.
 * @returns {{ actor: string, count: number, ids: string[], tags: string[] }[]}
 */
export function summarize(events) {
  const summaries = rollUp(events);
  return Object.keys(summaries)
    .sort()
    .map((actor) => ({ actor, ...summaries[actor] }));
}

/** Convenience: the actor with the most events (ties broken by first seen). */
export function busiestActor(events) {
  let best = null;
  for (const row of summarize(events)) {
    if (!best || row.count > best.count) best = row;
  }
  return best ? best.actor : null;
}
