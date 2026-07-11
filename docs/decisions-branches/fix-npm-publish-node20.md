← back to [docs/timeline.md](../timeline.md)

## 2026-07-11 14:53 - fix(ci): pin npm-publish to npm@11 so OIDC publish works on the Node 20 runner

**Reasoning:** npm@latest is now npm 12, whose engine requires Node >=22.22/24.15 — it EBADENGINE-fails on the workflow's Node-20 runner before the publish step, so v0.7.0-rc.23's publish failed. npm@11 (latest 11.x) is OIDC-capable AND supports Node ^20.17, unblocking the release with minimal risk.

**Alternatives considered:** Bump the runner to Node 22/24 (Node 20 is EOL) — deferred to avoid re-testing prepublishOnly on a new Node in the same change; left as a TODO in the workflow

**Implications:**
- After merge, re-publish rc.23 via workflow_dispatch (mode=publish, tag=v0.7.0-rc.23) using main's fixed workflow — no re-tag needed

---

