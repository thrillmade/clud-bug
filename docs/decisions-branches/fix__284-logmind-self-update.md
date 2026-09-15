← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 09:53 - Fix #284: logmind-self-update hands setup-logmind a v-prefixed exact tag, guards an empty LATEST, drops the flag cobra rejects

**Reasoning:** The last three Monday runs (34841651475, 34120104207, 33390197445) all fail with 'unrecognized version input 1.2.0' — the compare step strips the v for its string comparison and then passes the bare number to setup-logmind, whose resolver only accepts latest / vMAJOR / vMAJOR.MINOR.PATCH. Latent until INSTALLED first diverged from LATEST. Mirrors protocol's live fix (v${{ latest }} + token:), not its superseded first draft (version: latest re-hits the anonymous rate-limited /releases/latest endpoint). Two directly coupled sub-bugs fixed with it: an empty LATEST after three failed fetches fell through to skip=false and produced a bare v; --no-skill-install is rejected by the current CLI. Permissions, secrets, triggers and schedule unchanged; actionlint green on the file; shell logic dry-run with the real version strings.

**Alternatives considered:** Apply the issue body's literal 'version: latest' diff (rejected: the draft protocol itself replaced), Port protocol's whole PR incl. issues:write + notify-on-failure (rejected: broadens permissions; filed as a follow-up)

**Implications:**
- Next scheduled run 2026-09-21 should go green (PR opened or clean no-op)
- Still no failure notification — separate issue

---

