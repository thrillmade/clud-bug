← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 12:51 - Phase R7 corpus expansion: 9-scenario benchmark — 100% recall + 100% precision

**Reasoning:** Expanded the launch-gate benchmark from 3 to 9 scenarios to test GENERALIZATION + PRECISION (both Option B criteria). Added 3 diverse true-positives (b4 shared-mutable-state leak, b5 half-open/inclusive boundary mismatch, b6 local-time dayKey in another module — all faithful to their class, different mechanisms than the originals) + 3 CLEAN DECOYS (c1 base64-escaped marker, c2 correct emitted-key tracking, c3 full-timestamp comparator — correct code with a bug-prone shape). Scored 3 reviewers/scenario: 18/18 buggy reviews caught (100% recall, all reproduction-grounded) + 9/9 clean reviews correct (100% precision, zero false positives — reviewers reproduced the tricky input, confirmed the invariant holds, reported no bug). Proves the hardening generalizes AND stays precise. Authoring hardened against the prompt-injection that derailed a prior agent (instruction-hygiene note; no derailment this round).

**Alternatives considered:** Only add true-positives (rejected: precision matters — the gate needs <=1 false-block; clean decoys measure that clud-bug doesn't manufacture findings on correct look-alike code)

**Implications:**
- 9/20 toward the gate with a perfect record; continue toward >=20 + R6-action + the shadow streak

---

