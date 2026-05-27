## 2026-05-15 15:02 - Add npm-dist-tag workflow as the recovery seam for out-of-order publishes

**Reasoning:** Separate workflow file rather than a flag on npm-publish.yml because: (a) keeps the audit trail clean (a dist-tag move shows up as its own workflow run, not buried in a publish run), (b) requires its own trusted-publisher entry on npm so a compromised publish workflow can't also rewrite tags, (c) inputs are different shape — version+tag, not just tag.

**Alternatives considered:** Just have user run 'npm dist-tag add' locally — rejected because their npm 2FA is passkey-based, no easy CLI flow. Same reason we did Trusted Publishing in the first place., Add a 'fix dist-tag' step to npm-publish.yml that always runs — rejected because that conflates publish concerns with tag-management concerns and would require either re-publishing (which fails on existing versions) or a publish-skipping branch in the same workflow.

**Implications:**
- Requires a second trusted-publisher entry on npm: thrillmade/clud-bug, workflow npm-dist-tag.yml, blank environment. Owner action — flagged in PR 37 description.
- Future use: roll latest forward to a new version after a botched parallel backfill, OR roll back if a release is yanked (deprecate is too soft, unpublish is too destructive — dist-tag rollback to previous version is the middle ground).

---
