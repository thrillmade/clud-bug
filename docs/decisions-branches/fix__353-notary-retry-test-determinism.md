← back to [docs/timeline.md](../timeline.md)

## 2026-09-28 20:06 - The notary retry test controls its failure shape: every fake server closes the connection (#353)

**Reasoning:** On CI one retried round hit a keep-alive socket the fake server was tearing down, so the CLI printed the network-error wording and the test that pins the HTTP 503 wording failed. The one shared server helper now sends Connection: close, which removes socket reuse between rounds by construction; the assertion is unchanged. Production code is untouched because the fetch lives in post-check-run, outside the one-line carve-out.

**Alternatives considered:** Loosen the assertion to accept either wording (rejected: the test exists to pin the 503 path), Disable keep-alive in the CLI (rejected: not a one-line test-pinned change in notary-client.ts)

**Implications:**
- Every current and future fake server in the file inherits the fix

---

