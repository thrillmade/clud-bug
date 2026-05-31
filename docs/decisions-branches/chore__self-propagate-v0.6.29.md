## 2026-05-31 14:21 - chore: self-propagate v0.6.29 (skill-usage workflow integration eats its own dogfood)

**Reasoning:** Self-propagation cycle — clud-bug eats its own templates so its own clud-bug-review runs the new post-step + uploads its own skill-usage artifact

**Implications:**
- Bootstrap-style update: source-of-truth bin/clud-bug.js regenerates its own .github/workflows/clud-bug-review.yml + AGENTS.md from the templates

---
