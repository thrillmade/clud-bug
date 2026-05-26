## 2026-05-26 16:30 - Propagate logmind v0.2.8 to this repo (1C, finally clean)

**Reasoning:** Three logmind releases happened during this session: v0.2.6 fixed the regen-timeline pin propagation gap that was preventing pin updates from reaching existing installs. v0.2.7 was a placeholder release that did not include the planned pinVersion fix. v0.2.8 ships the actual pinVersion fix in logmind-self-update.yml.template — replaces the PyYAML-dependent python3 one-liner (which silently failed because actions/setup-python@v5 does not bundle PyYAML) with a grep-based parser that only depends on the fact that pinVersion is a top-level scalar key. Excellent inline comment in the template explains the v0.2.7-and-earlier failure mode for future maintainers. This PR brings the repo to the clean v0.2.8 state with all 3 logmind workflows pinned to 0.2.8 + logmind-self-update.yml at v2 marker (template content bumped) + check-doc-links.yml at v2 (paths-filter fix from v0.2.2) + regen-timeline.yml at v1 (no body change needed). logmind doctor now reports Stack status: OK across both clud-bug 0.5.15 and logmind 0.2.8.

**Alternatives considered:** Wait for monday cron self-update. Rejected: 1C has been blocked-or-bouncing all session; closing it cleanly now closes Phase 1 of the v0.6 plan entirely.

**Implications:**
- Completes Phase 1 of the v0.6 plan (1A strictSkills, 1B {{CCA_VERSION}}, 1C logmind v0.2.8, 1E BB.4 marketing). Remaining Phase 1 items: 1D skills.sh listing (user-owned, out-of-band). Phase 2 (Stream W, the App) and Phase 3 (Stream X cludbug.dev /install) remain untouched.

---
