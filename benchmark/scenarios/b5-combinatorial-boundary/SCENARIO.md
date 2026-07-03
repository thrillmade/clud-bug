---
id: b5-combinatorial-boundary
class: combinatorial
severity: MED-HIGH
one_line_defect: consolidatePorts tracks the running group's coverage in a half-open `reach` (hi + 1) at init/reset but extends it with an inclusive `r.hi` on merge, so after a prior overlapping merge a following range that starts exactly at the shared boundary port is wrongly split off into its own range that still contains that boundary port.
reproduction: node reproduce.mjs
why_no_single_line: No single line is wrong — init/reset correctly use `hi + 1`, the merge-extend `reach = Math.max(reach, r.hi)` is the canonical "extend the running max" idiom, and `r.lo < reach` is a correct strict overlap test; the defect is the half-open-vs-inclusive convention MISMATCH between the init/reset lines and the merge-extend line, which only bites when an exactly-adjacent pair and a prior-overlap ordering combine.
correct_finding: Report that the pairwise-disjoint output invariant is broken because `reach` mixes conventions — seeded as half-open `hi + 1` but re-extended with inclusive `r.hi`, so after any merge it under-shoots the true first-free port by one and the boundary test `r.lo < reach` mis-fires at exact adjacency. Ground it either by running `node reproduce.mjs` (8000-8008 splits into 8000-8005 and 8005-8008, port 8005 in both) or by naming the invariant (outputs must be pairwise disjoint / cover the union; `reach` must equal cur.hi + 1 after every extend, which the merge branch violates).
---

`consolidatePorts` merges inclusive port ranges that share a port and must return
pairwise-disjoint ranges. It tracks the current group as `reach` = the first free
port past it (half-open `hi + 1`). Init and the new-group reset both use `hi + 1`,
but the merge-extend line writes `reach = Math.max(reach, r.hi)` — inclusive `hi`,
one short of the half-open convention. Alone each line is fine; combined, any prior
overlapping merge deflates `reach` to `hi` instead of `hi + 1`, and a following
range starting exactly at that boundary port fails the strict test (`8005 < 8005`
instead of `8005 < 8006`) and is split off — leaving the boundary port claimed by
two ranges. It only manifests for the exact-adjacency + prior-overlap combination:
drop the overlapping predecessor, or move the successor off the boundary, and the
output is correct.

**Fix:** keep `reach` consistently half-open — extend with `Math.max(reach, r.hi + 1)`
(or drop the `reach` variable and test `r.lo <= cur.hi` directly against the inclusive
`cur.hi`). Either restores `reach === cur.hi + 1` after every extend and the
pairwise-disjoint invariant.
