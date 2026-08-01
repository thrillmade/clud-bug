← back to [docs/timeline.md](../timeline.md)

## 2026-08-01 01:13 - Fix 258: map dependabot secrets explicitly instead of secrets: inherit

**Reasoning:** Four dependabot PRs were silently failing to auto-merge. Cause is a name mismatch, not a policy gate. The reusable workflow at thrillmade/.github declares its secrets in kebab-case as orchestrator-app-id and orchestrator-private-key, both required. But secrets: inherit forwards the callers secrets under THEIR OWN names, so the callee received THRILLMADE_ORCHESTRATOR_APP_ID and the two declared inputs were never populated. Verified decisively by comparison: logmind, agent-skills and reporulez all map explicitly with the identical two lines; clud-bug was the only caller of the four using inherit.

**Alternatives considered:** Rename the org secrets to match the kebab-case input names — rejected: they are org-wide and consumed by three other repos, so renaming to suit one caller breaks the others., Fork or patch the reusable workflow to accept both names — rejected: it is pinned by commit SHA for supply-chain immutability and is another lanes file.

**Implications:**
- The pin on thrillmade/.github stays at 6e1f9df; only the secrets block changes
- Comment records why inherit cannot work here, so the next editor does not simplify it back

---

