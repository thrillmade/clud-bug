## 2026-05-29 01:06 - v0.6.15: model routing for trivial PRs — Haiku for dep bumps (Phase 0.5 / 0.0.R)

**Reasoning:** Extends paths-check (v0.6.14) with a triviality classifier. PR is trivial if: (a) author is dependabot[bot] or renovate[bot] (regardless of diff size — lockfile churn can be huge but review surface is shallow), OR (b) diff < 2KB AND every changed file matches the dep-manifest allow-list (package.json, *-lock.*, pyproject.toml, poetry.lock, uv.lock, Gemfile(.lock), go.mod/go.sum, Cargo.toml/Cargo.lock). Trivial PRs route to claude-haiku-4-5-20251001 ($0.80/MTok input); everything else stays on Sonnet 4.6 ($3/MTok). ~75% cost reduction on dep-bump traffic. Mixed PRs (any non-allow-list file) fall back to Sonnet via the *) ALL_TRIVIAL=false; break ;; safety branch — opt-in by classifier. Wiring: paths-check emits 'model' output; claude_args uses --model ${{ needs.paths-check.outputs.model }} for dynamic interpolation. Applied across all 3 templates; composite-pin bumped v0.6.14 → v0.6.15. +4 regression tests assert: model output exposed + Sonnet default, dependabot/renovate matched, allow-list covers 5 ecosystems, mixed-diff guard present. 249 pass.

**Implications:**
- Override per-repo by editing the rendered workflow if a consumer wants Sonnet for ALL their dep bumps. Future bot authors (e.g. a new dependency-update tool) need to be added to the bot-author case. Diff size 2048 bytes covers typical manual lockfile fixes; not a hard ceiling — extreme manual edits fall through to Sonnet (safe default).

---
