# Decision Log

This file contains the 20 most recent decisions. Older decisions are archived in [decisions-archive.md](decisions-archive.md).

---
## 2026-06-28 01:52 - clud-bug rc.11 (Wave 6b): local-review slash command MVP (/clud-bug-review)

**Reasoning:** Local mode reuses the customer's Claude Code session tokens — no hosted App, no new auth (CEO's locked session-only auth). 'clud-bug init --with-local-review' scaffolds .claude/commands/clud-bug-review.md; the agent loads repo skills, fetches the PR diff via gh, reviews against the skills, and posts/updates a clud-bug-format comment carrying a '(clud-bug local-mode)' written-by marker so the bot's auto-resolve never treats it as clud-bug[bot]. Native gh/git tools — no MCP server required (MCP is an optional enhancement).

**Alternatives considered:** Slash-command body using the clud-bug-mcp structured tools (deferred — needs the MCP package, which awaits CEO sign-off on location; the native-tools MVP is independently shippable). Bundling --with-hooks (deferred — hooks need CEO sign-off on cache-skip behavior).

**Implications:**
- Edit-in-place uses the REST issues-comments endpoint for the integer comment id (adversarial-review fix: 'gh pr view --json comments' returns GraphQL node ids that 404 on PATCH, causing duplicate comments). update.ts refreshes the command in place only when marker-bearing. clud-bug-mcp package + pre-push hooks + SPEC v0.6.0 §11 are designed (blueprint saved) and pending CEO sign-off on 4 decisions.

---

