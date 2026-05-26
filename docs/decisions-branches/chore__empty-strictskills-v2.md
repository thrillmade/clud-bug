## 2026-05-26 16:50 - Revert strictSkills to empty array (was misconfigured for baselines, v2)

**Reasoning:** Re-open of closed PR #72. PR #59 set strictSkills to the 4 baselines but those are review_mode: shared (one bundled Claude call), so per-skill check-runs were derived by grepping the bot Per-skill scan block lines. classifyPerSkillOutcome requires literal "0 findings" or "n/a"; natural phrasings like "0 critical findings" or "no findings to anchor" fail. Result: false-positive per-skill failures on clean PRs. Empty strictSkills = master clud-bug-review check is the only gate. Per-skill check-runs reappear when a dedicated-mode skill is installed.

**Alternatives considered:** Keep current config + relax classifier. Deferred — classifier-too-literal fix is a v0.6 polish item; design alignment is the priority now.

**Implications:**
- Eliminates false-positive per-skill check-run failures on every clean PR. Master gate semantics preserved (strictMode: true). v0.5.x runtime never made strictSkills items into separate Claude calls anyway — the v0.6 App will be where that becomes meaningful.

---
