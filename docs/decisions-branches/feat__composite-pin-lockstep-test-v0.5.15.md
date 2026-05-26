## 2026-05-26 13:52 - Add release-discipline test for composite-pin lock-step (v0.5.15)

**Reasoning:** Got bitten twice this session: v0.5.10 -> v0.5.12 caught the composite-pin gap in time (bundled the bump into v0.5.12 PR), but v0.5.13 missed it entirely (lib/skills.js sort fix shipped to npm unreachable from deployed workflows because templates still pinned @v0.5.12). v0.5.14 hotfixed it. The root cause: no automated check that the composite pin in templates matches the current package.json version. v0.5.15 adds test/release-discipline.test.js with two assertions: (1) strict-mode-gate@vX.Y.Z in all 3 review templates must equal package.json version, (2) all 3 templates must agree on the pin. CI fails any future PR that bumps package.json without bumping the composite pin in lock-step. Also fixes the action.yml header doc reference that still pointed at @v0.5.12 (clud-bug-review observation on PR #65).

**Alternatives considered:** Soft check (pin must reference an existing tag, not necessarily equal version). Rejected: doesn nt prevent the shipping-gap class of bug — every old tag references an existing composite, so the soft check would still allow shipping a fix in v0.5.X with pin at @v0.5.(X-1). Also considered: skip the lock-step rule, rely on a manual release checklist. Rejected: process discipline that depends on me remembering is exactly what failed twice this session.

**Implications:**
- Every future release now has a mandatory composite-pin bump even if action.yml/lib/skills.js did not change in that release. Cost: one-line-per-template + marker bump on each PR. Benefit: eliminates the entire silent-fix-not-reachable class of bug. The lock-step rule becomes self-enforcing; any drift fails CI immediately. Also worth noting: this exercises the lock-step rule on its own release — v0.5.15 bumps the composite pin alongside package.json without any actual composite/lib-skills change.

---
