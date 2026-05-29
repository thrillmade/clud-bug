## 2026-05-29 14:41 - clud-bug self-upgrade to its own v0.6.22 + logmind v0.5.6 (Phase 0.5 §3)

**Reasoning:** Phase 0.5 §3 — clud-bug ships v0.6.22 but its own .github/workflows/clud-bug-review.yml was last rendered at v0.6.21 (PR #114 / 0.0.O modified the templates but didn't re-render clud-bug's own workflow from them). This PR closes the dogfooding gap. node bin/clud-bug.js update --quiet (LOCAL bin, since npx clud-bug command-not-found in clud-bug's own repo without a global install) rerenders the workflow: adds --json-schema (0.0.O structured output), Render+post structured review step, Fallback summary step, paths-check pre-flight job (0.0.W workflow-only skip), bumps strict-mode-gate pin v0.6.21 → v0.6.22, keeps bot-login: github-actions[bot]. logmind agents update --apply refreshes AGENTS.md block v5-slim → v6-pointer (~69% reduction). Preemptive logmind workflow install pin bump 0.3.3 → 0.5.6 (same gotcha caught on §1 propagation). 300/300 tests pass.

**Alternatives considered:** Skip self-upgrade — clud-bug ships features but doesn't have to use them on itself. Rejected: credibility problem ('consumer product no failures' framing). If clud-bug's own PRs hit max-turns, that's a product-quality red flag. Dogfooding closes the loop.

**Implications:**
- App-side workflow-self-modification guard fires once on this PR — admin-bypass merge per documented per-PR-checklist exception. Future workflow-only PRs in clud-bug auto-skip via 0.0.W's paths-check.
- After merge: clud-bug's own PR reviews benefit from v0.6.22 efficiency (structured output single emission, trimmed prompt, applies_to filter). Sets clean baseline for §5 (adaptive max-turns) which ships as v0.6.23.

---
