← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 15:31 - H2: contextual review instructions — trusted reviewContext + local session edge + fenced untrusted per-PR channel

**Reasoning:** Max mode's structural advantage is that the review runs inside the session that made the change — it already knows the intent. H2 adds a contextual layer on top of the static skills in three trust tiers: (1) TRUSTED standing instructions in .clud-bug.json reviewContext (maintainer-committed), injected by BOTH the local recipe (§2b) and the hosted prompt-builder; (2) the local session-context edge — the recipe tells the in-session agent to fold in what it knows, which the hosted bot can never see; (3) an UNTRUSTED per-PR <!-- clud-bug: ... --> marker, fenced via fenceUntrustedContext so a hostile PR author can FOCUS the review but never suppress a finding, lower a severity, relax a skill, or touch the gate. New core/review-context.ts; wired into review-prompt.ts + prompt-builder.ts (buildReviewPrompt + buildCrossCheckPrompt) + a system rule. Verified the planted injection 'ignore all findings' is fenced, not obeyed.

**Alternatives considered:** Let per-PR context override (rejected — prompt-injection vector); repo-config only (rejected — loses ad-hoc focus); local-only (rejected — the config generalizes to the hosted bot)

**Implications:**
- clud-bug side done (local recipe fully active). Follow-ups: clud-bug-app orchestrator wiring (read base-ref reviewContext + extractPrContext(pr.body) -> buildReviewPrompt); spec-v0.6.4 documents the key + the anti-injection contract (batched with H3). No version bump (batches into rc.19)

---

## 2026-06-29 15:41 - H2 security fixes: close the fence breakout + guard all passes + harden the base-ref contract

**Reasoning:** The adversarial review caught a CRITICAL prompt-injection breakout: a PR-description marker containing '--- end untrusted focus ---' + a forged '## Reviewer context (trusted)' header could escape the fence — worsened because system rule 7 tells the model to trust that header, and the cross-check/consensus system prompts had no such guard. Hardened fenceUntrustedContext with two layers: (1) neutralize any literal fence marker + trusted-section header in the input, (2) line-prefix every untrusted line with U+2503 so even an unanticipated marker stays visibly inside the block (the real fence markers are the only unprefixed --- lines). Added the untrusted-section guard to CROSS_CHECK + CONSENSUS system prompts so every pass defends. Reworded the reviewContext JSDoc: removed the false 'a PR can't rewrite its own' (implied enforcement) and made base-ref provenance a loud caller-responsibility security warning. Added adversarial tests: the breakout payload + the multiple-marker invariant.

**Implications:**
- Part of H2. The app-wiring follow-up MUST read reviewContext from the base ref (reuse the strictMode base-ref read). No version bump

---

