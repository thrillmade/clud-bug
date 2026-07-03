// Merge-gate verdict → GitHub check-run conclusion (H3). Shared, pure brain so
// every surface that posts the `clud-bug-review` check derives the same
// conclusion from a review outcome.
//
// The check name is HARD-CODED `clud-bug-review` everywhere — consumers attach
// branch-protection rules by that exact string (see clud-bug-app/lib/check-runs.ts).
//
// CONCLUSION MODEL for the local + Action surfaces (this module):
//   clean              → success  (review ran, no critical findings)
//   critical + strict  → failure  (BLOCKS merge — fix the criticals)
//   critical + !strict → neutral  (advisory; does not block)
//   failed             → neutral  (couldn't run; never blocks — add signal, not outages)
//
// This intentionally differs from the HOSTED bot, whose check is success-on-run
// and whose strict-mode block is a separate `request_changes` formal review. In
// local/Action mode there is no formal review, so the check IS the gate — its
// conclusion reflects the findings directly.

/** The check name MUST match consumer branch-protection rules. Do not rename. */
export const CLUD_BUG_CHECK_NAME = 'clud-bug-review';

/** Outcome of a review, as the posting surface sees it. */
export type ReviewVerdict = 'clean' | 'critical' | 'failed' | 'unverified';

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
}

/**
 * Derive the `clud-bug-review` check conclusion + title/summary from a review
 * verdict. Pure. A `local` source appends a self-attested trust note so a
 * reviewer can tell an in-session attestation from an independent CI check.
 */
export function deriveCheck(input: DeriveCheckInput): DerivedCheck {
  const { verdict, strictMode = false, criticalCount = 0, source = 'ci' } = input;
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
  } else if (verdict === 'unverified') {
    // R3 (#87) — the review ran, but an invariant/probe-touching change could not be
    // VERIFIED here (no probe ran, or a finding could not be safely reproduced —
    // e.g. an untrusted diff the local reviewer must not execute). It is NOT clean
    // (never a false-green) and NOT a hard block (never an outage on our own
    // inability to verify): a `neutral` signal that defers to an independent
    // sandbox/CI probe, which resolves it to clean or critical.
    conclusion = 'neutral';
    title = 'clud-bug review — unverified';
    summary =
      `This change touched a probe/invariant surface that could not be verified in this review; it ` +
      `needs independent sandbox/CI verification. Not a pass, not a block.${selfAttested}`;
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
  if (raw === 'clean' || raw === 'critical' || raw === 'failed' || raw === 'unverified') return raw;
  // Unknown/empty → 'failed' (safe: neutral check, never a false-green).
  return 'failed';
}
