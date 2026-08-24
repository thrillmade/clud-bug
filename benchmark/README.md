# clud-bug review-hardening benchmark (clud-bug-app #87)

> **Methodology superseded (see [`RESULTS.md`](RESULTS.md) for the full caveat).**
> This corpus was scored under the execution-grounded **Phase R** recipe —
> reviewers ran each scenario's withheld `reproduce.mjs` themselves. SPEC 2.0 §4.7
> now bans reviewer execution; clud-bug#281 deleted the probe surface Phase R
> depended on and replaced it with the CI-evidence model. The 100%/100% figures
> below are a real historical measurement, **not a reproducible claim under the
> current recipe** — a fresh run against the CI-evidence recipe is pending.

The **launch gate** for retiring the manual adversarial panel. It measures whether
clud-bug's hardened review catches bugs that live on **no single changed line** —
the class the old *"quote the exact diff line or drop"* gate silenced.

## Why

Three real bugs a manual panel caught but clud-bug missed (logmind #169/#165/#171)
shared one property: no single changed line is wrong. The bug is **emergent** (bad
data through individually-correct lines), a **combinatorial invariant breach**, or
**cross-cutting** (the cause is in another file the diff only exposes). A reviewer
that can only cite a diff line has nothing to cite. The fix (Phase R): accept a
**reproduction** or a **named violated invariant** as grounding equal to a quoted
line. This benchmark proves the fix works.

## Structure

`scenarios/<id>/`
- `module.mjs` — the "PR under review" (self-contained, runnable with plain `node`,
  the planted defect in a form where no single line is obviously wrong).
- `reproduce.mjs` — `node reproduce.mjs` demonstrates the defect (`BUG CONFIRMED` +
  exit 1 when present; `ok:` + exit 0 if fixed). This is the reproduction a good
  reviewer discovers on its own.
- `SCENARIO.md` — the **answer key** (class, severity, the invariant, the correct
  finding). Withheld from reviewers during scoring.

Current corpus: **20 scenarios** — 14 true-positive (across emergent /
combinatorial / cross-cutting) + 6 clean decoys (precision controls). A `clean`
scenario is correct code with a bug-prone *shape*; flagging it is a false positive.
The `s*` scenarios are the regression cases from the real misses (logmind
#169/#165/#171); `b*` are diverse true-positives; `c*` are decoys. **See
`RESULTS.md` for the full per-scenario scoreboard** (100% recall + 100% precision
across 60 reviews, **under the now-superseded Phase R methodology** — see the
caveat above).

## Running

Confirm every scenario reproduces a real bug:
```bash
for d in scenarios/*/; do node "$d/reproduce.mjs"; echo "  ($d exit=$?)"; done   # buggy → exit 1, clean decoys → exit 0
```
Score the hardened recipe: give a reviewer only `module.mjs` (withhold the answer
key), have it follow the rendered recipe (`clud-bug review-prompt --trigger pr`),
and judge whether it caught the planted defect + how it grounded it. The
`r7-score-benchmark` workflow automates this with 3 independent reviewers/scenario.

## The launch-gate criteria (Option B — hard-gate)

The manual panel comes off — and only then do we launch — when ALL hold:
1. **Seeded benchmark ≥20** planted MAJOR/MED-HIGH across all 3 classes (incl. these
   originals as regression cases) → **100% of MAJOR, ≥90% of MED-HIGH** caught, each
   with a reproduction transcript.
2. **10 consecutive** trigger-surface PRs where clud-bug's blocking set ⊇ the panel's
   (any miss resets to 0).
3. **≤1** false-blocking MAJOR across those 10.
4. **Zero** silent downgrades (no later-confirmed-real bug emitted only as a watch-item).
5. Probe-coverage floor: every invariant has a green/red probe on every invariant-touching PR.

**Re-arm:** any recipe/skill bump that regresses this benchmark re-opens the gate.
This dir starts at 3 scenarios; expand toward ≥20 before the gate can close.

> **Criteria 1 and 5 are stale under SPEC 2.0 §4.7.** Criterion 1's "reproduction
> transcript" and criterion 5's "probe" both describe the reviewer-execution
> capability clud-bug#281 deleted (see the caveat at the top of this file);
> criterion 5's underlying mechanism, R6-action's sandboxed CI probe job, is
> cancelled outright — §4.7 bans it. Both need rewording against the CI-evidence
> model before this gate can be evaluated as written.
