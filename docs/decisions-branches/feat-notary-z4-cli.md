← back to [docs/timeline.md](../timeline.md)

## 2026-07-16 16:59 - Phase Z4 (CLI): challenge/response nonce handshake before /notarize + pr-less skip

**Reasoning:** The notary requires a single-use nonce (SPEC §10.3.3 ① replay-closure): post-check-run now POSTs {repo,pr,head_sha} to the notary's /notarize/challenge, echoes the returned nonce in the bundle, then submits. Applies the Z4 adversarial-review fixes: correct the challenge URL to /notarize/challenge (matches the server's app/api/notarize/challenge route — a sibling /challenge would 404); skip the notary entirely for a pr-less (commit-trigger) bundle since the notary certifies PR heads; a 402 (not entitled / App absent) yields a loud NOT-notarized warning + self-attested fallback (never blocks work).

**Alternatives considered:** Treat /challenge as a sibling of the notary base (rejected — the real server route is app/api/notarize/challenge, a sub-path of /notarize)

**Implications:**
- Needs a clud-bug rc.24 bump+publish so the handshake ships to installs; the server side (POST /notarize + /notarize/challenge + entitlement gate + audit) is clud-bug-app branch feat-notary-z4 (separate PR)

---

