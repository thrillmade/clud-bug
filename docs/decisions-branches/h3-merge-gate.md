← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 16:01 - H3: merge-gate parity — clud-bug post-check-run + the local self-attested clud-bug-review check

**Reasoning:** Branch protection can require a clud-bug-review check; the hosted bot posts it but local/Action didn't, so a max-mode review couldn't gate merge. Added shared core/check-verdict.ts (deriveCheck: clean->success, critical+strict->failure/blocks, critical+!strict->neutral/advisory, failed->neutral) + a 'clud-bug post-check-run' verb that posts the check via gh (best-effort, --dry-run, reads strictMode from .clud-bug.json). The local recipe's new §5 (PR trigger only) tells the in-session agent to post a SELF-ATTESTED check after reviewing, so an agent's self-merge is gated by its own clud-bug review. CTO call: the local/Action check conclusion REFLECTS findings (vs the hosted bot's success-on-run + separate strict-mode request_changes) because in local mode the check IS the gate — labeled self-attested so it's not mistaken for independent CI.

**Alternatives considered:** Mirror the hosted success-always model + a separate request_changes (rejected — local mode posts no formal review, the check must carry the verdict); octokit (rejected — local/Action has gh, not the App token)

**Implications:**
- H3 local + verb done. Action-path posting (H3b) deferred — no production repo runs the self-hosted Action post-F4, so low-value. spec-v0.6.4 documents the check contract. No version bump (batches into rc.19)

---

