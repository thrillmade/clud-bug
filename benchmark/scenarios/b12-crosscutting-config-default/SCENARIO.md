---
id: b12-crosscutting-config-default
class: cross-cutting
severity: MED-HIGH
one_line_defect: The new polling helper inherits NETWORK.requestTimeoutMs as a literal deadline budget, but that constant defaults to 0 — a sentinel meaning "no client-side cap / wait indefinitely" — so `deadline = start + 0` collapses to the start instant and the poller gives up before its first probe.
reproduction: node reproduce.mjs
why_no_single_line: Every line of module.mjs is individually correct — it reads the standard step and budget from config, computes `deadline = start + budgetMs` (textbook), polls on a fixed step, and returns done/attempts/reason. The fault is that the default it inherits carries sentinel semantics (0 = infinite) that this arithmetic ignores, and that default lives in config.mjs, a file the PR only reads and never changes; transport.mjs proves the sentinel is real by guarding it with `if (timeoutMs > 0)`.
correct_finding: Report that pollUntilDone's "wait until ready within the budget" contract is broken because config.NETWORK.requestTimeoutMs defaults to 0, which is a "disabled / no cap" sentinel (honored elsewhere by transport.mjs's `if (timeoutMs > 0)`), yet the new poller consumes it as a finite duration in `start + budgetMs`, making the deadline equal to the start and dropping to zero probes. Ground it either by running `node reproduce.mjs` (a resource ready after 3s is never found on the default path; the explicit-30s control finds it in 4 probes) or by naming the invariant (0 means "no cap", not a zero-length budget — the poller must honor the sentinel or use its own positive default).
---

The polling PR (module.mjs) adds `pollUntilDone` / `waitForReady`, which probe a
status callback every `pollStepMs` until the job is ready or the request budget
runs out. When a caller doesn't pass an explicit budget it inherits
`config.NETWORK.requestTimeoutMs` — the same knob the rest of the network layer
uses. But that constant defaults to `0`, and `0` is a sentinel: it means "no
client-side timeout, rely on the transport" (transport.mjs handles it correctly
with `if (timeoutMs > 0)`, omitting the option). The new poller instead does raw
arithmetic, `deadline = start + budgetMs`, so `0` collapses the deadline onto
the start instant; the `for` loop's `t < deadline` is immediately false and the
function returns `{ done: false, attempts: 0 }` without ever probing. The loop
logic is fine — supply any positive budget and it works (the reproduce control
finds the resource in 4 probes) — the defect is entirely the inherited default.

**Fix (cause in config.mjs's default meaning, not in any PR line):** honor the
sentinel in the new consumer — `const deadline = budgetMs > 0 ? start + budgetMs
: Infinity;` (mirroring transport.mjs's `if (timeoutMs > 0)` guard) — or give the
poller its own explicit positive default instead of borrowing
`requestTimeoutMs`, whose `0 = infinite` convention it cannot express as a plain
addition. A line-quoting reviewer that never opens config.mjs, or that assumes
the default is a sane positive number, misses it.
