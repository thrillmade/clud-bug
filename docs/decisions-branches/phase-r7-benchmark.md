← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 12:06 - Phase R7: seeded review-hardening benchmark + first scoreboard — 9/9 catch on the 3 miss classes

**Reasoning:** Option B hard-gates launch on clud-bug provably replacing the manual panel. Built the launch-gate benchmark: 3 faithful, self-contained, reproducible planted-bug scenarios (one per class, modeled on the real misses logmind #169 emergent / #165 combinatorial / #171 cross-cutting), each with a runnable reproduce.mjs (BUG CONFIRMED, exit 1) + a withheld SCENARIO.md answer key. Scored via a workflow: 3 independent reviewers per scenario followed the rendered hardened recipe on module.mjs only (answer key withheld) + a judge scored each vs the key. Result: 9/9 caught (100%), every catch grounded by a reproduction the reviewer WROTE AND RAN — incl. the cross-cutting case where reviewers opened the other module the diff only exposed. Proves reproduction-as-grounding catches the classes the quote-only gate silenced. Baseline; gate needs >=20 scenarios + the shadow streak before it closes.

**Alternatives considered:** Score only 1 review/scenario (rejected: reviews are non-deterministic; 3/scenario gives a consistency signal — all 3/3 here), Let authoring agents also write the scoring harness (rejected: authored scenarios myself where an agent got prompt-injected + derailed s2; re-authored s2 directly — the injection was treated as untrusted data, not obeyed)

**Implications:**
- Expand the corpus toward >=20 (more per class + new classes); wire R6 probe execution + the Action sandboxed job; the benchmark auto-re-arms on any recipe/skill regression

---

