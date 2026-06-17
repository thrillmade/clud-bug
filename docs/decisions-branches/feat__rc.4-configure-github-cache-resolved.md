← back to [docs/timeline.md](../timeline.md)

## 2026-06-17 03:39 - v0.7.0-rc.4: configure-github + cache comment + resolved findings naming

**Reasoning:** Three SPEC-aligned core enhancements bundled for the v0.7.0 Marketplace prep ship train. Phase 6 task #227 (configure-github applier), task #224 (SPEC §6.7.3 cache comment in review doc-file), and task #228 (SPEC §1.8.1 Resolved/Still-open blocks). All three live in src/core/ so clud-bug-app's Phase 4 re-import lands them in one wave; App-side consumption is a follow-up PR dispatched AFTER USER tags + publishes.

**Alternatives considered:** Could have shipped each wave as a separate rc bump (rc.4 = configure-github, rc.5 = cache, rc.6 = resolved), but they all target the same Marketplace-prep milestone and the App consumer needs all three together to satisfy the Phase 6 acceptance gate. One rc bump minimizes the consumer wave count.

**Implications:**
- Next: USER tags v0.7.0-rc.4 + npm publish. clud-bug-app then bumps its clud-bug dep + threads renderReviewFile's new cacheStats + resolvedFindings/stillOpenFindings params from the existing review-orchestrator. configure-github gets wired into the App's repo-onboarding endpoint as a follow-up.

---

