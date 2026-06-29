← back to [docs/timeline.md](../timeline.md)

## 2026-06-29 18:06 - re-pin: float the max-mode hook to @next (auto-update; last manual re-pin)

**Reasoning:** rc.20 published; switching clud-bug's own commit-review hook from the exact rc.18 pin to the floating @next pin via init --local-only. After this the hook auto-fetches the latest recipe on every commit (delivering all of H1-H4's hardening), so no future re-pin is ever needed. Verified: hook now pins clud-bug@next, zero Action workflows added.

**Implications:**
- Last re-pin. The other 6 max-mode repos get the same via a Workflow

---

