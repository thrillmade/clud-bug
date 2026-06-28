← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 16:22 - Add clud-bug review-prompt verb — the plan-aware local-review recipe (PR C keystone)

**Reasoning:** Turns the shared engine into the native commit-review recipe the in-session subagent runs: loads the repo's skills + .clud-bug.json, plans via planReview, and renders a plan-aware recipe — a single fast (beetle-tier) pass on commit, the full multi-pass fan-out (resolved tiers + aggregation mode) on push/pr. The dynamic, engine-driven counterpart of the rc.11 static /clud-bug-review slash command. Rides the unpublished rc.12.

**Alternatives considered:** Keep the static recipe only — rejected: it can't reflect the engine's per-repo plan (tiers, pass count, budget, trigger).

**Implications:**
- Consumed by PR C's --with-hooks (renders this recipe into the type:agent hook prompt). 2-lens adversarial review caught + fixed: rawSkillMd not forwarded (dead SKILL.md override layer), origin/HEAD diff fallback (empty-diff false-clean in CI), cross-check incoherence, summary pass-count contradiction, silent --trigger typo->commit, global-mode-from-first-skill. Deferred: filtering meta skills (clud-bug-collaboration) from the review-skill load — needs a frontmatter signal. 831 tests green.

---

