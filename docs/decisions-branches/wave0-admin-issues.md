← back to [docs/timeline.md](../timeline.md)

## 2026-08-01 01:32 - File three Wave 0 admin findings (pre-push gap, spec-version drift, stale SPEC citations) and warn agents to read issue threads not bodies

**Reasoning:** SPEC 2.0 replaced the old spec twice this cycle, leaving stale section citations, disagreeing spec-version literals, and an unfiled pre-push gap that #262 announced as filed but never numbered; several open issues also have bodies superseded by their own later comments, which silently ships the wrong design to any agent that only reads the body

**Alternatives considered:** Fix the code directly instead of filing issues — rejected: this is admin triage across two repos (clud-bug and clud-bug-app) plus a cross-repo spec-history read, not a single scoped change, and the AGENTS.md warning needs to land before any agent acts on the affected issues

**Implications:**
- Three new issues (#276 pre-push, #277 spec-version, #278 stale citations) are open and unassigned; AGENTS.md now names #260/#256/#246/#262-item-7 as thread-not-body traps so future agents check comments before implementing

---

