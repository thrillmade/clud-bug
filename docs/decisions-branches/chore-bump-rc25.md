← back to [docs/timeline.md](../timeline.md)

## 2026-07-25 14:35 - chore: bump to 0.7.0-rc.25 (publishes ZP2 notary default-on + ZP3 Action→notary)

**Reasoning:** ZP2 (#237) and ZP3 (#238) merged to main but npm dist-tag next was still rc.24, so local max mode and the self-hosted Action could not reach the notary AT ALL for any consumer — including our own dogfood, which floats @next (the Action's notarize step silently no-ops because build-bundle does not exist in rc.24). This is the single highest-leverage unblock on the launch critical path (clud-bug#243). Release discipline requires the strict-mode-gate composite pin in all 3 workflow templates + action.yml to move lock-step with package.json, so those bump together and the .ci-rendered goldens are regenerated.

**Alternatives considered:** Publish from main without a version bump (rejected: the tag drives OIDC trusted-publish off package.json; version must match the tag), Reconstruct CHANGELOG rc.16-rc.24 retroactively (rejected: nine releases from memory risks recording them WRONG; the gap is marked explicitly and git log between tags is the accurate record)

**Implications:**
- After merge, pushing tag v0.7.0-rc.25 triggers OIDC npm-publish -> dist-tag next; then clud-bug update our repos so local+Action modes go live
- CHANGELOG entries resume at rc.25; the rc.16-rc.24 gap is documented as a gap rather than fabricated

---

