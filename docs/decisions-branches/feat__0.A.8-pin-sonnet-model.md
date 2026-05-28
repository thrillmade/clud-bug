## 2026-05-28 10:04 - v0.6.11: pin clud-bug-review to Sonnet 4.6 — ~80% cost reduction vs Opus 4.7 (Phase 0.A.8)

**Reasoning:** Log audit on logmind PR #72 confirmed clud-bug-review was running on claude-opus-4-7 (Opus 4.7), the most expensive Claude model. Per Anthropic cost docs: 'Sonnet handles most coding tasks well and costs less than Opus. Reserve Opus for complex architectural decisions.' PR review fits Sonnet's profile, not Opus's. Pin via --model claude-sonnet-4-6 in claude_args across all 3 workflow templates. Pricing delta: Opus 4.7 /MTok input → Sonnet 4.6 /MTok = ~80% reduction per review. Caching multipliers compound on top. v0.6.9 was reserved for this in the plan; shipping as v0.6.11 since v0.6.10 already shipped (0.A.10). Composite pin bumped v0.6.10 → v0.6.11. +1 test asserts all 3 templates pin Sonnet. 210 tests pass.

**Implications:**
- Per-repo override remains available by editing the rendered workflow if a consumer wants Opus for a specific reason. Future model defaults from claude-code-action no longer drift the org's bill.

---
