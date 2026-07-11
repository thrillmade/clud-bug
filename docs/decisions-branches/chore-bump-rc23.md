← back to [docs/timeline.md](../timeline.md)

## 2026-07-11 14:40 - chore: bump to 0.7.0-rc.23 (ships Phase Z3 — the CLI notary side)

**Reasoning:** Publishes the Z3 notary contract (NotaryBundle, validateBundle/validateCoverage/validateGrounding/validateConsistency, parseBundle, notaryResponseIsRejection) so clud-bug-app can import it to build Z4 (the /notarize server). Release discipline: propagated the version pin to the 3 workflow templates + strict-mode-gate action.yml.

**Implications:**
- Tag v0.7.0-rc.23 after merge triggers the OIDC npm-publish workflow -> dist-tag 'next'; clud-bug-app then bumps its clud-bug dep to rc.23 for Z4

---

