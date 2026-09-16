← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 19:17 - Sync main into dev after #329 and #340: self-update workflow fix and dependabot targets dev

**Reasoning:** Squash-only branches never share an ancestor, so a merge from main re-presents dev content as 27 conflicts. dev is the truth for every source, template, test and doc file; main contributed only the two auto-merged files plus their decision logs. .ci-rendered stays deleted (#320), site React stays at dev 19.3, the multi-pass page keeps the #341 wording.

**Alternatives considered:** Leave dev unsynced until the promotion PR, which would then conflict the other way on the same 27 files, Rebase dev onto main, rewriting shared history

**Implications:**
- The next promotion PR carries only dev-side changes
- Sync again immediately after every future merge to main

---

