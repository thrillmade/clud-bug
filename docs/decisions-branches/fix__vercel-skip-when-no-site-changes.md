## 2026-05-26 16:38 - Skip Vercel preview deploys when no site/ files changed

**Reasoning:** Vercel free-tier quota is 100 deploys/day. Most clud-bug PRs touch zero site/ files but still trigger a Vercel preview build per PR + per fix-push, eating quota fast. Hit the limit today shipping 13 PRs in one session. The fix is one line: site/vercel.json `ignoreCommand: git diff --quiet HEAD^ HEAD ./` — Vercel runs the command from the project root (site/), exit 0 means SKIP deploy, exit non-zero means deploy. The git diff exits 0 when no files under ./ changed in HEAD vs HEAD^. Surgical: only changes Vercel deploy gating; no impact on actual build/deploy when site/ DOES change.

**Alternatives considered:** Set Vercel ignored build step via the Vercel dashboard (project settings). Rejected: not version-controlled, drifts from repo, anyone re-linking the project misses it.

**Implications:**
- Vercel previews now skip when no site/ changes. clud-bug PRs that only touch lib/, templates/, .github/, docs/ etc. will show Vercel as ignored (not failed). The exit-0 result is cosmetically a "deployment skipped" status in the PR check list rather than a fail. Doesn't affect production deploys from main — those run via Vercel's normal trigger.

---
