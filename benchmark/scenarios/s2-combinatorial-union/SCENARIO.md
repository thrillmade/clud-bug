---
id: s2-combinatorial-union
class: combinatorial
severity: MED-HIGH
one_line_defect: mergeKeyed emits a duplicate key when an organic collision's generated `-N` suffix equals a pre-existing literal `-N` key in the input.
reproduction: node reproduce.mjs
why_no_single_line: Every line is individually correct — the suffix loop, the `seen` set, and the counter each look reasonable; the duplicate only emerges for an input that combines an organic collision with a pre-existing literal `-N` key.
correct_finding: The "keys are unique" invariant is broken. A correct review either NAMES the invariant and constructs the colliding input (`[foo, foo]` + literal `foo-1`), or REPRODUCES it — reporting a MED-HIGH duplicate-key bug, not a line nit.
---

Models the real logmind #165 miss. `mergeKeyed` de-duplicates a colliding key by
appending `-1`, `-2`, … but (a) the generated suffix is never checked against keys
that already exist, and (b) only the ORIGINAL key is added to `seen`, so a later
record whose literal key equals a previously generated suffix collides silently.

Input `base=[{key:'foo'},{key:'foo'}]`, `incoming=[{key:'foo-1'}]` yields keys
`['foo','foo-1','foo-1']` — two records share `foo-1`.

**Fix:** resolve collisions against the set of ALREADY-EMITTED keys (not original
keys), and increment the suffix until the candidate key is genuinely free:
`while (emitted.has(candidate)) n++`. Add each *emitted* key to the set.
