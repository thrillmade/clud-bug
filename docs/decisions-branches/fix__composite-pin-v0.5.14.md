## 2026-05-26 13:37 - Bump composite pin v0.5.12 -> v0.5.13 in templates (v0.5.14 shipping-gap fix)

**Reasoning:** v0.5.13 shipped the selectReviewHeader/Body sort fix in lib/skills.js but forgot to bump the composite ref pin in templates from @v0.5.12 to @v0.5.13. The composite resolves lib/skills.js from its own checkout at the pinned tag — so installs of v0.5.13 still ran composite @v0.5.12 which has the OLD lib/skills.js without the sort fix. Net effect: the v0.5.13 fix was on npm but UNREACHABLE from any deployed workflow. Same gap a v0.5.10 → v0.5.12 bump would have created if I had not bundled the template pin into the v0.5.12 PR (which I did then but forgot here). v0.5.14 is a one-line-per-template fix: @v0.5.12 -> @v0.5.13 in all 3 review templates + marker v7 -> v8 + version bump + CHANGELOG. No code or test changes (lib/skills.js byte-identical to v0.5.13).

**Alternatives considered:** Roll back v0.5.13 + retag. Rejected: destructive, messy, npm cannot unpublish in a clean way. Ship-forward is the discipline of every other patch release in this stream. Also considered: add a test that asserts the composite pin in templates matches package.json version to prevent the next recurrence. Deferred to v0.5.15+ — not blocking on this hotfix; keeping v0.5.14 tight to ship fast.

**Implications:**
- Existing v7 installs auto-upgrade to v8 via refresh-mode on next clud-bug update, finally picking up the gate-ordering fix that was supposed to land in v0.5.13. This is the SECOND time a lib/skills.js change shipped without the matching composite pin bump (v0.5.10 -> v0.5.12 bump was bundled into v0.5.12 PR; v0.5.13 forgot it). Worth instituting a pre-release checklist: when lib/skills.js changes for composite use cases, templates MUST bump the composite pin in lock-step. The test the CHANGELOG mentions would automate this check.

---
