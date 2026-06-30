← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 20:12 - rc.21 (C1): parameterize buildVerifierPrompt + VERIFIER_SYSTEM by outputMode (json|structured)

**Reasoning:** The last core-duplication gap: clud-bug-app's buildVerifierPrompt + VERIFIER_SYSTEM are byte-identical to core's except one output-instruction line (raw-JSON vs AI-SDK structured). Added outputMode: 'json' | 'structured' (default 'json', preserving the CLI raw path) to buildVerifierPrompt; refactored VERIFIER_SYSTEM into a shared body + a mode tail via buildVerifierSystem(mode), with VERIFIER_SYSTEM = buildVerifierSystem('json') for back-compat. Exported buildVerifierSystem + VerifierOutputMode. Verified: the CLI json prompt + system are byte-identical to before (VERIFIER_SYSTEM === buildVerifierSystem('json')); structured mode emits the app's wording.

**Alternatives considered:** A second VERIFIER_SYSTEM_STRUCTURED const (rejected — a builder + shared body is cleaner + de-dups the body too); leave it duplicated (rejected — this IS the C1 cleanup)

**Implications:**
- rc.21. [CEO] publish v0.7.0-rc.21 -> then clud-bug-app deletes its buildVerifierPrompt/VERIFIER_SYSTEM copies + imports core's with outputMode:'structured' (C1 app side)

---

