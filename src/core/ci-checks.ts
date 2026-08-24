// CI evidence config + in-scope gate (SPEC 2.0 §4.7).
//
// §4.7 replaced the executable-probe surface (Phase R / clud-bug-app #87,
// `src/core/invariants.ts`, deleted alongside this module — clud-bug#264 /
// clud-bug#260) wholesale: "A reviewer MUST NOT execute code, tests, builds
// or scripts. Not from the change, not from a file the change controls, not
// from a command the change names, suggests or introduces." The sanctioned
// substitute is reading CI results the forge already produced — the
// repository's own CI already ran this change, and the reviewer reads what
// happened instead of re-solving it.
//
// This is ON BY DEFAULT (§4.7: "A reviewer reads every check that ran
// against the commit under review... a repository gets it without asking,
// and narrows it only if it turns out noisy"). `ciChecks` (SPEC's
// `review.ci_checks`) NARROWS which checks are read — it does not enable a
// capability that was off; the capability is always on, this only bounds
// its scope:
//   - absent / not an array → every check (the default)
//   - a non-empty array of names → only those checks
//   - an explicit empty array → none; the one way to switch the whole
//     behaviour off (SPEC §4.7: "the way to switch the behaviour off
//     entirely")
//
// This module is the shared, pure brain — like `design.ts` / `notary-
// config.ts` — so every consumer (today: the local recipe in
// `cli/review-prompt.ts`) resolves the same policy the same way.

import type { ReviewTrigger } from './plan-review.js';

/** Resolved `.clud-bug.json` `ciChecks` config (defaults applied). */
export interface CiChecksConfig {
  /** False only when the repo set an explicit empty array (full opt-out). */
  enabled: boolean;
  /** `null` = read every check (default/absent). A narrowed name list otherwise. */
  names: string[] | null;
}

/** On-by-default builtin: read every CI check, no narrowing. */
export const BUILTIN_CI_CHECKS_CONFIG: CiChecksConfig = {
  enabled: true,
  names: null,
};

/**
 * Read + normalize the `ciChecks` key from a parsed `.clud-bug.json` manifest.
 * Tolerant: a missing or malformed value resolves to the on-by-default
 * builtin (read every check) — a typo MUST NOT silently *disable* this
 * on-by-default evidence path, mirroring how a typo can never silently
 * *enable* a cost-bearing pass elsewhere in this file's siblings. Only an
 * EXPLICIT empty array is treated as the deliberate full opt-out SPEC §4.7
 * describes.
 */
export function readCiChecksConfig(manifest: unknown): CiChecksConfig {
  const raw = (manifest as { ciChecks?: unknown } | null | undefined)?.ciChecks;
  if (!Array.isArray(raw)) return { ...BUILTIN_CI_CHECKS_CONFIG };
  if (raw.length === 0) return { enabled: false, names: [] };

  const names = raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  // A non-empty raw array whose entries are all malformed (no valid string
  // names survive) is a typo, not a deliberate opt-out — fall back to the
  // on-by-default builtin rather than disabling evidence-reading.
  if (names.length === 0) return { ...BUILTIN_CI_CHECKS_CONFIG };

  return { enabled: true, names };
}

/**
 * Consumer-agnostic in-scope gate for reading CI evidence. Pure.
 *
 * True only when the repo hasn't explicitly switched it off (`enabled`) and
 * this is a PR-level review — no CI has run yet against a bare commit/push,
 * so there is nothing to read at those triggers.
 */
export function shouldReadCiChecks(config: CiChecksConfig, trigger: ReviewTrigger): boolean {
  return config.enabled && trigger === 'pr';
}
