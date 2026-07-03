# Benchmark results

## Run 1 — baseline (hardened recipe, post R1/R2/R3/R2-hosted)

3 scenarios × 3 independent reviewers = **9 reviews**. Each reviewer received only
`module.mjs` (answer key + provided `reproduce.mjs` withheld), followed the rendered
hardened recipe (`clud-bug review-prompt --trigger pr`), and had to discover **and
ground** the bug itself. A separate judge scored each review against the answer key.

| scenario | class | severity | caught | grounding |
|---|---|---|---|---|
| `s1-emergent-marker` | emergent | MAJOR | **3/3** | reproduction ×3 |
| `s2-combinatorial-union` | combinatorial | MED-HIGH | **3/3** | reproduction ×3 |
| `s3-crosscutting-sort` | cross-cutting | MED-HIGH | **3/3** | reproduction ×3 |

**9/9 caught (100%). Every catch was grounded by a reproduction the reviewer wrote
and ran** — not a quoted line. Even the cross-cutting case: reviewers opened the
`sort.mjs` module the diff only *exposed* (never changed) and reproduced the same-day
reorder — precisely the behavior the old "quote the exact diff line or drop" gate
could not represent.

**Read:** reproduction-as-grounding (Phase R) catches all three bug classes the
quote-only gate silenced, on the regression cases derived from the real misses
(logmind #169/#165/#171). This is the baseline that proves the mechanism.

**Calibration note (not a miss):** reviewers flagged the two MED-HIGH scenarios as
`critical` (over-escalation). Safe for a gate — they are real bugs, correctly blocked
— but a severity-precision item to watch as the corpus grows.

**Gate status:** 3/3 classes proven; the gate needs **≥20** scenarios at **100% of
MAJOR / ≥90% of MED-HIGH** (+ the 10-PR shadow streak) before the manual panel comes
off. Next: expand the corpus toward 20 and wire the probe-execution path (R6).
