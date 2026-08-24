# Benchmark results

> **Methodology superseded — figures below are a historical record, not a
> reproducible claim.** This run measured the execution-grounded **Phase R**
> recipe: reviewers were handed each scenario's withheld `reproduce.mjs` and
> ran it themselves to ground a finding. SPEC 2.0 §4.7 now bans reviewer
> execution outright (clud-bug#281 deleted the probe surface this recipe
> depended on — `src/core/invariants.ts`, `shouldRunProbes`, every
> RUN/EXECUTE instruction), replacing it with the CI-evidence model
> (`ciChecks` / SPEC 2.0 §4.7). The numbers below are real — this is what
> that corpus scored under Phase R — but they are **not reproducible under
> the current recipe**, and no fresh run against the CI-evidence recipe has
> been scored yet.

Corpus: **20 scenarios** — 14 true-positive (across 3 bug classes) + 6 clean decoys
(precision controls). Each scored by **3 independent reviewers**, each given only the
PR module (answer key + provided `reproduce.mjs` withheld), following the rendered
hardened recipe; a separate judge scored each review against the answer key.

## Headline (60 reviews, Phase R methodology — superseded, see above)

| metric | result |
|---|---|
| **Recall** (buggy caught) | **42/42 reviews (100%)** across 14 bugs / 3 classes |
| **Precision** (clean not false-flagged) | **18/18 reviews (100%)**, zero false positives |
| **Grounding** | every catch grounded by a **reproduction the reviewer wrote + ran** — the capability SPEC 2.0 §4.7 now bans |

This satisfied the seeded-benchmark launch criterion (≥20 scenarios → 100% of MAJOR,
≥90% of MED-HIGH) **under Phase R**: 100% on every scenario, MAJOR and MED-HIGH
alike. See "Gate status" below for what that does and doesn't mean today.

## True-positives (14) — all 3/3 caught, reproduction-grounded

| scenario | class | mechanism |
|---|---|---|
| `s1-emergent-marker` | emergent | forged col-0 marker (← logmind #169) |
| `b4-emergent-accumulator` | emergent | shallow-spread of a frozen template aliases nested arrays |
| `b7-emergent-async-race` | emergent | concurrent read-modify-write across an await drops samples |
| `b8-emergent-float-accumulate` | emergent | binary-float money drift strands an invoice |
| `b14-emergent-mutation-shared-default` | emergent | default-param object mutated across calls |
| `s2-combinatorial-union` | combinatorial | dup key on collision × literal `-N` (← #165) |
| `b5-combinatorial-boundary` | combinatorial | half-open vs inclusive boundary mismatch |
| `b9-combinatorial-pagination` | combinatorial | orphan-control × clamp window drops one item |
| `b10-combinatorial-permission` | combinatorial | archive-freeze bypassed via the owner operand |
| `b13-regression-return-shape` | combinatorial | shared singleton-unwrap breaks an array contract |
| `s3-crosscutting-sort` | cross-cutting | date-only sort in another module (← #171) |
| `b6-crosscutting-timezone` | cross-cutting | local-time `dayKey` in a pre-existing module |
| `b11-crosscutting-error-contract` | cross-cutting | helper returns null (not throws) — caller's guard never fires |
| `b12-crosscutting-config-default` | cross-cutting | a `0` sentinel default collapses a poll deadline |

## Clean decoys (6) — all 3/3 correctly NOT flagged

`c1-clean-escaped-marker` · `c2-clean-union` · `c3-clean-sort` ·
`c4-clean-async-sequenced` · `c5-clean-pagination` · `c6-clean-permission` —
correct code with a bug-prone *shape*. Reviewers reproduced the tricky input,
confirmed the invariant **holds**, and reported nothing. Zero false positives.

## Read

Reproduction-as-grounding (Phase R) catches every planted bug across all three
classes **and** stays precise on look-alike correct code — reviewers *ran the input*
rather than guessing. Cross-cutting bugs were caught by opening the pre-existing
module the diff only *exposed*.

**Calibration note (not a miss):** reviewers flag MED-HIGH bugs as `critical`
(over-escalation, safe for a gate). A severity-precision item to watch.

## Gate status

**Seeded-benchmark criterion: MET under Phase R** (20 scenarios, 100% recall + 100%
precision) — **not current.** Phase R's execution-grounded methodology is
superseded by SPEC 2.0 §4.7's CI-evidence model (see the caveat at the top of this
file); this criterion needs to be re-measured against the CI-evidence recipe before
it can be claimed as met today. The rest of the launch-gate criteria this measured
against are also stale: the **probe-coverage floor** it names no longer applies —
R6-action, the sandboxed CI probe job it referred to, is cancelled (§4.7 bans
executable probes). Remaining, methodology-independent: the **10-PR shadow streak**
on live PRs (panel runs alongside; accrues over time) and **zero silent
downgrades** confirmed in production. Auto-re-arms on any recipe/skill regression.
