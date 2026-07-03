---
id: b4-emergent-accumulator
class: emergent
severity: MAJOR
one_line_defect: rollUp seeds every actor's bucket from one module-level template via a shallow `{ ...EMPTY_SUMMARY }`, so all buckets alias the same nested `ids`/`tags` arrays and each actor accumulates every other actor's events (and later calls inherit earlier ones).
reproduction: node reproduce.mjs
why_no_single_line: The frozen template, the `freshBucket()` factory, the shallow spread, the counter bump, and the `ids.push` are each individually correct; the leak only exists in their interaction — a shallow copy of an object whose nested arrays are shared, mutated in place, and never reset across iterations or calls.
correct_finding: Report that per-actor buckets are not independent — `freshBucket` shallow-copies a shared template so every bucket's `ids`/`tags` point at the same array, breaking the "each actor holds only its own events / buckets are disjoint / calls are independent" invariant. Ground it by running `node reproduce.mjs` (alice/bob/carol all read back `[e1,e2,e3,e4]`, and a fresh call's `dave` inherits them) or by naming the aliasing: `{ ...EMPTY_SUMMARY }` copies the array *reference*, and `Object.freeze` is shallow so the nested arrays stay mutable and shared.
---

`rollUp` initializes each new actor's summary from a single module-level `EMPTY_SUMMARY` template through `freshBucket() => ({ ...EMPTY_SUMMARY })`. The spread copies the primitive `count` by value (so counts stay correct per actor, which hides the bug) but copies the `ids` and `tags` arrays by *reference* — every bucket, across every actor and every call, mutates the one array that lives on the frozen template (`Object.freeze` is shallow, so those arrays are neither frozen nor per-bucket). The result: each actor's `ids` list contains all actors' events, and because the template is never reset, a subsequent `rollUp` call starts already polluted with the previous call's ids.

The fix is to build genuinely fresh nested state per bucket rather than aliasing a shared template — e.g. `freshBucket() => ({ count: 0, ids: [], tags: [] })`, or deep-clone the arrays in the copy (`{ ...EMPTY_SUMMARY, ids: [], tags: [] }`). Either gives each actor its own arrays, restoring bucket disjointness and call independence regardless of event order or invocation count.
