// `clud-bug post-check-run` (H3) — post the `clud-bug-review` GitHub check-run
// from the local recipe or the self-hosted Action, so a clean review can GATE
// merge on those surfaces too (the hosted bot already posts it).
//
// Usage:
//   clud-bug post-check-run --sha <sha> --verdict clean|critical|failed|unverified \
//     [--critical-count N] [--source local|ci] [--strict|--no-strict] \
//     [--owner O --repo R] [--details-url URL] [--dry-run]
//
// Verdict → conclusion is the shared `deriveCheck` brain. strictMode defaults to
// the repo's `.clud-bug.json` (so `critical` blocks only where the repo opted in)
// unless `--strict/--no-strict` overrides. Best-effort: any failure prints a
// warning and exits 0 — posting a check must never break the review or a commit.

import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  deriveCheck,
  normalizeVerdict,
  CLUD_BUG_CHECK_NAME,
  parseBundle,
  validateBundle,
  validateConsistency,
  splitUnifiedDiff,
  notaryResponseIsRejection,
  type NotaryBundle,
  type DiffFile,
} from '../core/index.js';
import { readManifest } from './skills.js';

interface PostCheckRunArgs {
  sha?: string;
  verdict?: string;
  criticalCount?: number;
  source?: string;
  strict?: boolean;
  owner?: string;
  repo?: string;
  detailsUrl?: string;
  /** Path to a notary attestation bundle (JSON). Activates the notary submit path. */
  bundle?: string;
  dryRun?: boolean;
  cwd?: string;
  _?: string[];
}

function sh(cmd: string, cmdArgs: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/**
 * Best-effort load of the diff a bundle attests to, as `DiffFile[]`, for the
 * LOCAL pre-check. Prefers the PR diff (matches GitHub's view); falls back to
 * the commit diff. Returns `[]` when neither is obtainable — the caller then
 * skips the diff-dependent checks (③④) and lets the SERVER do the authoritative
 * validation against GitHub's ground truth (Z4).
 */
function loadDiffFiles(bundle: NotaryBundle): DiffFile[] {
  let raw = '';
  if (bundle.pr !== undefined) {
    const r = sh('gh', ['pr', 'diff', String(bundle.pr), '--color', 'never']);
    if (r.ok) raw = r.out;
  }
  if (!raw && bundle.head_sha) {
    // -c core.quotepath=false → git emits non-ASCII paths as literal UTF-8
    // (no octal quoting), so the splitter sees real filenames.
    const r = sh('git', ['-c', 'core.quotepath=false', 'show', '--no-color', '--format=', bundle.head_sha]);
    if (r.ok) raw = r.out;
  }
  return raw ? splitUnifiedDiff(raw) : [];
}

type NotaryOutcome = 'posted' | 'rejected' | 'fallback';

interface NotaryResult {
  outcome: NotaryOutcome;
  /** The parsed + locally-validated bundle, when we got that far (for a bundle-derived fallback). */
  bundle: NotaryBundle | null;
}

/**
 * The notary submit path (Phase Z). Reads + parses the bundle, LOCALLY
 * re-validates it (the handshake — a deterministic program refusing to certify
 * an inconsistent/ungrounded review), then POSTs to the notary. The server (Z4)
 * re-validates ①–⑤ against GitHub and — as SOLE issuer — posts the pinned check.
 *
 * Outcomes:
 *   'posted'   — the notary accepted; the SERVER owns the check, do not self-post.
 *   'rejected' — the certification is definitively refused (malformed / inconsistent /
 *                ungrounded bundle, OR a server 4xx AUTHORITATIVELY declining). Post
 *                NO check — never a false green off a bad artifact or over a server "no".
 *   'fallback' — the endpoint is DOWN (network error or 5xx), not a verdict; the caller
 *                may self-post the self-attested check (derived from THIS bundle) so local
 *                max mode keeps gating while Z4 is pending.
 */
async function submitToNotary(
  notaryUrl: string,
  bundlePath: string,
  warn: (m: string) => void,
): Promise<NotaryResult> {
  let bundle: NotaryBundle | null;
  try {
    bundle = parseBundle(JSON.parse(await readFile(bundlePath, 'utf8')));
  } catch (e) {
    warn(`could not read the bundle at ${bundlePath} (${e instanceof Error ? e.message : String(e)}); not certifying.`);
    return { outcome: 'rejected', bundle: null };
  }
  if (!bundle) {
    warn(`the bundle at ${bundlePath} is malformed; not certifying (fix the review artifact).`);
    return { outcome: 'rejected', bundle: null };
  }

  // Local pre-check: consistency is diff-free (always run); coverage + grounding
  // need the diff (run only when one is obtainable — else defer to the server).
  const diffFiles = loadDiffFiles(bundle);
  const consistency = validateConsistency(bundle.verdict, bundle.findings);
  if (!consistency.ok) {
    warn(`bundle is internally inconsistent — ${consistency.reason}; not certifying.`);
    return { outcome: 'rejected', bundle };
  }
  if (diffFiles.length > 0) {
    const v = validateBundle(bundle, diffFiles);
    if (!v.coverage.ok) {
      warn(`bundle coverage is incomplete — unreviewed changed file(s): ${v.coverage.missingFiles.join(', ')}; not certifying.`);
      return { outcome: 'rejected', bundle };
    }
    if (!v.grounding.ok) {
      warn(`bundle has ungrounded critical finding(s): ${v.grounding.violations.map((x) => x.reason).join('; ')}; not certifying.`);
      return { outcome: 'rejected', bundle };
    }
  }

  // Submit. TODO(Z4): the server mints/consumes the nonce, re-fetches GitHub's
  // ground-truth diff, re-runs ①–⑤, signs, and posts the pinned check.
  const url = notaryUrl.replace(/\/+$/, '') + '/notarize';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    if (res.ok) {
      process.stdout.write(`clud-bug: notarized ${bundle.repo}@${bundle.head_sha.slice(0, 12)} (verdict=${bundle.verdict}); the notary posts the check.\n`);
      return { outcome: 'posted', bundle };
    }
    // A 4xx is the SOLE issuer authoritatively declining — terminal, no check.
    // Only a 5xx (server down) is a fallback-able outage.
    if (notaryResponseIsRejection(res.status)) {
      warn(`notary declined the bundle (HTTP ${res.status}); not certifying.`);
      return { outcome: 'rejected', bundle };
    }
    warn(`notary unavailable (HTTP ${res.status}); falling back to the self-attested check.`);
    return { outcome: 'fallback', bundle };
  } catch (e) {
    warn(`notary endpoint unreachable (${e instanceof Error ? e.message : String(e)}); falling back to the self-attested check.`);
    return { outcome: 'fallback', bundle };
  }
}

export async function runPostCheckRun(args: PostCheckRunArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const warn = (m: string) => process.stderr.write(`clud-bug post-check-run: ${m}\n`);

  // --- resolve the head SHA (default HEAD) -------------------------------
  let sha = typeof args.sha === 'string' ? args.sha.trim() : '';
  if (!sha) {
    const r = sh('git', ['rev-parse', 'HEAD']);
    if (!r.ok) return void warn('no --sha and `git rev-parse HEAD` failed; skipping.');
    sha = r.out;
  }

  // --- Notary submit path (Phase Z) — the un-forgeable route -------------
  // When CLUD_BUG_NOTARY_URL is set and a --bundle is supplied, submit an
  // attestation bundle: the CLI locally re-checks it (the handshake) and the
  // notary (Z4) issues the pinned check. Only 'fallback' (endpoint unreachable)
  // continues to the self-attested self-post below; 'posted'/'rejected' are terminal.
  let fallbackBundle: NotaryBundle | null = null;
  const notaryUrl = process.env.CLUD_BUG_NOTARY_URL?.trim();
  if (notaryUrl && typeof args.bundle === 'string' && args.bundle && !args.dryRun) {
    const { outcome, bundle } = await submitToNotary(notaryUrl, args.bundle, warn);
    if (outcome !== 'fallback') return;
    // Endpoint down → self-post below, derived from the ALREADY-VALIDATED bundle
    // (not the raw --verdict flags, which a bundle-only invocation never passes).
    fallbackBundle = bundle;
  }

  // --- strictMode: explicit flag wins, else the repo manifest -----------
  let strictMode = false;
  if (typeof args.strict === 'boolean') {
    strictMode = args.strict;
  } else {
    try {
      const manifest = await readManifest(join(cwd, '.claude', 'skills'));
      strictMode = (manifest as { strictMode?: unknown }).strictMode === true;
    } catch {
      /* no manifest → advisory */
    }
  }

  // A bundle-fallback self-post reflects what was actually VALIDATED (bundle
  // verdict + its critical count, local source); otherwise the raw flags.
  const verdict = fallbackBundle
    ? fallbackBundle.verdict
    : normalizeVerdict(typeof args.verdict === 'string' ? args.verdict : undefined);
  const criticalCount = fallbackBundle
    ? fallbackBundle.findings.filter((f) => f.severity === 'critical').length
    : Number(args.criticalCount ?? 0) || 0;
  const source: 'local' | 'ci' = fallbackBundle ? 'local' : args.source === 'local' ? 'local' : 'ci';
  const { conclusion, title, summary } = deriveCheck({ verdict, strictMode, criticalCount, source });

  // --- resolve owner/repo (flags, else gh) ------------------------------
  let owner = typeof args.owner === 'string' ? args.owner : '';
  let repo = typeof args.repo === 'string' ? args.repo : '';
  if (!owner || !repo) {
    const r = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    if (r.ok && r.out.includes('/')) {
      const parts = r.out.split('/');
      owner = parts[0] ?? '';
      repo = parts[1] ?? '';
    }
  }

  const body: Record<string, unknown> = {
    name: CLUD_BUG_CHECK_NAME,
    head_sha: sha,
    status: 'completed',
    conclusion,
    output: { title, summary },
  };
  if (typeof args.detailsUrl === 'string') body['details_url'] = args.detailsUrl;

  if (args.dryRun) {
    process.stdout.write(
      `clud-bug post-check-run (dry-run)\n` +
        `  ${owner || '<owner>'}/${repo || '<repo>'} @ ${sha.slice(0, 12)}\n` +
        `  verdict=${verdict} strict=${strictMode} source=${source} → conclusion=${conclusion}\n` +
        `  title: ${title}\n`,
    );
    return;
  }

  if (!owner || !repo) return void warn('could not resolve owner/repo (pass --owner/--repo or run inside a gh-authed repo); skipping.');

  // NB: this POSTs a fresh check-run each call (no list+update like the hosted
  // bot). Branch protection evaluates the MOST RECENT check-run for a name on a
  // SHA, so the gate stays correct — a re-run after a fix overrides a prior
  // failure. The only cost is cosmetic: repeated runs on one SHA stack entries
  // in the PR's checks UI. (A list+update upsert is a possible future refinement.)
  const r = sh('gh', ['api', `repos/${owner}/${repo}/check-runs`, '-X', 'POST', '--input', '-'], JSON.stringify(body));
  if (!r.ok) {
    // Most common: the token lacks `checks: write`. Never fatal.
    warn(`could not post the ${CLUD_BUG_CHECK_NAME} check (${r.err.split('\n')[0] || 'unknown error'}); the review still stands.`);
    return;
  }
  process.stdout.write(`clud-bug: posted ${CLUD_BUG_CHECK_NAME} = ${conclusion} on ${sha.slice(0, 12)}\n`);
}
