← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 15:00 - chore: bump clud-bug to 0.7.0-rc.22 (ships the Phase R review-hardening batch)

**Reasoning:** rc.22 publishes the full Phase R review-hardening batch merged this session: R1 invariants + R2 reproduction-as-grounding (+ the panel-caught RCE fix) + R3 unverified verdict + R2-hosted grounding + R6-local probe-run step + the 20-scenario benchmark (100% recall/precision). The npm-publish.yml workflow publishes package.json's version on a v* tag push and auto-routes a -rc version to the 'next' dist-tag, which every repo's floating @next hook picks up. Bumping package.json is the source of truth (gen-version.mjs derives the CLI version from it).

**Implications:**
- After this merges, cut the release by pushing the tag: git tag v0.7.0-rc.22 && git push origin v0.7.0-rc.22 → npm-publish.yml ships clud-bug@0.7.0-rc.22 to @next

---

## 2026-07-03 15:04 - chore: sync the strict-mode-gate composite pin to v0.7.0-rc.22 (release discipline)

**Reasoning:** The rc.22 bump left the strict-mode-gate@vX composite pin stale in the 3 rendered workflow templates + .github/actions/strict-mode-gate/action.yml. The release-discipline + prompts tests assert those pins match package.json version, so a bare version bump fails CI until they're synced. Bumped all four rc.21→rc.22. This is the required manual release chore (no auto-sync script — gen-version.mjs only derives the CLI version).

**Implications:**
- Release-discipline is now: bump package.json + sync the 4 strict-mode-gate pins together. A future improvement could script this sync.

---

