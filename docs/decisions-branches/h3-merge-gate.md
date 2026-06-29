← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 16:01 - H3: merge-gate parity — clud-bug post-check-run + the local self-attested clud-bug-review check

**Reasoning:** Branch protection can require a clud-bug-review check; the hosted bot posts it but local/Action didn't, so a max-mode review couldn't gate merge. Added shared core/check-verdict.ts (deriveCheck: clean->success, critical+strict->failure/blocks, critical+!strict->neutral/advisory, failed->neutral) + a 'clud-bug post-check-run' verb that posts the check via gh (best-effort, --dry-run, reads strictMode from .clud-bug.json). The local recipe's new §5 (PR trigger only) tells the in-session agent to post a SELF-ATTESTED check after reviewing, so an agent's self-merge is gated by its own clud-bug review. CTO call: the local/Action check conclusion REFLECTS findings (vs the hosted bot's success-on-run + separate strict-mode request_changes) because in local mode the check IS the gate — labeled self-attested so it's not mistaken for independent CI.

**Alternatives considered:** Mirror the hosted success-always model + a separate request_changes (rejected — local mode posts no formal review, the check must carry the verdict); octokit (rejected — local/Action has gh, not the App token)

**Implications:**
- H3 local + verb done. Action-path posting (H3b) deferred — no production repo runs the self-hosted Action post-F4, so low-value. spec-v0.6.4 documents the check contract. No version bump (batches into rc.19)

---

## 2026-06-29 16:09 - H3 review fixes: CLI-level false-green guard tests + document the check-run stacking tradeoff

**Reasoning:** The adversarial review confirmed no false-green path + best-effort intact, with two notes: (1) the false-green guards (failed/garbage/critical+no-strict -> neutral) were only unit-tested, not through the full CLI wiring — added 3 post-check-run --dry-run tests so a regression that bypassed normalizeVerdict would be caught; (2) the verb POSTs a fresh check-run each call (no list+update) — gate integrity is zero-risk (GitHub uses the latest conclusion) but it stacks UI entries; documented the latest-wins + cosmetic-stacking tradeoff at the post site.

**Implications:**
- Part of H3. Idempotency upsert is a possible future refinement; not needed for gate correctness

---

