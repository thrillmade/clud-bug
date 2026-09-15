← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 13:50 - Dependabot targets dev, not main: dependency bumps ride the normal dev→main promotion

**Reasoning:** Dependabot reads its config from the default branch and opened bumps against main, so main drifted 22 commits ahead of dev in three weeks (vitest 4→5 among them) and the resync was a 16-file conflict lane. dev is the integration branch; every change, including dependency bumps, should land there and promote together. dependabot-auto-merge.yml has no base-branch condition and dev allows auto-merge, so the auto-merge behaviour is unchanged.

**Alternatives considered:** Keep main as the target and sync dev after every bump (rejected: manual, and it is exactly the drift we just paid for)

**Implications:**
- The first weekly run after merge opens bumps against dev; main receives them at the next promotion

---

