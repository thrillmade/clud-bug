## 2026-05-27 00:41 - Add excludedBaselines manifest field — per-repo opt-out of bundled baselines

**Reasoning:** Pre-v0.6.0 every clud-bug update unconditionally re-wrote every bundled baseline SKILL.md to .claude/skills/<slug>/. Consumer repos could delete the dir or remove the manifest entry, but the next update silently regenerated. agent-skills surfaced this concretely: it doesn't need clud-bug-collaboration because the repo IS the skill catalog, and there's no way to make that drop stick. The manifest-driven exclusion makes per-repo opt-out durable across updates.

**Alternatives considered:** Drop clud-bug-collaboration from clud-bug's baseline globally — rejected: other consumers may want it. Per-repo opt-out is the right granularity., Add a CLI flag like --no-clud-bug-collaboration — rejected: ephemeral; survives only one invocation. Manifest is the durable surface., Reuse 'installed' array by skipping entries already there — rejected: 'installed' is for skills clud-bug manages; excluded baselines aren't managed, they're suppressed. Different concept, separate field.

**Implications:**
- Cleanup pass also rms .claude/skills/<slug>/ on first run after the slug joins excludedBaselines — users don't have to manually delete the stale dir, and the removal surfaces in changed array as 'excluded baseline <name>: removed' for visibility.
- Field passes through readManifest/writeManifest unchanged via existing ...data and ...manifest spreads; no schema-normalization code needed.
- Minor bump 0.5.16 → 0.6.0; release-discipline.test.js enforced composite pin sync across the 3 review templates + the action.yml header example, all bumped together. Test count 167 (+2).

---
