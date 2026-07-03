← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 10:53 - Phase R2: grounding gate = quoted line OR reproduction OR named invariant; no MAJOR watch-item (local recipe)

**Reasoning:** The recipe's gate ('quote the exact line or DROP') is a correct floor for nits but a ceiling: an emergent / combinatorial / cross-cutting bug lives on no single changed line, so the rule that kills false positives silenced 3 real bugs (#169/#165/#171). Expand grounding to accept a REPRODUCTION (command + observed output) or a NAMED VIOLATED INVARIANT as evidence equal to a quoted line — a repro is stronger, not weaker, so FP discipline is preserved. Add a severity rule: a MAJOR may not hide as a soft watch-item on static doubt — reproduce it (blocking) or refute it with a clean check (drop). Extend the regression lens with invariant-construction + a cross-package 'name the file:symbol and read its contract' step. Scoped to the LOCAL recipe (the agent has a shell to run repros); the hosted serverless prompt-builder needs a separate no-shell adaptation.

**Alternatives considered:** Keep quote-only grounding (rejected: the exact #87 ceiling — cannot represent a no-single-line bug), Require an executed reproduction for EVERY finding (rejected: over-heavy for minor/nits; a quoted line still grounds minor/preexisting)

**Implications:**
- Hosted prompt-builder.ts needs its own grounding adaptation (invariant-naming + reasoned repro, no execution); R6 wires the formal .clud-bug.json probes (from R1) + the base-ref trust boundary for probe commands

---

## 2026-07-03 10:55 - Phase R2 self-review fix: arbiter resolves a disputed MAJOR by reproduction, not static doubt

**Reasoning:** The clud-bug max-mode dogfood review of the R2 commit caught a coherence gap I introduced: the multi-pass arbiter tiebreak still said 'when unresolvable from the diff + cited skill, surface at higher severity' AND specced the arbiter as 'read-only tools' — both inconsistent with R2's new rule that a MAJOR may not rest on static doubt. Fix: grant the arbiter the ability to run a reproduction (build/test/command, no repo mutations) and make the tiebreak RESOLVE a disputed critical/MAJOR by reproduction (upheld→blocking, clean-check→dropped); surface-at-higher-severity is now the fallback only when a repro is impossible, and stays the rule for a minor dispute.

**Alternatives considered:** Leave the arbiter read-only + surface-on-doubt (rejected: the exact static-doubt terminal state R2 forbids — the dogfood flagged it)

**Implications:**
- The dogfood loop is working: clud-bug's own hardened review caught a real gap in the hardening PR before merge

---

