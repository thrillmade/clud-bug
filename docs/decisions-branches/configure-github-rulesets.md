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

## 2026-07-03 22:49 - configure-github: one-stop repo setup — reporulez preset taxonomy (--preset) + restored universal repo-conveniences PATCH

**Reasoning:** PR #223 rewrote configure-github to the v2 rulesets API but loaded a single bundled canonical (skdd shape) and dropped the repo-conveniences PATCH. Reporulez just merged a purpose-named preset taxonomy (baseline/clud-bug/skdd/public-guard); this vendors those 4 JSONs into data/rulesets/ (canonical source = reporulez; a CI drift-check is a follow-up), adds --preset (default skdd = prior behavior) wired through loadPreset(name) into applyCanonicalRuleset, and restores the repo-conveniences PATCH (squash-only merges, auto-merge, delete-branch-on-merge, PR title/body squash message) applied for ALL presets BEFORE the ruleset apply.

**Alternatives considered:** Keep the single skdd canonical with no preset selection — rejected: the task requires consuming reporulez's new taxonomy so repos can pick baseline/clud-bug/skdd/public-guard, Re-derive conveniences from the ruleset JSON like the old classic canonical — rejected: v2 rulesets can't express repo-level merge settings, so conveniences are a fixed CANONICAL_REPO_CONVENIENCES constant, not sourced from the ruleset

**Implications:**
- loadCanonicalV1() is now a back-compat alias of loadPreset('skdd'); data/canonical-v1.json kept on disk as a copy of the skdd preset for the stable external fetch path
- applyCanonicalRuleset now GET/PATCHes repo settings (repos.get/update restored on OctokitLike + gh adapter) before the ruleset, and gates the ruleset PUT on ruleset-only drift so conveniences drift alone no longer forces a spurious ruleset write
- vendored preset rulesets are named reporulez-default (find-by-name idempotent across reporulez + clud-bug) with empty bypass_actors; existing repo bypass actors are preserved as a superset on PUT
- core barrel (src/core/index.ts) now exports loadPreset/isPresetName/PRESET_NAMES/DEFAULT_PRESET/CANONICAL_REPO_CONVENIENCES + PresetName/RepoConveniences so the App can consume presets; a reporulez→data/rulesets CI drift-check remains a follow-up

---

