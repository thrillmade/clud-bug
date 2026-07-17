// `clud-bug build-bundle` (Phase ZP3) — transform a completed review's
// structured-output `ReviewData` JSON into a NOTARY ATTESTATION BUNDLE
// (`NotaryBundle`), ready to hand to `post-check-run --bundle`.
//
// This is the missing seam that routes the self-hosted GitHub Action through
// the notary: the Action already emits `outputs.structured_output` (the review
// `ReviewData`); this verb reads it via --stdin, flattens the finding buckets,
// derives the verdict + coverage the notary re-checks, and prints the bundle
// JSON to stdout. The workflow then pipes that into `post-check-run --bundle`.
//
// Usage:
//   <structured_output JSON> | clud-bug build-bundle \
//     --repo owner/name --pr N --sha <sha> --recipe-version <v>  > bundle.json
//
// Design notes:
//   - VERDICT is derived from `critical_findings.length > 0`, NOT the model's
//     self-reported `summary_counts`. This is the SAME rule `validateConsistency`
//     enforces on the notary side, so a bundle we build never trips its own
//     consistency check on a miscounted `summary_counts`.
//   - COVERAGE is a fresh `gh pr diff <pr> --name-only` (GitHub's ground-truth
//     changed-file set), NOT the incremental `$CHANGED` the review may have
//     scanned — the notary set-diffs coverage against GitHub's full changed
//     files (③), so a partial/incremental view would be certified as complete.

import { spawnSync } from 'node:child_process';

import {
  buildBundle,
  type NotaryBundle,
  type NotaryFinding,
  type NotarySeverity,
  type ReviewData,
  type ReviewFinding,
} from '../core/index.js';

interface BuildBundleArgs {
  repo?: string;
  pr?: number;
  sha?: string;
  recipeVersion?: string;
  stdin?: boolean;
  _?: string[];
}

/** Map one review finding (schema shape) to a bundle finding (wire shape). */
function toNotaryFinding(f: ReviewFinding, severity: NotarySeverity): NotaryFinding {
  const finding: NotaryFinding = {
    severity,
    summary: typeof f.summary === 'string' ? f.summary : '',
  };
  if (typeof f.file === 'string' && f.file) finding.file = f.file;
  if (typeof f.line === 'number' && Number.isInteger(f.line) && f.line >= 1) finding.line = f.line;
  if (typeof f.grounding === 'string' && f.grounding) finding.grounding = f.grounding;
  if (f.grounding_kind) finding.grounding_kind = f.grounding_kind;
  return finding;
}

/**
 * Pure transform: `ReviewData` (+ provenance/coverage) → `NotaryBundle`.
 * Exported for unit testing. Severity buckets map 1:1 to notary severities;
 * verdict is DERIVED from the critical bucket's length (not `summary_counts`),
 * matching `validateConsistency`.
 */
export function reviewDataToBundle(
  data: Partial<ReviewData>,
  meta: { repo: string; pr?: number; headSha: string; recipeVersion: string; coverage: string[] },
): NotaryBundle {
  // Guard against a malformed bucket: a null/non-object entry (a lying or
  // truncated structured_output) must be SKIPPED, not crash the transform.
  const isFinding = (f: unknown): f is ReviewFinding => !!f && typeof f === 'object';
  const bucket = (v: unknown): ReviewFinding[] => (Array.isArray(v) ? v.filter(isFinding) : []);
  const critical = bucket(data.critical_findings);
  const minor = bucket(data.minor_findings);
  const preexisting = bucket(data.preexisting_findings);

  const findings: NotaryFinding[] = [
    ...critical.map((f) => toNotaryFinding(f, 'critical')),
    ...minor.map((f) => toNotaryFinding(f, 'minor')),
    ...preexisting.map((f) => toNotaryFinding(f, 'preexisting')),
  ];

  // Verdict from the ACTUAL critical count — never the model's self-reported
  // summary_counts (which validateConsistency would reject if it disagreed).
  const verdict = findings.some((f) => f.severity === 'critical') ? 'critical' : 'clean';

  return buildBundle({
    repo: meta.repo,
    ...(meta.pr !== undefined ? { pr: meta.pr } : {}),
    headSha: meta.headSha,
    verdict,
    findings,
    coverage: meta.coverage,
    recipeVersion: meta.recipeVersion,
  });
}

/** Fresh ground-truth changed-file set for the PR (the notary re-checks ③ coverage). */
function loadCoverage(pr: number): string[] {
  const r = spawnSync('gh', ['pr', 'diff', String(pr), '--name-only'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return (r.stdout ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runBuildBundle(args: BuildBundleArgs): Promise<void> {
  const fail = (m: string): never => {
    process.stderr.write(`clud-bug build-bundle: ${m}\n`);
    process.exit(2);
  };

  const repo = typeof args.repo === 'string' ? args.repo.trim() : '';
  if (!repo || !repo.includes('/')) fail('--repo owner/name is required.');
  const sha = typeof args.sha === 'string' ? args.sha.trim() : '';
  if (!sha) fail('--sha <sha> is required.');
  const recipeVersion = typeof args.recipeVersion === 'string' ? args.recipeVersion.trim() : '';
  if (!recipeVersion) fail('--recipe-version <v> is required.');
  const pr = typeof args.pr === 'number' && Number.isInteger(args.pr) && args.pr > 0 ? args.pr : undefined;
  if (pr === undefined) fail('--pr <N> is required (the notary certifies PR heads).');

  // Read the review ReviewData JSON from stdin (like `render`).
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  raw = raw.trim();
  if (!raw) fail('stdin was empty — pipe the review structured_output JSON.');

  let data: Partial<ReviewData>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('payload is not a JSON object');
    data = parsed as Partial<ReviewData>;
  } catch (e) {
    return void fail(`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const coverage = loadCoverage(pr as number);
  const bundle = reviewDataToBundle(data, {
    repo,
    ...(pr !== undefined ? { pr } : {}),
    headSha: sha,
    recipeVersion,
    coverage,
  });

  process.stdout.write(JSON.stringify(bundle) + '\n');
}
