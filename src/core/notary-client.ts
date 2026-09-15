// Phase Z5 (clud-bug#269) — SPEC §6.5: "A gate that cannot run MUST report
// that it could not" and (the issue body) "failing to answer is not the same
// as refusing". The CLI's boundary to the hosted notary (`/notarize/challenge`,
// `/notarize`) has two call sites that both used to answer "is this status a
// decline?" with their own inline `status >= 400 && status < 500` check. That
// duplication is exactly how the two calls end up disagreeing as the set of
// statuses grows — clud-bug-app#133 added a `503 { retryable: true }` body for
// "GitHub was unreachable", distinct from the `409` it already used for "the
// PR head moved" (a real, terminal refusal). This module is the ONE place that
// turns a raw HTTP outcome into one of three answers, and the ONE place that
// bounds how many times a `transient` answer gets retried before the CLI gives
// up and falls back to the labelled self-attested check.

/** One notary HTTP attempt, reduced to what the classifier needs. A thrown
 *  `fetch` (a DNS failure, a connection refused, a timed-out request — `fetch`
 *  raises the same way for all three) is `network-error`; anything that got an
 *  HTTP status back, however unexpected, is `response`. */
export type NotaryAttemptOutcome =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network-error'; message: string };

export type NotaryResponseClass = 'accepted' | 'terminal' | 'transient';

/**
 * Classify a single notary HTTP attempt.
 *
 *   - a network error (includes a timeout — `fetch` throws for both, there is
 *     nothing to tell them apart on)      → `transient`.
 *   - a body carrying `retryable: true`   → `transient`, regardless of status.
 *     The App's own §6.5 contract (clud-bug-app#133) is the authority on
 *     whether ITS OWN failure is retryable; a status-range guess never
 *     overrides what the body itself says.
 *   - 2xx                                 → `accepted`.
 *   - 4xx (no `retryable: true` body)     → `terminal` — the notary
 *     AUTHORITATIVELY declines (a stale head, a malformed bundle, a spent
 *     nonce); retrying the identical request changes nothing.
 *   - 5xx, or any other status            → `transient` — the notary FAILED TO
 *     ANSWER, which is never the same fact as a refusal.
 */
export function classifyNotaryAttempt(outcome: NotaryAttemptOutcome): NotaryResponseClass {
  if (outcome.kind === 'network-error') return 'transient';
  if (isRetryableBody(outcome.body)) return 'transient';
  const { status } = outcome;
  if (status >= 200 && status < 300) return 'accepted';
  if (status >= 400 && status < 500) return 'terminal';
  return 'transient';
}

function isRetryableBody(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>)['retryable'] === true;
}

/** Bounded retry count for a `transient` notary attempt — 3 tries total (the
 *  original plus 2 retries), never unbounded: an unreachable notary must
 *  eventually degrade to the self-attested check, not hang the review. */
export const NOTARY_MAX_ATTEMPTS = 3;

const DEFAULT_BACKOFF_MS = [300, 900] as const;

/**
 * Backoff schedule (ms) between attempts — index 0 is the delay before the
 * 2nd attempt, index 1 before the 3rd. `CLUD_BUG_NOTARY_RETRY_MS` (a
 * comma-separated list) overrides it for hermetic tests that need the retry
 * loop to run to exhaustion without waiting on the real delay; production
 * callers get the real one.
 */
function backoffScheduleMs(): readonly number[] {
  const raw = process.env['CLUD_BUG_NOTARY_RETRY_MS']?.trim();
  if (raw) {
    const parsed = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (parsed.length > 0) return parsed;
  }
  return DEFAULT_BACKOFF_MS;
}

export interface NotaryRetryResult<T> {
  result: T;
  class: NotaryResponseClass;
  /** How many times `attempt` actually ran (1 when the first try wasn't `transient`). */
  attempts: number;
}

/**
 * Run `attempt` up to `NOTARY_MAX_ATTEMPTS` times, retrying with backoff only
 * while `classify(result)` says `transient`. Stops immediately on `accepted`
 * or `terminal` — a definitive answer from the notary is never retried, only
 * a failure to get one is.
 *
 * Generic over the attempt's result type `T` (not hard-coded to a single
 * `NotaryAttemptOutcome`) because `post-check-run`'s submit path retries a
 * TWO-step round (mint a nonce, then submit) as one unit — a nonce is
 * single-use, so retrying just the `/notarize` half on a stale nonce would
 * surface an unrelated terminal 401, not a second honest answer to the same
 * question (SPEC §6.5 again: that would misreport "failed to answer" as
 * "refused"). `classify` is what lets that caller supply its own mapping
 * from a two-step round onto the same three-way verdict, while every call
 * site still goes through `classifyNotaryAttempt` at the actual HTTP boundary.
 */
export async function requestNotaryWithRetry<T>(
  attempt: () => Promise<T>,
  classify: (result: T) => NotaryResponseClass,
): Promise<NotaryRetryResult<T>> {
  const backoff = backoffScheduleMs();
  let result: T;
  let cls: NotaryResponseClass;
  let tries = 0;
  for (;;) {
    tries += 1;
    result = await attempt();
    cls = classify(result);
    if (cls !== 'transient' || tries >= NOTARY_MAX_ATTEMPTS) break;
    const delay = backoff[tries - 1] ?? backoff[backoff.length - 1] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return { result, class: cls, attempts: tries };
}
