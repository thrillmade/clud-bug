← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 18:27 - Fix #269 (CLI half): an unreachable notary is never a refusal — 5xx, retryable bodies, network errors, timeouts and hangs are retried (3 bounded rounds, fresh nonce each), then the check is posted self-attested with one printed line

**Reasoning:** SPEC 2.0 §6.5: when the gate cannot run it must say so. notaryResponseIsRejection treated every non-2xx as a terminal rejection, so a transient App failure (now a 503 { error: notary-unavailable, retryable: true } from clud-bug-app PR #133) posted no check at all. New src/core/notary-client.ts owns the one classifier (accepted / terminal for 4xx / transient for 5xx, retryable bodies, network errors, timeouts) and a bounded retry (3 rounds, backoff, env override for hermetic tests). The retried unit is the whole mint-nonce + submit round, because the App consumes the single-use nonce before its own ground-truth fetch — a bare re-POST on a spent nonce would surface a fresh 401 and manufacture a false refusal. A notary that accepts the TCP connection and never answers used to hang the CLI forever (panel finding, reproduced) — requests now carry a timeout. Terminal 4xx (409 head_moved etc.) still posts no check. README documents the fallback; one refute lens + QA against a throwaway HTTP server; 63 files / 1462 tests green in the lane tree.

**Alternatives considered:** Retry only the bare /notarize POST (rejected: the spent nonce turns every recovery into a 401 = false refusal), Nested retry loops for /challenge and /notarize (rejected: up to 9 calls, no gain over one round-level loop)

**Implications:**
- Each retry costs one extra /challenge call — cheap per the App route own comment
- The checked-in root AGENTS.md still carries a pre-v2 notary paragraph the generator no longer emits — separate drift item

---

