## 2026-05-28 11:43 - v0.6.12: fix self-update.yml.tmpl YAML literal-block bug — unblocks workflow_dispatch propagation

**Reasoning:** Phase 0.A.11. While trying to manually propagate v0.6.11 (Sonnet pin) to consuming repos via 'gh workflow run clud-bug-self-update.yml', every repo failed with HTTP 422: 'failed to parse workflow: (Line: 90, Col: 1): Unexpected value ...Review the diff...'. Root cause: v0.6.11 self-update.yml.tmpl had a literal blank line embedded inside a multi-line --body argument to gh pr create, inside a run: | block. GitHub Actions' YAML parser ended the block scalar at the blank line. Scheduled cron triggers still worked (no parse at trigger time), but workflow_dispatch was blocked. Pin drift across the org as a result: agent-skills @v0.5.16, reporulez @v0.5.15, rezgen @v0.5.16, logmind @v0.6.7 — weeks behind. Fix: build the PR body via printf outside the YAML block, then pass via shell variable. Removes the YAML-fragile blank line entirely. +1 test asserts the printf-based build is present AND the buggy literal blank-line pattern doesn't reappear. Composite pin bumped v0.6.11 → v0.6.12. 211 tests pass.

**Implications:**
- After v0.6.12 ships: (1) npx clud-bug@latest update in each consuming repo locally re-renders the fixed workflow. (2) Next Monday's scheduled cron will open a self-update PR carrying the fixed template forward. workflow_dispatch will work again only AFTER one of those two paths lands the fixed file.

---
## 2026-05-28 12:50 - PR #102: regen docs/file-structure.md to fix doc-index drift caught by clud-bug review

**Reasoning:** 🟡 finding: docs/file-structure.md index didn't include feat__0.A.11-fix-self-update-yaml-literal.md entry. Cosmetic but the in-tree directory listing would be wrong after merge. Fix: ran 'logmind file-structure --write' to regenerate the index. No code change.

---
