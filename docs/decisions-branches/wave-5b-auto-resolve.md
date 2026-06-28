← back to [docs/timeline.md](../timeline.md)

## 2026-06-27 22:36 - Wave 5b — D.2.6 auto-resolve on fix-push in npm workflow (rc.8)

**Reasoning:** OSS parity push, part 2 of 2 (after Wave 5a inline threads). On fix-push, the workflow asks the Anthropic Messages API per bot-authored unresolved inline thread whether the new commit addressed the original finding. ADDRESSED → resolve thread + post marker reply; UNCERTAIN/NOT_ADDRESSED → leave open (escalate critical UNCERTAIN to REQUEST_CHANGES intent). Pure rule tables + prompt + response-parser in clud-bug/core; IO (Anthropic fetch + GraphQL mutations) in CLI verb. Stateless via existing finding-id markers — no Redis.

**Alternatives considered:** Use @anthropic-ai/sdk runtime dep — rejected; direct fetch() to Messages API keeps the package dep-light (only zod stays). ~30 LOC vs adding a transitive dep tree., Port App's heuristic fallback + aggregateMultiPassVerdicts — rejected for OSS MVP. Heuristic adds 80 LOC + a reFlaggedThreadIds correlation step for no customer ask. Multi-pass is App-only (D.2.5). Future Wave 5c can add either if needed., Make verifier model configurable via .clud-bug.json — rejected. Hardcoded to claude-sonnet-4-6 with CLUD_BUG_VERIFIER_MODEL env override for power users. Config-knob proliferation defer until customer asks.

**Implications:**
- Workflow ships a new post-step gated on synchronize events. CLI verb fail-closed: verifier errors → UNCERTAIN, all unexpected paths emit {error: ...} JSON + exit 0, surrounding continue-on-error: true is the single failure gate. Cost shape: ~$0.005/thread/fix-push × N threads. Smoke surface ready on clud-bug-test (workflow installed at rc.7 from Wave 5a; bump to rc.8 after publish).

---

