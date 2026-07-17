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
  readNotaryConfig,
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

/** Outcome of the `POST /challenge` round-trip that precedes `/notarize`. */
type ChallengeResult = { nonce: string } | 'rejected' | 'fallback';

/**
 * Mint the single-use nonce (Z4 ① replay-closure) the notary requires before it
 * will certify a bundle: `POST {repo, pr, head_sha}` to `/notarize/challenge`
 * (a sub-path of `/notarize`, matching the server route), expect `{ nonce }`.
 * Classified like `/notarize` — a 4xx is the server AUTHORITATIVELY
 * declining (terminal), a 5xx/network error just means the endpoint is DOWN
 * (fallback to the self-attested check) — EXCEPT 402 (not-entitled): that's not
 * a decline of THIS bundle, it's "this install can't be notarized at all", so it
 * gets a loud warning explaining why the check is unnotarized and falls back
 * rather than blocking the review with a bare rejection.
 */
async function fetchChallenge(
  notaryUrl: string,
  bundle: NotaryBundle,
  warn: (m: string) => void,
): Promise<ChallengeResult> {
  const url = notaryUrl.replace(/\/+$/, '') + '/notarize/challenge';
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: bundle.repo, pr: bundle.pr, head_sha: bundle.head_sha }),
    });
  } catch (e) {
    warn(`notary challenge endpoint unreachable (${e instanceof Error ? e.message : String(e)}); falling back to the self-attested check.`);
    return 'fallback';
  }

  if (res.status === 402) {
    warn(
      [
        'this review is NOT notarized — no independent check verified it; the',
        'merge check is self-attested only.',
        'Install the clud-bug App / upgrade to certify: https://cludbug.dev',
      ].join('\n'),
    );
    return 'fallback';
  }
  if (notaryResponseIsRejection(res.status)) {
    warn(`notary declined the challenge (HTTP ${res.status}); not certifying.`);
    return 'rejected';
  }
  if (!res.ok) {
    warn(`notary challenge endpoint unavailable (HTTP ${res.status}); falling back to the self-attested check.`);
    return 'fallback';
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    warn(`notary challenge response was not valid JSON (${e instanceof Error ? e.message : String(e)}); falling back to the self-attested check.`);
    return 'fallback';
  }
  const nonce = body && typeof body === 'object' ? (body as Record<string, unknown>)['nonce'] : undefined;
  if (typeof nonce !== 'string' || !nonce) {
    warn('notary challenge response is missing a nonce; falling back to the self-attested check.');
    return 'fallback';
  }
  return { nonce };
}

/**
 * The notary submit path (Phase Z). Reads + parses the bundle, LOCALLY
 * re-validates it (the handshake — a deterministic program refusing to certify
 * an inconsistent/ungrounded review), mints a challenge nonce, then POSTs to the
 * notary. The server (Z4) re-validates ①–⑤ against GitHub and — as SOLE issuer —
 * posts the pinned check.
 *
 * Outcomes:
 *   'posted'   — the notary accepted; the SERVER owns the check, do not self-post.
 *   'rejected' — the certification is definitively refused (malformed / inconsistent /
 *                ungrounded bundle, OR a server 4xx AUTHORITATIVELY declining, on either
 *                `/challenge` or `/notarize`). Post NO check — never a false green off a
 *                bad artifact or over a server "no".
 *   'fallback' — the endpoint is DOWN (network error or 5xx) or NOT ENTITLED (402), not a
 *                verdict; the caller may self-post the self-attested check (derived from
 *                THIS bundle) so local max mode keeps gating while Z4 is pending.
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

  // The notary certifies a PR head (it re-fetches GitHub's PR diff), so a
  // pr-less bundle (a commit-trigger local pre-notarization, no PR yet) can't be
  // notarized — don't waste a challenge on a guaranteed 422; self-attest instead.
  if (bundle.pr == null) {
    warn('bundle has no PR — the notary certifies PR heads; using the self-attested check.');
    return { outcome: 'fallback', bundle };
  }

  // Mint the single-use nonce (① replay-closure) before certifying. A terminal
  // decline here (bad request / not-entitled) never reaches `/notarize`; only a
  // minted nonce does.
  const challenge = await fetchChallenge(notaryUrl, bundle, warn);
  if (challenge === 'rejected') return { outcome: 'rejected', bundle };
  if (challenge === 'fallback') return { outcome: 'fallback', bundle };
  bundle.nonce = challenge.nonce;

  // Submit. The server re-fetches GitHub's ground-truth diff, re-runs ①–⑤,
  // checks + consumes the nonce, signs, and posts the pinned check.
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

  // --- load the repo manifest once — both the notary resolution and
  // strictMode read it, so it's fetched a single time and shared. --------
  const manifest = await readManifest(join(cwd, '.claude', 'skills'));

  // --- Notary submit path (Phase Z / ZP2) — the un-forgeable route -------
  // Default-ON (ZP2, CEO decision): `readNotaryConfig` resolves the hosted
  // notary origin unless the repo opted out (`.clud-bug.json` `notary: false`)
  // or CLUD_BUG_NOTARY_URL overrides it — `null` means self-attest, exactly
  // as an unset env var did pre-ZP2. When a URL resolves and a --bundle is
  // supplied, submit an attestation bundle: the CLI locally re-checks it (the
  // handshake) and the notary (Z4) issues the pinned check. Only 'fallback'
  // (endpoint unreachable / not entitled) continues to the self-attested
  // self-post below; 'posted'/'rejected' are terminal.
  let fallbackBundle: NotaryBundle | null = null;
  const notaryUrl = readNotaryConfig(manifest);
  if (notaryUrl && typeof args.bundle === 'string' && args.bundle && !args.dryRun) {
    const { outcome, bundle } = await submitToNotary(notaryUrl, args.bundle, warn);
    if (outcome !== 'fallback') return;
    // Endpoint down → self-post below, derived from the ALREADY-VALIDATED bundle
    // (not the raw --verdict flags, which a bundle-only invocation never passes).
    fallbackBundle = bundle;
  }

  // --- strictMode: explicit flag wins, else the repo manifest -----------
  const strictMode =
    typeof args.strict === 'boolean' ? args.strict : (manifest as { strictMode?: unknown }).strictMode === true;

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
