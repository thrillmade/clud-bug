// Phase Z3 — the notary ATTESTATION BUNDLE.
//
// clud-bug is a NOTARY: it VALIDATES + CERTIFIES that a review actually ran
// before a green `clud-bug-review` check gates a merge (protocol SPEC §4.5,
// "Certifying a review" — the five checks a notary must establish).
// The bundle is the wire artifact the local CLI assembles from a completed
// review and submits to the notary (`POST /notarize`, built in Z4). The server
// re-validates it against GitHub's ground-truth diff, then — as the SOLE issuer
// — posts the pinned check. This module owns the bundle SHAPE (the contract Z4
// consumes) + a tolerant parser; the pure ①–⑤ checks live in `./notary-validate`.
//
// Design note (grounding): `grounding` is REQUIRED-for-critical HERE (enforced
// by `validateGrounding`), not in the shared review-output schema
// (`./review-schema`). A schema-`required` field can be satisfied with junk; the
// load-bearing guarantee is the notary re-checking the quoted span against the
// diff. Keeping the review-output field optional avoids a discriminated-union
// ripple through the App's finding aggregator and any coupling to the live
// hosted Zod pipeline. See docs/decisions-branches/feat-notary-z3.md.

import type { ReviewVerdict } from './check-verdict.js';
import { SPEC_VERSION } from './spec-version.js';

/** Bundle wire-format version. Bump on a breaking shape change. */
export const NOTARY_BUNDLE_VERSION = 1;

/**
 * The SPEC version the bundle attests under.
 *
 * This used to read '1.2.0' and track a pre-rewrite "SPEC §10.3.3
 * (Attestation integrity)" that SPEC 2.0 does not have — the notary contract
 * now lives in §4.5 ("Certifying a review"). It disagreed with the review
 * comment's own version marker, so the two producers claimed different
 * versions of the same document (clud-bug#277).
 *
 * It is now the one `SPEC_VERSION`, which is what §7.1 means by "Every place
 * the version appears MUST agree". `bundle_version` above remains the wire
 * shape's own number and is bumped independently.
 */
export const NOTARY_PROTOCOL_VERSION = SPEC_VERSION;

export type NotarySeverity = 'critical' | 'minor' | 'preexisting';

/**
 * How a finding is grounded (mirrors the SPEC 2.0 §4.2 grounding forms:
 * quote / reproduction / invariant). The notary deterministically verifies
 * `quote` (the span must appear in the ground-truth diff); `reproduction`/
 * `invariant` carry no diff-checkable artifact and are deferred to the
 * clean-case audit. `reproduction` is a CI check that failed, named, with
 * its output — never a command the reviewer ran (§4.7 bans execution).
 */
export type GroundingKind = 'quote' | 'reproduction' | 'invariant';

/** A single finding as carried in the attestation bundle. */
export interface NotaryFinding {
  severity: NotarySeverity;
  /** File path (repo-root-relative). Absent for a genuinely cross-cutting finding. */
  file?: string;
  /** 1-indexed line in `file`. */
  line?: number;
  summary: string;
  /**
   * Evidence anchoring the finding. REQUIRED for `critical` (the notary rejects
   * a bare critical): a verbatim span from a changed line (`quote`), a named
   * CI check that failed + its output (`reproduction`), or the violated-invariant
   * statement (`invariant`).
   */
  grounding?: string;
  /** Which grounding form `grounding` uses (defaults to `quote` when absent). */
  grounding_kind?: GroundingKind;
}

/**
 * The attestation bundle — assembled locally from a completed review, submitted
 * to the notary. Z4's `/notarize` consumes exactly this shape, re-validates ①–⑤
 * against GitHub, then posts the pinned check.
 */
export interface NotaryBundle {
  bundle_version: number;
  /** `owner/repo`. */
  repo: string;
  /** PR number. Absent for a commit-trigger local pre-notarization (no PR yet). */
  pr?: number;
  head_sha: string;
  verdict: ReviewVerdict;
  findings: NotaryFinding[];
  /**
   * The changed-file paths the review covered. The notary set-diffs this against
   * GitHub's ground-truth changed files (③ coverage) so a partial / stale-checkout
   * review can't be certified as complete.
   */
  coverage: string[];
  /** The review recipe / CLI version that produced this bundle (provenance). */
  recipe_version: string;
  /**
   * The SPEC version this bundle conforms to (SPEC §4.5, "Certifying a
   * review"). The JSON key keeps its `protocol_version` spelling: it is the
   * on-the-wire contract with a deployed notary, and renaming it is a wire
   * break that buys nothing — §4.3's `spec-version` rule governs the review
   * COMMENT, not this bundle. Its VALUE is now the one `SPEC_VERSION`.
   */
  protocol_version: string;
  /**
   * Single-use nonce bound to (repo, PR, head_sha), minted by the server
   * (`POST /challenge`, Z4). Absent on a locally pre-built bundle; the server
   * requires it before certifying (① replay-closure).
   */
  nonce?: string;
}

/** Assemble a bundle from a completed review, stamping the wire + protocol versions. */
export function buildBundle(input: {
  repo: string;
  pr?: number;
  headSha: string;
  verdict: ReviewVerdict;
  findings: NotaryFinding[];
  coverage: string[];
  recipeVersion: string;
  nonce?: string;
}): NotaryBundle {
  return {
    bundle_version: NOTARY_BUNDLE_VERSION,
    repo: input.repo,
    ...(input.pr !== undefined ? { pr: input.pr } : {}),
    head_sha: input.headSha,
    verdict: input.verdict,
    findings: input.findings,
    coverage: input.coverage,
    recipe_version: input.recipeVersion,
    protocol_version: NOTARY_PROTOCOL_VERSION,
    ...(input.nonce !== undefined ? { nonce: input.nonce } : {}),
  };
}

const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'minor', 'preexisting']);
const GROUNDING_KINDS: ReadonlySet<string> = new Set(['quote', 'reproduction', 'invariant']);
const VERDICTS: ReadonlySet<string> = new Set(['clean', 'critical', 'failed', 'unverified']);

/**
 * Classify a notary `/notarize` HTTP response for the submit path. A definitive
 * client error (4xx) is the server AUTHORITATIVELY refusing to certify this
 * bundle → terminal (post NO check). A 5xx or a network error is the endpoint
 * being DOWN, not a verdict → the caller may fall back to the self-attested
 * check. Conflating the two would let a server "no" be overridden by a local green.
 */
export function notaryResponseIsRejection(status: number): boolean {
  return status >= 400 && status < 500;
}

function parseFinding(raw: unknown): NotaryFinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['severity'] !== 'string' || !SEVERITIES.has(r['severity'])) return null;
  if (typeof r['summary'] !== 'string' || !r['summary']) return null;
  const finding: NotaryFinding = {
    severity: r['severity'] as NotarySeverity,
    summary: r['summary'],
  };
  if (typeof r['file'] === 'string' && r['file']) finding.file = r['file'];
  if (typeof r['line'] === 'number' && Number.isInteger(r['line']) && r['line'] >= 1) {
    finding.line = r['line'];
  }
  if (typeof r['grounding'] === 'string' && r['grounding']) finding.grounding = r['grounding'];
  if (typeof r['grounding_kind'] === 'string' && GROUNDING_KINDS.has(r['grounding_kind'])) {
    finding.grounding_kind = r['grounding_kind'] as GroundingKind;
  }
  return finding;
}

/**
 * Tolerant parser for a bundle read from disk / the wire. Returns null on a
 * missing or malformed required field (never throws) — the CLI treats a null as
 * "no submittable bundle" and falls back to the self-attested path. A malformed
 * finding is DROPPED, not tolerated silently into a green: if any finding is
 * unparseable the whole bundle is rejected (null), so a truncated payload can't
 * be certified as if it were complete.
 */
export function parseBundle(raw: unknown): NotaryBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['repo'] !== 'string' || !r['repo'].includes('/')) return null;
  if (typeof r['head_sha'] !== 'string' || !r['head_sha']) return null;
  // `verdict` is enum-typed — whitelist it like every other enum field, so a
  // garbage verdict is a malformed bundle (null), never blind-cast through the
  // trust boundary into validateConsistency / a derived check.
  if (typeof r['verdict'] !== 'string' || !VERDICTS.has(r['verdict'])) return null;
  if (!Array.isArray(r['findings'])) return null;
  if (!Array.isArray(r['coverage'])) return null;

  const findings: NotaryFinding[] = [];
  for (const f of r['findings']) {
    const parsed = parseFinding(f);
    if (!parsed) return null; // reject the whole bundle rather than silently drop a finding
    findings.push(parsed);
  }
  const coverage = r['coverage'].filter((c): c is string => typeof c === 'string');
  if (coverage.length !== r['coverage'].length) return null;

  const bundle: NotaryBundle = {
    bundle_version:
      typeof r['bundle_version'] === 'number' ? r['bundle_version'] : NOTARY_BUNDLE_VERSION,
    repo: r['repo'],
    head_sha: r['head_sha'],
    verdict: r['verdict'] as ReviewVerdict,
    findings,
    coverage,
    recipe_version: typeof r['recipe_version'] === 'string' ? r['recipe_version'] : '',
    protocol_version:
      typeof r['protocol_version'] === 'string' ? r['protocol_version'] : NOTARY_PROTOCOL_VERSION,
  };
  if (typeof r['pr'] === 'number' && Number.isInteger(r['pr'])) bundle.pr = r['pr'];
  if (typeof r['nonce'] === 'string' && r['nonce']) bundle.nonce = r['nonce'];
  return bundle;
}
