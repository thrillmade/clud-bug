// Merge-gate verdict → GitHub check-run conclusion (H3). Shared, pure brain so
// every surface that posts the `clud-bug-review` check derives the same
// conclusion from a review outcome.
//
// The check name is HARD-CODED `clud-bug-review` everywhere — consumers attach
// branch-protection rules by that exact string (see clud-bug-app/lib/check-runs.ts).
//
// ZP4 (verdict-contract parity): this is now THE canonical conclusion mapping
// for ALL THREE surfaces that can post the `clud-bug-review` check —
//   1. local CLI + self-hosted Action        → calls `deriveCheck` directly.
//   2. the hosted notary (clud-bug-app)      → `lib/notary.ts`'s
//      `deriveNotaryCheck` calls this SAME `deriveCheck` internally.
//   3. the hosted bot's webhook (clud-bug-app) → `app/api/webhook/route.ts`
//      derives a `ReviewVerdict` from the review outcome/coverage/findings and
//      calls this SAME `deriveCheck`.
//
// Through ZP3 the hosted bot's webhook posted `success` on ANY completed
// review regardless of critical findings, blocking merges only via a SEPARATE
// `request_changes` formal review event — a documented, deliberate divergence
// from this module. ZP4 retired that divergence: a check whose producers
// disagree about what a verdict MEANS can't be safely pinned as a required
// status (the inconsistency becomes un-forgeable), so all three surfaces now
// agree on ONE conclusion for a given (verdict, strictMode). The formal-review
// event on the hosted bot still fires ALONGSIDE this — both signals move in
// lockstep now, neither replaces the other.
//
// CONCLUSION MODEL (identical across all three surfaces):
//   clean              → success  (review ran, no critical findings)
//   critical + strict  → failure  (BLOCKS merge — fix the criticals)
//   critical + !strict → neutral  (advisory; does not block)
//   failed             → neutral  (couldn't run; never blocks — add signal, not outages)
//   unverified         → neutral  (ran, but coverage/verification couldn't be confirmed)
//   skipped            → neutral  (never started; SPEC §6.5 — a gate that cannot run says so)
//
// See `VERDICT_CONCLUSION_TABLE` below for the exhaustive, test-asserted form
// of this table — the cross-repo parity tests in clud-bug-app assert their
// two surfaces against the same cases.

/** The check name MUST match consumer branch-protection rules. Do not rename. */
export const CLUD_BUG_CHECK_NAME = 'clud-bug-review';

/**
 * Outcome of a review, as the posting surface sees it.
 *
 * `skipped` (SPEC §6.5) is distinct from `failed`. `failed` means the review
 * STARTED and broke — "re-run to retry" is honest advice. `skipped` means no
 * review was ever attempted (a fork pull request the reviewer's credential
 * cannot reach, a propagation diff with no review surface), so re-running
 * changes nothing and the reason has to name the actual cause.
 */
export type ReviewVerdict = 'clean' | 'critical' | 'failed' | 'unverified' | 'skipped';

/** The narrowed check-run conclusion set we emit. */
export type CheckConclusion = 'success' | 'neutral' | 'failure';

/** Which surface attested the review (drives the title + trust note). */
export type CheckSource = 'local' | 'ci';

export interface DerivedCheck {
  conclusion: CheckConclusion;
  title: string;
  summary: string;
}

export interface DeriveCheckInput {
  verdict: ReviewVerdict;
  /** `.clud-bug.json` strictMode at the BASE ref. Default false (advisory). */
  strictMode?: boolean;
  /** Number of critical findings (for the title). */
  criticalCount?: number;
  /** 'local' (self-attested in-session) or 'ci' (Action). Default 'ci'. */
  source?: CheckSource;
  /**
   * Why no review ran. Only read for `verdict: 'skipped'`. SPEC §6.5 requires
   * the skip to be ANNOUNCED — "the pull request carries a comment stating that
   * the check was skipped and why" — so a skip with no reason is the silent
   * degradation the rule exists to stop. A blank/absent reason falls back to a
   * generic sentence rather than emitting an empty one.
   */
  skipReason?: string;
}

/** Fallback when a `skipped` verdict arrives with no reason attached. */
const DEFAULT_SKIP_REASON = 'No review was attempted on this pull request.';

/**
 * Derive the `clud-bug-review` check conclusion + title/summary from a review
 * verdict. Pure. A `local` source appends a self-attested trust note so a
 * reviewer can tell an in-session attestation from an independent CI check.
 */
export function deriveCheck(input: DeriveCheckInput): DerivedCheck {
  const { verdict, strictMode = false, criticalCount = 0, source = 'ci' } = input;
  const skipReason = (input.skipReason ?? '').trim() || DEFAULT_SKIP_REASON;
  const selfAttested =
    source === 'local'
      ? ' (self-attested by a local max-mode review in the author’s session — not an independent CI check)'
      : '';

  let conclusion: CheckConclusion;
  let title: string;
  let summary: string;

  if (verdict === 'clean') {
    conclusion = 'success';
    title = 'clud-bug review — clean';
    summary = `No critical findings.${selfAttested}`;
  } else if (verdict === 'critical') {
    const n = criticalCount > 0 ? `${criticalCount} ` : '';
    if (strictMode) {
      conclusion = 'failure';
      title = `clud-bug review — ${n}critical (blocking)`;
      summary = `${n}critical finding(s); strict mode blocks merge until they are resolved.${selfAttested}`;
    } else {
      conclusion = 'neutral';
      title = `clud-bug review — ${n}critical (advisory)`;
      summary = `${n}critical finding(s); advisory only (strict mode off) — does not block merge.${selfAttested}`;
    }
  } else if (verdict === 'skipped') {
    // SPEC §6.5 — "Where a gate's credential cannot reach the change at all — a
    // pull request from a fork — the gate MUST NOT block it. The check is set to
    // neutral, never passing, and the pull request carries a comment stating
    // that the check was skipped and why. […] An unannounced skip is a false
    // green."
    //
    // `success` here would claim the change was checked on the one class of
    // change nothing verified. `failure` would block a contributor for a
    // constraint that is ours, not theirs. Neutral is the only honest cell, and
    // GitHub treats it as satisfying a required status check, so it does not
    // block: "Required status checks must have a successful, skipped, or
    // neutral status before collaborators can make changes to a protected
    // branch." (docs.github.com, About protected branches)
    conclusion = 'neutral';
    title = 'clud-bug review — skipped (nothing was reviewed)';
    summary =
      `Nothing was reviewed. ${skipReason} ` +
      `This check is neutral, not passing: neutral does not block the pull request and does not ` +
      `claim the change was checked. Review the diff manually.${selfAttested}`;
  } else if (verdict === 'unverified') {
    // SPEC 2.0 §4.7 — the review ran, but a critical could not be VERIFIED
    // here: a relevant named CI check had not reached a terminal outcome, or
    // a concern could be neither grounded in a failed check/quote/invariant
    // nor cleanly cleared. It is NOT clean (never a false-green) and NOT a
    // hard block (never an outage on our own inability to verify): a
    // `neutral` signal that defers to CI, which resolves it to clean or
    // critical once it finishes.
    conclusion = 'neutral';
    title = 'clud-bug review — unverified';
    summary =
      `This change has a finding that could not be verified in this review; it needs independent CI ` +
      `verification. Not a pass, not a block.${selfAttested}`;
  } else {
    // failed — never block on our own inability to run.
    conclusion = 'neutral';
    title = 'clud-bug review — could not run';
    summary = `The review could not complete; the PR is not blocked. Re-run to retry.${selfAttested}`;
  }

  return { conclusion, title, summary };
}

/** Normalize a free-form verdict string (CLI input) to a `ReviewVerdict`. */
export function normalizeVerdict(raw: string | undefined): ReviewVerdict {
  if (
    raw === 'clean' ||
    raw === 'critical' ||
    raw === 'failed' ||
    raw === 'unverified' ||
    raw === 'skipped'
  ) {
    return raw;
  }
  // Unknown/empty → 'failed' (safe: neutral check, never a false-green).
  return 'failed';
}

/**
 * ZP4 — the exhaustive (verdict, strictMode) → conclusion contract, as a data
 * table rather than prose, so it can be asserted directly instead of just
 * documented. This module's own test iterates this table against `deriveCheck`
 * (the canonical source); clud-bug-app's cross-producer parity test mirrors
 * the SAME literal cases against `deriveNotaryCheck` and the webhook route,
 * since the App's pinned `clud-bug` dependency can't import this constant
 * directly across the npm version boundary (see the ZP4 PR description for
 * the version-skew note).
 *
 * `strictMode: undefined` cases are omitted — `deriveCheck` treats an absent
 * strictMode identically to `false` (see the destructuring default above);
 * every producer that doesn't yet know the base-ref config resolves to that
 * same safe default rather than inventing a third state.
 */
export const VERDICT_CONCLUSION_TABLE: ReadonlyArray<{
  verdict: ReviewVerdict;
  strictMode: boolean;
  conclusion: CheckConclusion;
}> = [
  { verdict: 'clean', strictMode: false, conclusion: 'success' },
  { verdict: 'clean', strictMode: true, conclusion: 'success' },
  { verdict: 'critical', strictMode: true, conclusion: 'failure' },
  { verdict: 'critical', strictMode: false, conclusion: 'neutral' },
  { verdict: 'failed', strictMode: false, conclusion: 'neutral' },
  { verdict: 'failed', strictMode: true, conclusion: 'neutral' },
  { verdict: 'unverified', strictMode: false, conclusion: 'neutral' },
  { verdict: 'unverified', strictMode: true, conclusion: 'neutral' },
  // SPEC §6.5 — a gate that could not run posts neutral, in strict mode too.
  // Strict mode raises the price of a REVIEWED critical; it does not convert an
  // unreviewed change into a blocked one.
  { verdict: 'skipped', strictMode: false, conclusion: 'neutral' },
  { verdict: 'skipped', strictMode: true, conclusion: 'neutral' },
];
