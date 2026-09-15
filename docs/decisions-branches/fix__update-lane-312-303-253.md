← back to [docs/timeline.md](../timeline.md)

## 2026-09-15 11:52 - Fix #312 + #303 + #253 residual: hook freshness note, reflog-reason coverage, one live-block-span primitive for AGENTS.md marker blocks

**Reasoning:** #312: an installed hook could not tell it was older than the package's hook, so a shipped hook fix never reached existing installs; hooks.ts now stamps the installed hook and compares it locally (no network on the commit path), nudging 'clud-bug update' only when the package is newer. #303: the 'fires without a commit' class was already closed by the reflog-reason gate (#240/#245, 0bfabed); this adds the missing regression pins (HEAD moved by reset/checkout with no commit stays silent) and narrows update-notifier's false claim that max-mode hooks auto-update. #253: the original destructive edit was fixed in c90dba7/#293; the residual was fence handling — a fenced example quoting a lone start marker let the non-greedy scan consume the LIVE block's end marker, so upsertBlock appended a duplicate on every run and removeBlock (String.replace, no rewind) left copies next to redirect stubs (§1.2). One primitive, liveBlockSpans, now decides which marker pairs are live (CommonMark-correct fence pairing, unterminated openers never extend, scan resumes past a quoted start marker); upsertBlock splices the first span, removeBlock deletes every span offset-wise. Three refute panels; every guard mutation-proven in a private copy (M1 resume rule, M2 fence rejection, M3 first-span-only, M4 pairing, M5 dangling opener). 55 files / 1239 tests green in the lane tree (1225 at base).

**Alternatives considered:** Patch upsertBlock's loop only (rejected: removeBlock's String.replace cannot rewind; the §1.2 copy survives), A full markdown parser for fence detection (rejected: heuristic documented as such; straddling-fence rejection filed as follow-up), Heal already-duplicated files in this change (rejected pending a ruling: a test pins that a second block survives)

**Implications:**
- Repos already damaged by the shipped duplicate-append keep stale extra blocks until a migration ruling lands
- Markers quoted in inline code or prose (not fenced) are still treated as live — filed as a #253 residual
- Hook text changes: every install's next 'clud-bug update' rewrites the hook and gains the freshness stamp

---

