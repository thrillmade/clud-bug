← back to [docs/timeline.md](../timeline.md)

## 2026-06-08 15:54 - Bump sibling templates workflow-py + workflow-ts to v13 (matches main JS template)

**Reasoning:** PR #153's bot review surfaced this minor finding which shipped with v0.6.35 because we merged before fixing. workflow.yml.tmpl is at v13 (carries MAX_DIFF_BYTES 5MB + strict-mode-gate v0.6.35 ref); the python + ts siblings have the same body but stayed at v12. Propagation still works via content-drift (lib/update.js:172), but the update log reports v12→v12 hiding that anything changed. Follow-up to land that fix cleanly with a real clud-bug review.

**Alternatives considered:** Squash into v0.6.36 release (rejected: ship this fix solo, version bump separately)

**Implications:**
- Three template version headers stay in sync going forward
- Demonstrates that splitting cosmetic fixes into their own PR gets a real clud-bug review

---

