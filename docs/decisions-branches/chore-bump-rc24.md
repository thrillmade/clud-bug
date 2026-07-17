← back to [docs/timeline.md](../timeline.md)

## 2026-07-16 21:28 - chore: bump to 0.7.0-rc.24 (ships the Z4 CLI notary challenge/response handshake)

**Reasoning:** Publishes the Phase Z4 CLI side (#233): post-check-run now fetches a single-use nonce from the notary's /notarize/challenge and echoes it in the bundle before submitting. Release discipline: propagated the version pin to the 3 workflow templates + strict-mode-gate action.yml. The handshake is opt-in (only active when CLUD_BUG_NOTARY_URL is set), so this ships inert until an install opts in.

**Implications:**
- Tag v0.7.0-rc.24 after merge triggers the OIDC npm-publish (npm@11, fixed in #231) -> dist-tag 'next'; the hosted notary server (#97) is already deployed

---

