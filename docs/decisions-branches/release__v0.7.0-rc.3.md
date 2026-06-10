← back to [docs/timeline.md](../timeline.md)

## 2026-06-10 10:37 - v0.7.0-rc.3: port selectReviewEvent into core w/ author_association + diff-findings + writeback extensions + workflow post-step

**Reasoning:** Phase 7 PR A closes SPEC §1.8.1 + §7.2.1 + §6.7.3 conformance gaps in clud-bug core so clud-bug-app (PR B) can consume via dep bump + npm workflow inherits via new template post-step. Without (1) auto-approves drive-by external PRs (security bug), (2) misses Resolved/Still-open blocks, (3) misses cache comment, (4) workflow path never satisfies required_approving_review_count: 1 floor.

**Alternatives considered:** Keep selectReviewEvent in clud-bug-app only (rejected: workflow path inherits nothing), Skip author_association gate (rejected: drive-by exploit of auto-merge), Server-side gate in App only (rejected: workflow consumers still uncovered)

**Implications:**
- clud-bug-app must bump dep + pass author_association in Phase 7 PR B
- Renderer input shape grows by 3 optional fields (back-compat)
- Template post-step runs Node inline reading clud-bug/core import; needs install step
- All 3 workflow templates + action.yml header bump to v0.7.0-rc.3

---

## 2026-06-10 10:46 - v0.7.0-rc.3 core: selectReviewEvent + parsePriorReviewFile + diffFindings + renderReviewFile extensions

**Reasoning:** Ported and extended formal-review for §7.2.1 with authorAssociation gate; added diff-findings module for §1.8.1 Resolved/Still-open block emission; extended renderReviewFile with three optional inputs (resolvedFindings, stillOpenFindings, cacheStats); barrel re-exports all three. 88 new tests passing.

**Alternatives considered:** Inline author_association check at every caller (rejected: rule lives once), Hash-based identity using crypto.subtle SHA-256 (rejected: string identity is enough)

**Implications:**
- Phase 7 PR B in clud-bug-app deletes lib/formal-review.ts and imports from clud-bug/core
- renderReviewFile inputs grew by 3 optional fields — back-compat preserved

---

## 2026-06-10 10:58 - v0.7.0-rc.3: workflow template post-step + CLI select-review-event subcommand + version bumps

**Reasoning:** Added new clud-bug CLI subcommand 'select-review-event --stdin' that the workflow templates invoke via 'npx --yes clud-bug@<version>' to post a formal pulls.createReview, satisfying canonical-ruleset's required_approving_review_count: 1 floor on the npm workflow path. continue-on-error: true ensures the formal review NEVER fails the workflow; degrades to skip on any caller-side error. Bumped package.json + action.yml header + all 3 template strict-mode-gate pins to v0.7.0-rc.3. Added release-discipline test guarding the new post-step.

**Alternatives considered:** node -e inline import (rejected: brittle, hard to test), Shell-only jq rule table (rejected: rule lives in TS for cross-tool reuse)

**Implications:**
- Workflow consumers will see one extra 'Formal review' step + a per-PR APPROVE review (clud-bug[bot]) on clean PRs
- Old workflows (pre-rc.3) keep working — they just never post APPROVE, status quo

---

