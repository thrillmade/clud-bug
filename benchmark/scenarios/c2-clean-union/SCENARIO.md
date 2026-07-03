---
id: c2-clean-union
class: clean
severity: none
one_line_defect: NONE — this code is correct
reproduction: node reproduce.mjs
why_correct: Collisions are resolved against the set of ALREADY-EMITTED keys (originals plus generated suffixes) and the suffix is probed forward until genuinely free, so a generated `-N` can never coincide with a pre-existing literal `-N` key.
correct_finding: NONE. A correct review reports no finding here; any critical/major flag is a FALSE POSITIVE.
---

The clean counterpart to s2-combinatorial-union. It has the same risky SHAPE — a
per-original-key counter that appends `-1`, `-2`, … to de-duplicate colliding
keys — which is exactly the pattern that can emit a suffix equal to a pre-existing
literal `-N` key. A hasty reviewer sees the counter and false-flags the combinatorial
duplicate-key bug. But this version is genuinely correct: `emitted` tracks every key
actually output (originals AND suffixes, not just originals), and the suffix search
uses a `do … while (emitted.has(key))` probe that advances until the candidate is free —
so the exact adversarial input `[foo, foo] + [foo-1]` yields distinct keys
`['foo', 'foo-1', 'foo-1-1']`, and even a counter hint that lands on an already-emitted
literal suffix is skipped over.
