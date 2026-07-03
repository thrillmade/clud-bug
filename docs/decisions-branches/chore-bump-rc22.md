← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 15:00 - chore: bump clud-bug to 0.7.0-rc.22 (ships the Phase R review-hardening batch)

**Reasoning:** rc.22 publishes the full Phase R review-hardening batch merged this session: R1 invariants + R2 reproduction-as-grounding (+ the panel-caught RCE fix) + R3 unverified verdict + R2-hosted grounding + R6-local probe-run step + the 20-scenario benchmark (100% recall/precision). The npm-publish.yml workflow publishes package.json's version on a v* tag push and auto-routes a -rc version to the 'next' dist-tag, which every repo's floating @next hook picks up. Bumping package.json is the source of truth (gen-version.mjs derives the CLI version from it).

**Implications:**
- After this merges, cut the release by pushing the tag: git tag v0.7.0-rc.22 && git push origin v0.7.0-rc.22 → npm-publish.yml ships clud-bug@0.7.0-rc.22 to @next

---

