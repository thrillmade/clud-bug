// Notary default-on config resolver (Phase ZP2).
//
// clud-bug is a NOTARY: a green `clud-bug-review` check is meant to be
// CERTIFIED against the diff, not merely self-asserted. Through rc.24 the
// notary only engaged when an operator manually set `CLUD_BUG_NOTARY_URL` —
// opt-IN. Phase ZP2 flips that (CEO decision): local max mode now certifies
// via the hosted notary by DEFAULT, and a repo opts OUT via `.clud-bug.json`.
//
// This module is the shared, pure brain — like `design.ts` / `invariants.ts` —
// so every consumer (`post-check-run`, `review-prompt`) resolves the SAME
// origin the SAME way and policy can't fork between them.

/** Production notary origin — the default when a repo hasn't opted out and no
 *  override is configured. Bare origin, no trailing path: callers append
 *  `/notarize` and `/notarize/challenge` themselves. */
export const DEFAULT_NOTARY_URL = 'https://app.cludbug.dev';

/**
 * Resolve the effective notary origin from a parsed `.clud-bug.json` manifest.
 * Pure — no I/O, no network — mirrors `readDesignConfig`. Returns `null` to
 * mean "self-attest" (no notary); a non-null string is the notary origin a
 * caller submits an attestation bundle to.
 *
 * Precedence:
 *   1. The manifest's `notary` key is exactly `false` → `null`. A repo that
 *      explicitly opts out is respected — this wins over everything below,
 *      including an env override, because it's a maintainer-committed,
 *      trusted "no notary here" that a stray env var should never silently
 *      re-enable.
 *   2. `CLUD_BUG_NOTARY_URL` (trimmed) is a non-empty string → that URL. The
 *      override for staging / self-hosted notaries / CI.
 *   3. Neither → `DEFAULT_NOTARY_URL`. Default-ON: local max mode certifies
 *      via the hosted notary unless the repo said otherwise.
 *
 * A single trailing slash is stripped from whatever URL is returned so
 * callers' `+ '/notarize'` / `+ '/notarize/challenge'` path-joins stay
 * correct without each call site re-normalizing.
 */
export function readNotaryConfig(manifest: unknown): string | null {
  const raw = (manifest as { notary?: unknown } | null | undefined)?.notary;
  if (raw === false) return null;

  const envUrl = process.env.CLUD_BUG_NOTARY_URL?.trim();
  if (envUrl) {
    const normalized = stripTrailingSlash(envUrl);
    // A degenerate value like "/" or "///" strips to the empty string — that is
    // not a usable origin, and it MUST NOT be mistaken for the `notary:false`
    // opt-out (only the manifest opts out). Ignore it and fall through to the
    // default (default-ON), never a silent self-attest.
    if (normalized) return normalized;
  }

  return stripTrailingSlash(DEFAULT_NOTARY_URL);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
