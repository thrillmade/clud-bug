← back to [docs/timeline.md](../timeline.md)

## 2026-07-11 14:22 - Phase Z3: clud-bug CLI notary side — deterministic ③④⑤ validators + attestation bundle + submit-bundle handshake

**Reasoning:** The un-forgeable notary core (SPEC §10.3.3). Pure validators (coverage/grounding/consistency) reuse the inline-threads diff parser; the CLI is a deterministic program that refuses to certify an inconsistent/ungrounded review before assembling a bundle, then submits to the notary (Z4 stub) with a self-attested fallback. Adversarially reviewed (4 lenses -> per-finding verify); 6 confirmed findings fixed incl. two majors (server 4xx -> terminal reject not fallback; quote/tab-aware diff parser for non-ASCII + space filenames).

**Alternatives considered:** Required grounding via a split CRITICAL_FINDING_ITEM schema variant (rejected: discriminated-union type-ripple through the App finding aggregator + couples the live hosted Zod pipeline, for no added safety since the notary re-check is the real gate), camelCase bundle finding fields (rejected: snake_case grounding_kind matches the review-output wire schema + the recipe)

**Implications:**
- Z4 consumes the exported NotaryBundle schema + notaryResponseIsRejection semantics; the CLI notary path stays opt-in behind CLUD_BUG_NOTARY_URL until the Z4 endpoint + Z6 integration_id pin land; hosted grounding-required elevation + POST /notarize deferred to Z4; grounding is OPTIONAL in the review-output schema but REQUIRED-and-validated in the notary bundle

---

