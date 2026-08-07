← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:11 - Fix #263: an unrecognised skill kind resolved to rule (max authority) instead of writing (min)

**Reasoning:** parseFrontmatter's kind ladder knew rule/design/voice and mapped everything else to undefined. SPEC 2.0 §2.1 makes an ABSENT kind a rule skill, so undefined and absent were indistinguishable and every unknown value inherited rule — the tier that may be the sole citation for a finding about code behaviour. SPEC 2.0 renamed voice to writing and the ladder never followed, so kind: writing hit exactly that path. §2.2 states the rule the code needed: 'An unrecognised kind MUST be treated as writing.' New resolveSkillKind() implements both defaults so they fail in opposite directions (absent to rule, unrecognised to writing), and review-prompt now partitions three ways instead of testing != design, rendering writing skills in a §3d prose block that carries §2.2's sole-citation limit rather than folding them into the code-lens skill list.

**Alternatives considered:** Reject a bad kind loudly. SPEC forbids it twice — §2.1 'A consumer MUST NOT refuse to load a skill because of a key it does not recognise' and §2.2 'A skill loads and is applied — a typo does not discard it'. Also considered resolving unknowns to design, the genuinely least-authority tier, which §2.2 explicitly rejects: design routes to a pass that may not run at all, so a typo there would discard the skill rather than demote it. And considered fixing only the parser, but with the router still testing != design a writing skill would keep landing in the code pass, so the resolution would have changed nothing a reviewer sees.

**Implications:**
- Zero catalog skills use kind: writing today (agent-skills origin/main: 4 design, 1 rule, control 52 name: hits), so nothing shipped was mis-applied — this had to land before the first prose skill is authored. voice and voice_scope leave the schema; a skill still carrying them loads and now resolves to writing. A repo with no writing skills renders a byte-identical recipe (11574 bytes, verified). The full three-pass review.passes model (§2.2 + §1.6) is still NOT built — this is the routing fix only. clud-bug-app/lib/orchestrator.ts:1275 has the same != design partition and needs the same change once it bumps past 0.7.0-rc.23.

---

