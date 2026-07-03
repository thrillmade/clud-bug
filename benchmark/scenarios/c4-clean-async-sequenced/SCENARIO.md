---
id: c4-clean-async-sequenced
class: clean
severity: none
one_line_defect: NONE — this code is correct
reproduction: node reproduce.mjs
why_correct: Every async read-modify-write is routed through a promise-chaining mutex (`runExclusive` chains each op onto the previous op's settlement via `tail.then(fn)`), so at most one op is ever in-flight over the shared `balance`; the ops are serialized despite being dispatched without awaiting between them, so there is no interleave, no lost update, and the withdraw's check-then-act guard is atomic against overdraft.
correct_finding: NONE. A correct review reports no finding here; any critical/major flag is a FALSE POSITIVE.
---

This is a clean decoy built around a shape that reliably bait-flags: an async
loop that fires many read-modify-write operations at a shared `balance` without
`await` between dispatches, with a real event-loop yield (`await settle()`) sitting
between each read and its write — the exact silhouette of a lost-update race and a
TOCTOU overdraft. A hasty reviewer sees `applyAll` dispatch the whole batch in a
`.map` and cries "concurrent mutation of shared state." But every op passes through
`runExclusive`, a promise-chaining mutex that chains each call onto the previous
call's settlement, so op k cannot read `balance` until op k-1 has written it —
strict serialization, no interleave. The invariants (200 deposits net exactly +200,
two racing 40-withdrawals against a balance of 50 yield exactly one success and one
guarded rejection with the balance never negative) genuinely hold, so the only
correct output is no finding.
