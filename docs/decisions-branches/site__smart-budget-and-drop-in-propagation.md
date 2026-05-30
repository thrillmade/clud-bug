## 2026-05-30 10:29 - site: surface Smart Review Budget + Drop-in Propagation in field-guide voice

**Reasoning:** Cludbug.dev v0.6.22-era content didn't surface the Smart Budget System (Layer 1-3 shipped) or the 0.0.W² zero-admin propagation story or a version pin. User directive (2026-05-30): 'prio some cludbyg and logmind website updates too'. Per user feedback: clear user-visible benefits only, no Layer-N jargon, no 'tokenless' details — brand (field-guide voice) preserved.

**Alternatives considered:** single mega-section bundling both — rejected, two §V/§VI sections fit the field-guide pagination, mention tokenless / Trusted Publishing OIDC — rejected per user feedback, internal-pipeline detail not user benefit, live calibration metric from latest review — deferred, complexity not worth v1 (static narrative carries the point)

**Implications:**
- Stream 4a from token-cost-compression plan now shipping. PR #122 awaiting user async-review on Vercel preview before merge.
- Drop-in propagation story now uses §V Habitat Expansion — pairs nicely with §IV Field Economy as the two-section diptych on operational benefits.

---
## 2026-05-30 11:15 - site: weave skill-driven development (SDD) framing into hero + §I

**Reasoning:** User (2026-05-30) coined Skill Driven Development as the unifying methodology — 'it's like test driven development for AI'. Web search confirmed SDD as unclaimed term. Clud bug is the SDD enforcement tool: skills are the contract, every finding cites the skill, generic advice contradicting a project skill is wrong by definition. Add 'first skill-driven development tool' to hero subtitle + new paragraph in §I Habitat & Habit explaining the SDD ↔ TDD analogy.

**Alternatives considered:** rebrand entire hero around SDD — rejected, 'Skills you write. Reviews the bot does.' already strong; SDD framing additive not replacement, add a new §VII SDD section — rejected, §I is the natural home (where 'why this exists' lives)

**Implications:**
- Same code, materially different positioning: 'PR review tool with skills' → 'the first SDD toolchain.' Zero-marginal cost to add now; high cost to add later if someone else coins a near-term.
- Pairs with logmind.dev SDD framing (parallel commit on PR #88) + GH topic + README touches across thrillmade/{clud-bug, logmind, agent-skills}.

---
## 2026-05-30 11:48 - site: align SDD framing with Zak Elfassi's SkDD prior art

**Reasoning:** After cloning Zak's repo (/Users/ludlow/skills-driven-development) we discovered SkDD (Skills-driven development, plural, with hyphen) is a coined term with a mature toolkit: @zakelfassi/skdd npm package + CI + agentskills.io v1 spec + skillforge + colony + plugins + extensions. Prior commit's 'first skill-driven development tool' claim was wrong by ~weeks. Fix: drop the 'first' claim, adopt his 'Skills-driven' (plural) spelling, link to his blog as the methodology source. Keeps the TDD-analogue framing as our additive differentiator. Full toolchain-positioning rewrite (loop diagram + cross-site links + elevator pitch) deferred until the explore agent's strategic analysis lands.

**Alternatives considered:** revert the prior SDD commit entirely — rejected, the SDD vocabulary push is still load-bearing for our positioning, just the priority claim is wrong, rebrand wholesale to SkDD now — rejected, want explore agent's USE-vs-INSPO-vs-HYBRID analysis before committing to the comprehensive rewrite

**Implications:**
- Surgical fix preserves user-visible benefit framing (smart review budget + drop-in propagation + version pin from original commit). Avoids reputational risk of false priority claim.
- Companion edit on logmind.dev PR #88 + GH topics + READMEs all wait on the explore agent's report (in flight). This commit unblocks PR #122 from looking wrong while that analysis completes.

---
