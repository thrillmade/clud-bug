← back to [docs/timeline.md](../timeline.md)

## 2026-06-08 15:31 - Dogfood clud-bug on itself + bump setup-logmind pins to v1.0.1

**Reasoning:** Workflow file install lets PR #154 and all subsequent clud-bug PRs get reviewed by the same npm-template-pinned workflow we ship to consumers (5MB MAX_DIFF_BYTES, paths-check classifier). Pin bumps (v1.0.0 → v1.0.1) fix the setup-logmind gh CLI fallback that breaks check-doc-links + regen-timeline checks org-wide on PRs without GH_TOKEN.

**Alternatives considered:** Leave dogfood install bundled with v0.6.35 fix in PR #153 (rejected: CEO wanted separate PR so workflow lands FIRST and can review subsequent PRs), Leave pins at v1.0.0 and rely on Dependabot to bump (rejected: every PR until that lands stays red on check-doc-links — same blocker that hits PR #154 right now)

**Implications:**
- Once merged, clud-bug repo gets clud-bug-review as a check on every future PR
- logmind-self-update.yml + check-doc-links.yml + regen-timeline.yml all on v1.0.1, matching plan §State/sweep-audit canonical

---

