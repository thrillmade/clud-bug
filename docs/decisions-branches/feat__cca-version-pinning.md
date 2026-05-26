## 2026-05-26 11:25 - Pin claude-code-action via {{CCA_VERSION}} substitution + route audit/self-update through renderFile (v0.5.11)

**Reasoning:** Carried Unreleased CHANGELOG item since v0.5.6: workflows pinned anthropics/claude-code-action@v1 (the floating major tag), so upstream action releases could silently land in installed workflows mid-cycle. The fix needed two coordinated changes: (a) add a CCA_VERSION substitution token to all 4 templates that reference the action, and (b) route audit.yml.tmpl and self-update.yml.tmpl through renderFile() (they were raw readFile, so substitution had no effect). Implemented as a single PR with a DEFAULTS export from lib/render.js so the pin lives in one place and the v0.6 App can reuse the same map.

**Alternatives considered:** SHA-pin instead of tag-pin (would catch tag-mutation attacks). Rejected for v0.5.11: tag pins are more readable, semantically meaningful, and match the rest of the GitHub ecosystem convention. SHA-pinning is a defense-in-depth followup worth considering for v0.6.x but not blocking; users can SHA-pin in their own forks today by editing the rendered workflow. Also considered: pinning to @v1.0 minor floating tag. Rejected: GitHub Action tag refs do not do semver range matching; @v1.0 either does not exist as a tag or floats, depending on how the action publishes. Exact tag is the only honest contract.

**Implications:**
- Bumping CCA_VERSION is now a clud-bug release event — visible in CHANGELOG, picked up by refresh-mode via the v5/v2 marker bump. Existing installs auto-upgrade on next clud-bug update. Future App runtime reads the same DEFAULTS.CCA_VERSION so CLI + App stay in lockstep. Pin is currently v1.0.133 (latest stable as of 2026-05-26); update procedure is one-line edit in lib/render.js + version bump + ship.

---
