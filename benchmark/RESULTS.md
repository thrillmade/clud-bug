# Benchmark results

Corpus: **9 scenarios** — 6 true-positive (2 per class) + 3 clean decoys (precision
controls). Each scenario scored by 3 independent reviewers, each given only the PR
module (answer key + provided `reproduce.mjs` withheld), following the rendered
hardened recipe; a separate judge scored each review against the answer key.

## Headline

| metric | result |
|---|---|
| **Recall** (buggy caught) | **18/18 reviews (100%)** across 6 bugs / 3 classes |
| **Precision** (clean not false-flagged) | **9/9 reviews (100%)**, zero false positives |
| **Grounding** | every catch grounded by a **reproduction the reviewer wrote + ran** |

## Run 1 — the 3 regression cases (from the real misses)

| scenario | class | severity | caught |
|---|---|---|---|
| `s1-emergent-marker` | emergent | MAJOR (← logmind #169) | **3/3** repro |
| `s2-combinatorial-union` | combinatorial | MED-HIGH (← #165) | **3/3** repro |
| `s3-crosscutting-sort` | cross-cutting | MED-HIGH (← #171) | **3/3** repro |

## Run 2 — corpus expansion (diverse true-positives + precision decoys)

| scenario | class / kind | outcome |
|---|---|---|
| `b4-emergent-accumulator` | emergent MAJOR (shared-mutable-state leak) | **3/3** true-positive, repro |
| `b5-combinatorial-boundary` | combinatorial MED-HIGH (half-open vs inclusive boundary) | **3/3** true-positive, repro |
| `b6-crosscutting-timezone` | cross-cutting MED-HIGH (local-time dayKey in another module) | **3/3** true-positive, repro |
| `c1-clean-escaped-marker` | **clean decoy** (base64-encoded → no forge) | **3/3** true-negative |
| `c2-clean-union` | **clean decoy** (tracks all emitted keys) | **3/3** true-negative |
| `c3-clean-sort` | **clean decoy** (comparator falls through to full timestamp) | **3/3** true-negative |

## Read

Reproduction-as-grounding (Phase R) catches every planted bug across all three
classes **and** stays precise on look-alike correct code — the reviewers *ran the
input* and reported no bug when the invariant held. Even the cross-cutting cases were
caught by opening the pre-existing module the diff only *exposed*. This is the recall +
precision the launch gate requires.

**Calibration note (not a miss):** reviewers flag MED-HIGH bugs as `critical`
(over-escalation, safe for a gate). A severity-precision item as the corpus grows.

## Gate status

**9/20 scenarios, perfect record (100% recall, 100% precision).** The gate closes at
**≥20** scenarios (100% of MAJOR / ≥90% of MED-HIGH) + the 10-PR shadow streak +
zero silent downgrades. Next: continue toward 20, wire R6-action (the sandboxed CI
probe job), and start the shadow streak on live PRs.
