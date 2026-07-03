← back to [docs/timeline.md](../timeline.md)

## 2026-07-03 18:34 - configure-github: migrate canonical ruleset from retired classic branch-protection to v2 rulesets API (SPEC §7 parity)

**Reasoning:** The bundled data/canonical-v1.json + src/core/configure-github.ts still spoke the classic branch-protection API (PUT branches/{b}/protection, 1 required approval, a required 'test' status context) — out-of-spec and higher-friction vs protocol SPEC v0.8.0 §7 + reporulez, which moved to the rulesets API (GET/POST/PUT repos/{o}/{r}/rulesets, 0 approvals, the clud-bug-review check as the merge gate). Re-vendored data/canonical-v1.json to the v2 rulesets shape (mirrors thrillmade/protocol/rulesets/canonical-v1.json), and rewrote applyCanonicalRuleset + the OctokitLike interface + the gh-CLI adapter to list rulesets, find-by-name, and create-if-absent / update-if-present idempotently.

**Alternatives considered:** Keep tuning repo-level settings (delete_branch_on_merge/allow_auto_merge/squash commit title+message) like reporulez apply.sh step 1 — dropped: the v2 canonical is ruleset-only and those knobs aren't expressible in a ruleset, so sourcing them would mean redefining state in-tool (which §7 forbids); squash-only is now enforced via the ruleset's pull_request.allowed_merge_methods, reporulez-style always-PUT on an existing ruleset — rejected: SPEC §3.23.1 mandates a true no-op on an already-canonical repo, so we GET the existing ruleset by id and diff it, only PUTting when it doesn't already satisfy canonical

**Implications:**
- rulesetVersion in the §3.23.1 status payload bumped v1 → v2; the filename stays canonical-v1.json as a stable fetch path per §7.5
- required_approving_review_count is a floor of the canonical 0 (never lowers an owner-raised value); required_status_checks contexts and bypass_actors are supersets (repo extras preserved on PUT)
- configure-github no longer tunes repo-level settings — that concern moves to reporulez apply / repo settings
- OctokitLike now exposes getRepoRulesets/getRepoRuleset/createRepoRuleset/updateRepoRuleset (mirrors @octokit/rest); classic getBranchProtection/updateBranchProtection/repos.get/repos.update removed

---

