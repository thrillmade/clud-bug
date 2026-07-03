# clud-bug review-hardening benchmark (clud-bug-app #87)

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

Current scenarios (the 3 regression cases, one per class):
| id | class | models | severity |
|---|---|---|---|
| `s1-emergent-marker` | emergent | logmind #169 (forged col-0 marker) | MAJOR |
| `s2-combinatorial-union` | combinatorial | logmind #165 (duplicate key on collision × literal `-N`) | MED-HIGH |
| `s3-crosscutting-sort` | cross-cutting | logmind #171 (date-only sort in another module) | MED-HIGH |

## Running

Confirm every scenario reproduces a real bug:
```bash
for d in scenarios/*/; do node "$d/reproduce.mjs"; echo "  ($d exit=$?)"; done   # each exits 1
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
