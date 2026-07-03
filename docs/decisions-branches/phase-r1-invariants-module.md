← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 10:24 - Phase R keystone: add src/core/invariants.ts — executable-probe invariants config + in-scope gate

**Reasoning:** clud-bug's grounding gate (quote the exact diff line or DROP) is a correct floor for nit-suppression but a ceiling: it structurally cannot represent an emergent / combinatorial / cross-cutting bug that lives in no single changed line (clud-bug-app #87, 3 real logmind misses). An INVARIANT pairs a behavioral property with an executable PROBE (a command that goes RED when violated); RED output is trusted machine evidence equal to a quoted line. This module is the shared pure brain (mirrors design.ts): tolerant config parse + a pr-only in-scope gate. Purely additive — not yet wired into the recipe (R2).

**Alternatives considered:** Prose-only reviewContext invariants (rejected: checked statically against the diff, so they can never fire on a no-single-line bug — the exact ceiling #87 names), Per-skill SKILL.md frontmatter invariants (rejected: the frontmatter parser drops unknown nested keys; a manifest-level block is cleaner + matches design/reviewPasses)

**Implications:**
- R2 wires shouldRunProbes into review-prompt.ts + prompt-builder.ts (grounding gate = quoted line OR reproduction OR named invariant); execution differs per mode (local: run; hosted: static-degrade; Action: separate CI job)

---

