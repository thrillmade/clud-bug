← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 15:31 - H2: contextual review instructions — trusted reviewContext + local session edge + fenced untrusted per-PR channel

**Reasoning:** Max mode's structural advantage is that the review runs inside the session that made the change — it already knows the intent. H2 adds a contextual layer on top of the static skills in three trust tiers: (1) TRUSTED standing instructions in .clud-bug.json reviewContext (maintainer-committed), injected by BOTH the local recipe (§2b) and the hosted prompt-builder; (2) the local session-context edge — the recipe tells the in-session agent to fold in what it knows, which the hosted bot can never see; (3) an UNTRUSTED per-PR <!-- clud-bug: ... --> marker, fenced via fenceUntrustedContext so a hostile PR author can FOCUS the review but never suppress a finding, lower a severity, relax a skill, or touch the gate. New core/review-context.ts; wired into review-prompt.ts + prompt-builder.ts (buildReviewPrompt + buildCrossCheckPrompt) + a system rule. Verified the planted injection 'ignore all findings' is fenced, not obeyed.

**Alternatives considered:** Let per-PR context override (rejected — prompt-injection vector); repo-config only (rejected — loses ad-hoc focus); local-only (rejected — the config generalizes to the hosted bot)

**Implications:**
- clud-bug side done (local recipe fully active). Follow-ups: clud-bug-app orchestrator wiring (read base-ref reviewContext + extractPrContext(pr.body) -> buildReviewPrompt); spec-v0.6.4 documents the key + the anti-injection contract (batched with H3). No version bump (batches into rc.19)

---

