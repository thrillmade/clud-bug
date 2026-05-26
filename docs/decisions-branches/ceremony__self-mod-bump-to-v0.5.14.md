## 2026-05-26 13:43 - Self-mod ceremony: bump this repo to v8 templates + @v0.5.13 composite (unmask sort fix)

**Reasoning:** v0.5.14 shipped with the @v0.5.12 -> @v0.5.13 composite pin bump in templates. This self-mod ceremony brings this repo from v6 templates (@v0.5.12 composite, broken-ordering selectReviewHeader) to v8 templates (@v0.5.13 composite, correct-ordering selectReviewHeader). After merge, this repo will finally have the gate-ordering fix active on its own PRs — multi-round reviews where the bot resolves prior critical findings will correctly show clean on the second round instead of being shadowed by the round-1 critical comment.

**Alternatives considered:** Skip the self-mod, wait for Monday cron self-update. Rejected: we are mid-dogfood-validation. Waiting a week means PR #66+ continues to suffer the shadowing bug.

**Implications:**
- After merge, the first multi-round-review PR on this repo will validate the v0.5.13 sort fix end-to-end. Expected behavior: round 1 finds N criticals, round 2 fix-push resolves N, gate reads round-2 clean comment correctly. Pre-v0.5.14 (current main) showed clud-bug-review fail on round 2 even with clean verdict because gate shadowed. Self-mod ceremony triggers the usual 401 self-mod guard; admin bypass.

---
