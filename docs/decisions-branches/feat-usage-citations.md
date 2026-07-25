← back to [docs/timeline.md](../timeline.md)

## 2026-07-25 15:53 - Emit usage[<slug>] in SPEC protocol §1.12.1 shape (§17 interop item 3)

**Reasoning:** agent-skills' skill census reads usage[<slug>].citations as its §17.3 'usage citations' signal but our emission (v0.6.29) never matched the SPEC shape: last_cited was written as a literal null when unset (SPEC requires the key be OMITTED, not null) and timestamps carried millisecond precision instead of the required second-precision ISO-8601. A near-miss shape looked wired but wouldn't parse cleanly for a strict consumer. Also added the missing last_loaded counter-timestamp (loads has no last-fired marker today).

**Alternatives considered:** Leave the shape as-is and let agent-skills special-case null/ms-precision on read, Bump manifest to SPEC schema v2 wholesale in this change

**Implications:**
- mergeSkillUsage now normalizes timestamps via formatSpecTimestamp (strips ms, omits key when unset) and independently tracks last_loaded alongside last_cited
- Legacy last_cited: null entries self-heal to omitted on their next merge — no migration script needed
- Manifest stays at version 1 in this repo; the v1->v2 SPEC schema bump (reviewContext, invariants, catalogSources, etc.) is out of scope for this interop item and left for a separate change

---

