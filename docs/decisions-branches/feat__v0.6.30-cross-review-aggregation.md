## 2026-05-31 23:42 - clud-bug v0.6.30: cross-review aggregation reads workflow artifacts into dashboard

**Reasoning:** v0.6.29 wired up per-PR artifact uploads but the v0.6.28 dashboard still read only the local .clud-bug.json (always empty unless someone ran update-skill-usage locally). v0.6.30 adds fetchUsageArtifacts + aggregateUsageStream so the dashboard walks workflow artifacts + merges them into one org-level snapshot — the deterministic SkDD loop is now closed end-to-end.

**Alternatives considered:** Read artifacts directly via ZIP-byte parsing in Node (rejected: no built-in ZIP parser, would add adm-zip/yauzl dep — gh run download auto-extracts cleanly), Commit per-review usage data back to main from CI (rejected as v0.6.29 — contents:write expansion = v0.6.23-style regression risk + race-handling complexity), Build a separate aggregation service that crons through artifacts and writes a merged blob (rejected: read-on-demand from CLI is simpler + has no infra to maintain)

**Implications:**
- Dashboard now infers owner/repo from gh repo view of current dir — Just Works when run from the repo root. Falls back to local file in non-git dirs
- Tests inject a mock ghRunner via DEFAULT_GH_RUNNER contract — no shelling out, no GH_TOKEN, no network. 16 tests cover both aggregation purity + fetch error paths
- Artifact retention is 90 days, so the dashboard covers a rolling 3-month window without needing a separate retention policy

---
