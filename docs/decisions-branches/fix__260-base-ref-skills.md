← back to [docs/timeline.md](../timeline.md)

## 2026-08-07 17:12 - Fix #260 item 1: pin review skills to the PR base ref (a PR could pick its own judge)

**Reasoning:** The Action checked out with no ref:, so on pull_request the workspace is the merge ref, which contains the change; the reviewer read .claude/skills/** out of that workspace as the TRUSTED tier (review-context.ts fences a PR description, never a skill file). A PR that added, edited or deleted a SKILL.md supplied the authority over its own review. SPEC 2.0 4.1 and 6.3 both bind.

**Alternatives considered:** Considered pinning the checkout itself to the base ref (breaks the diff the review exists to read), and teaching each skill reader a base-ref path (a second mechanism to keep in sync, and any reader that forgets reopens the hole). Replacing the .claude/skills tree in place reuses the exact origin/BASE_REF resolution the strict-mode, notary and formal-review steps already use for strictMode/notary.

**Implications:**
- Workflow template v14 to v15 and local recipe v1 to v2 — consumers need clud-bug update to get the fix. Skill edits by a PR are still reviewed, just not obeyed. The pin fails closed: an unresolvable base ref means a skill-less baseline review with a ::warning, never a fallback to the PR's skills. NOT closed: the workflow file itself still comes from the merge ref on pull_request (SPEC 6.3 says inline gate logic cannot be fixed from inside the job), and CLAUDE.md/AGENTS.md/.claude/* are unpinned.

---

## 2026-08-07 17:15 - Correct the skill-usage step's stale comment: the workspace manifest is now the base ref's, not the PR's

**Reasoning:** The #260 pin replaces .claude/skills with the base ref's copy before any later step reads it, so the Update skill-usage step's comment ("PR's snapshot") now describes the wrong thing. It is also the better snapshot to record usage against — a PR's own manifest edits should not enter the usage record.

**Alternatives considered:** Leave the comment as-is (it would mislead the next reader into thinking usage tracks head-side manifest edits) or move the step before the pin (worse: it would then bake PR-supplied manifest bytes into the uploaded artifact).

**Implications:**
- Comment-only; no behaviour change. Rendered .ci-rendered/workflow.yml re-generated to match.

---

