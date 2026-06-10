// SPEC §7.2.1 formal-review event selector.
//
// This is the PURE half of clud-bug-app's `lib/formal-review.ts` (the
// Octokit-side `postFormalReview` IO wrapper stays App-side — it depends
// on `getInstallationOctokit` + `@octokit/rest` which we don't want to
// pull into core). The pure rule-table lives here so:
//
//   1. The npm workflow template's new post-step (added in v0.7.0-rc.3)
//      can `import { selectReviewEvent } from 'clud-bug/core'` and post
//      formal `pulls.createReview` calls under the workflow path — until
//      this PR shipped, the workflow path NEVER satisfied the canonical
//      ruleset's `required_approving_review_count: 1` floor because no
//      APPROVE review was ever posted.
//
//   2. clud-bug-app (Phase 7 PR B) deletes its local copy and imports
//      this version, gaining the §7.2.1 author_association extension
//      (clud-bug-app's PR #40 shipped APPROVE without it, so the App
//      currently auto-approves drive-by external-contributor PRs — a
//      security bug closed by Phase 7 PR B's dep bump).
//
// Ported from clud-bug-app/lib/formal-review.ts (PR #40, MERGED 2026-06-10)
// with the §7.2.1 `authorAssociation` extension new in Phase 7 PR A.

/** GitHub's `pulls.createReview` `event` enum, narrowed to the three we use. */
export type FormalReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/**
 * GitHub `author_association` on a PR. Verbatim union from the REST API
 * (per https://docs.github.com/en/rest/pulls/pulls — `author_association`).
 *
 * The "external" tier for §7.2.1 auto-approve gating is:
 *
 *   { 'NONE', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'MANNEQUIN' }
 *
 * Everything else (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR) is the
 * "org-trusted" tier and eligible for auto-approve on a clean review.
 *
 * `FIRST_TIMER` is the legacy spelling (October 2018 era); GitHub
 * currently emits `FIRST_TIME_CONTRIBUTOR` but some PR fixtures in
 * downstream tests still carry the old token. We keep both so the
 * external-contributor gate doesn't silently regress on the next
 * REST-API rename.
 */
export type AuthorAssociation =
  | 'OWNER'
  | 'MEMBER'
  | 'COLLABORATOR'
  | 'CONTRIBUTOR'
  | 'FIRST_TIME_CONTRIBUTOR'
  | 'FIRST_TIMER'
  | 'NONE'
  | 'MANNEQUIN';

/**
 * Author-association values that route a clean-review APPROVE *down* to
 * COMMENT per SPEC §7.2.1 precondition #3 ("PR author is an org member —
 * NOT a first-time external contributor"). These authors still get a
 * COMMENT review (so they SEE the bot's verdict) but the formal APPROVE
 * vote stays withheld — a human reviewer must click Approve before the
 * PR can merge under the canonical ruleset.
 *
 * Drive-by exploitation prevention: a malicious external contributor
 * who opens a clean-looking PR cannot leverage clud-bug[bot]'s APPROVE
 * vote to auto-merge.
 */
const EXTERNAL_ASSOCIATIONS: ReadonlySet<AuthorAssociation> = new Set<
  AuthorAssociation
>(['NONE', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'MANNEQUIN']);

/**
 * SPEC §7.2.1 + §7.2 rule table.
 *
 * Order matters — earlier rows short-circuit later ones:
 *
 * | Priority | Condition                                              | Event           |
 * |----------|--------------------------------------------------------|-----------------|
 * | 1        | PR author === clud-bug[bot]                            | 'skip'          |
 * | 2        | authorAssociation ∈ EXTERNAL                           | 'COMMENT'       |
 * | 3        | criticalCount > 0 AND strictMode=true                  | REQUEST_CHANGES |
 * | 4        | criticalCount > 0 AND strictMode=false                 | COMMENT         |
 * | 5        | minorCount > 0  (no critical)                          | COMMENT         |
 * | 6        | 0 critical + 0 minor                                   | APPROVE         |
 *
 * The external-contributor row (Priority 2) sits BETWEEN self-PR-skip
 * and the severity-driven rules: external contributors who open a
 * critical-finding PR still get COMMENT (NOT REQUEST_CHANGES — we don't
 * block their PR on a bot review; that's a human reviewer's call to
 * make). External contributors who open a clean PR also get COMMENT
 * (NOT APPROVE — the §7.2.1 precondition #3 gate).
 *
 * The 'skip' verdict tells the caller NOT to invoke `pulls.createReview`
 * — GitHub returns 422 when a user reviews their own PR, so we
 * short-circuit before the network round-trip. Self-PRs land during D.7
 * migration fan-out (the App opens cross-repo update PRs under its own
 * identity).
 */
export interface SelectReviewEventInput {
  /** Count of `severity: critical` findings on the review. */
  criticalCount: number;
  /** Count of `severity: minor` findings on the review. */
  minorCount: number;
  /**
   * `strictMode` flag read from `.clud-bug.json` at the PR's BASE ref.
   * Older manifests may not carry this field — callers MUST pass
   * `undefined` in that case so this function applies the safe default
   * (false) rather than surprising users with REQUEST_CHANGES.
   */
  strictMode?: boolean;
  /**
   * GitHub login of the PR author. When it equals 'clud-bug[bot]' we
   * skip the formal review entirely (GitHub disallows self-review with
   * 422). This is the structural guard for D.7 migration fan-out PRs.
   */
  prAuthorLogin: string;
  /**
   * GitHub `author_association` on the PR. NEW in v0.7.0-rc.3 / SPEC
   * §7.2.1: when this is in EXTERNAL_ASSOCIATIONS, a clean review gets
   * COMMENT (not APPROVE) so external-contributor PRs require a human
   * reviewer to satisfy the `required_approving_review_count: 1` floor.
   *
   * Callers that don't have this metadata (older webhook payloads,
   * tests, etc.) should pass `'CONTRIBUTOR'` as the safe default — that
   * tier is org-trusted and preserves pre-§7.2.1 behaviour.
   */
  authorAssociation: AuthorAssociation;
}

export function selectReviewEvent(
  input: SelectReviewEventInput,
): FormalReviewEvent | 'skip' {
  // Priority 1: self-PR guard. GitHub returns 422 on a self-review;
  // we short-circuit before the network round-trip. Self-PRs land
  // during D.7 migration fan-out (the App opens cross-repo update PRs
  // under its own identity).
  if (input.prAuthorLogin === 'clud-bug[bot]') {
    return 'skip';
  }

  // Priority 2: external-contributor gate (SPEC §7.2.1 precondition #3).
  // External contributors NEVER get APPROVE (no auto-merge bypass via
  // drive-by) and NEVER get REQUEST_CHANGES (we don't block their PR on
  // a bot review — that escalation is a human reviewer's call). They
  // always get an advisory COMMENT so they see the bot's verdict.
  if (EXTERNAL_ASSOCIATIONS.has(input.authorAssociation)) {
    return 'COMMENT';
  }

  // Priority 6 (note: priorities 3-5 fall through to here when there
  // are no findings): clean review on an org-trusted author → APPROVE.
  // APPROVE flips the `required_approving_review_count: 1` ruleset and
  // lets auto-merge fire under the canonical SPEC §7.2 ruleset.
  if (input.criticalCount === 0 && input.minorCount === 0) {
    return 'APPROVE';
  }

  // Priority 3 + 4: critical finding → gate on strictMode. Default
  // `strictMode === undefined` → false (advisory-only). REQUEST_CHANGES
  // blocks the PR until the author dismisses or fixes; we only honor
  // it when the repo opted in.
  if (input.criticalCount > 0) {
    return input.strictMode === true ? 'REQUEST_CHANGES' : 'COMMENT';
  }

  // Priority 5: minor-only or preexisting-only finding → advisory
  // COMMENT. We never REQUEST_CHANGES on a minor — those are noted,
  // not blocking.
  return 'COMMENT';
}
