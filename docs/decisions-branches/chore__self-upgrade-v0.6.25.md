## 2026-05-29 22:32 - chore: clud-bug self-upgrade to v0.6.25 (dogfood Smart Budget Phase 1)

**Reasoning:** Re-renders clud-bug's own .github/workflows/clud-bug-review.yml against the v0.6.25 templates. Before this, clud-bug's own workflow was rendered at v0.6.22 (last self-upgrade via PR #115 / §3 dogfood) which means clud-bug-review on clud-bug PRs runs with hard-coded --max-turns=15, defeating the v0.6.25 smart budget on the very repo that ships it. Concrete impact: PR #118 (Phase 1 ship) hit max_turns=15 because of this gap; without the self-upgrade, every future template change to clud-bug will fight the same wall. Brings the AGENTS.md block to v6-pointer marker (logmind 0.5.6+) too.

**Implications:**
- Future PRs on clud-bug will get the smart budget (jq estimator, 20% safety margin, 60-turn ceiling). App-guard will fire on this PR's clud-bug-review check (workflow-self-modification); admin-bypass per documented exception. This is the LAST admin-bypass on clud-bug needed until v0.6.26's 0.0.W² widens the skip allowlist.

---
