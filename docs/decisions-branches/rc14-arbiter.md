← back to [docs/timeline.md](../timeline.md)

## 2026-06-28 23:45 - rc.14 (6c): conditional Mantis arbiter — pure shouldEscalate in core + recipe prose

**Reasoning:** 6c ships the quality default as a conditional 3rd Mantis arbiter that fires only when a 2-pass cross-check disagrees on a critical|minor finding. The decision lives in core as a pure shouldEscalate so the hosted bot and the local recipe share one rule (SPEC §11.5); the recipe describes it for local 2-pass cross-check plans.

**Alternatives considered:** Flip BUILTIN_DEFAULT to {count:2} (universal 2-pass) — rejected: 2-pass is Team-tier-only (pricing positions multi-pass as a Team feature), applied app-side as a repo default, not a builtin floor change, Let the arbiter demote/drop the contested critical from the merge gate — deferred: marker+rationale only for rc.14 (resolveVerdict unchanged)

**Implications:**
- Bumps version to rc.14 across the 5 lockstep pins + CHANGELOG
- Makes npm-publish.yml prerelease-aware (derives --tag next from the -rc.N version) so pushing the tag can't publish the prerelease onto the latest channel
- Arbiter display name resolved by mantis tier (not positional index) so a custom <3-role config can't mislabel it

---

