// `clud-bug post-check-run` (H3) — post the `clud-bug-review` GitHub check-run
// from the local recipe or the self-hosted Action, so a clean review can GATE
// merge on those surfaces too (the hosted bot already posts it).
//
// Usage:
//   clud-bug post-check-run --sha <sha> --verdict clean|critical|failed|unverified|skipped \
//     [--skip-reason "..."] [--critical-count N] [--source local|ci] \
//     [--strict|--no-strict] [--notary|--no-notary] [--owner O --repo R] \
//     [--details-url URL] [--dry-run]
//
// `--verdict skipped --skip-reason "..."` is the SPEC §6.5 surface: a gate that
// could not run posts NEUTRAL and names the cause. It is what the fork-notice
// workflow and the propagation-skip path call.
//
// --notary / --no-notary OVERRIDE the repo manifest's notary setting (mirrors
// --strict/--no-strict). CI derives this from the BASE ref so a PR cannot
// self-disable independent notary certification via its own HEAD .clud-bug.json.
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
  classifyNotaryAttempt,
  requestNotaryWithRetry,
  readNotaryConfig,
  readAttestation,
  type NotaryBundle,
  type DiffFile,
  type NotaryAttemptOutcome,
  type NotaryResponseClass,
} from '../core/index.js';
import { readManifest } from './skills.js';

interface PostCheckRunArgs {
  sha?: string;
  verdict?: string;
  /** SPEC §6.5 — why no review ran. Only meaningful with `--verdict skipped`. */
  skipReason?: string;
  criticalCount?: number;
  source?: string;
  strict?: boolean;
  /** Explicit notary enable/disable that OVERRIDES the manifest (mirrors
   *  --strict/--no-strict). CI derives this from the BASE ref so a PR cannot
   *  self-disable the notary by editing its own HEAD `.clud-bug.json`. */
  notary?: boolean;
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

/**
 * #266 — the boundary rule, SPEC §4.4:965: "A notary MUST read it from the
 * check itself, and MUST NOT accept one handed over by the reviewing party."
 *
 * The bundle is assembled by the agent that produced the review, so ANY
 * `attestation` it carries is the party under check reporting on itself. This
 * discards whatever was in the artifact and re-derives the field from the
 * harness's own store — re-derivation at the boundary, not trust in the file.
 *
 * What lands is the records and nothing else. The producer names no
 * independence identifier: an empty record set is also what an absent or
 * unreadable store produces, so nothing about who reviewed can be read off it
 * here — that reading belongs to the consumer, from evidence it holds itself.
 */
async function deriveAttestation(bundle: NotaryBundle, cwd: string): Promise<void> {
  delete bundle.attestation;
  bundle.attestation = await readAttestation({ cwd, headSha: bundle.head_sha });
}

type NotaryOutcome = 'posted' | 'rejected' | 'fallback';

interface NotaryResult {
  outcome: NotaryOutcome;
  /** The parsed + locally-validated bundle, when we got that far (for a bundle-derived fallback). */
  bundle: NotaryBundle | null;
}

/** Per-request timeout for a notary fetch — `fetch()` alone never times out,
 *  so a notary that accepts the connection and then never answers (a network
 *  partition, a deadlocked upstream) would hang the CLI forever instead of
 *  degrading like every other unreachable shape (SPEC §6.5: "a gate that
 *  cannot run MUST report that it could not"). `CLUD_BUG_NOTARY_TIMEOUT_MS`
 *  overrides it for hermetic tests, mirroring `CLUD_BUG_NOTARY_RETRY_MS`. */
const NOTARY_REQUEST_TIMEOUT_MS = 10_000;

function notaryTimeoutMs(): number {
  const raw = process.env['CLUD_BUG_NOTARY_TIMEOUT_MS']?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : NOTARY_REQUEST_TIMEOUT_MS;
}

/** `fetch`, bounded by `NOTARY_REQUEST_TIMEOUT_MS` — same
 *  AbortController+setTimeout+`finally(clearTimeout)` idiom as
 *  `tryFetchSkill` (src/cli/skills.ts). The abort surfaces as a thrown
 *  `AbortError`, which both call sites below already fold into the same
 *  `network-error` outcome as a DNS failure or ECONNREFUSED — a notary that
 *  hangs has FAILED TO ANSWER exactly as one that refuses the connection. */
function fetchNotary(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), notaryTimeoutMs());
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/** A single raw attempt at `POST {repo, pr, head_sha}` → `/notarize/challenge`,
 *  reduced to a `NotaryAttemptOutcome` — no retry, no interpretation. */
async function fetchChallengeOnce(notaryUrl: string, bundle: NotaryBundle): Promise<NotaryAttemptOutcome> {
  const url = notaryUrl.replace(/\/+$/, '') + '/notarize/challenge';
  let res: Response;
  try {
    res = await fetchNotary(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: bundle.repo, pr: bundle.pr, head_sha: bundle.head_sha }),
    });
  } catch (e) {
    return { kind: 'network-error', message: e instanceof Error ? e.message : String(e) };
  }
  return { kind: 'response', status: res.status, body: await readJsonBody(res) };
}

/** A single raw attempt at `POST bundle` → `/notarize`, reduced to a
 *  `NotaryAttemptOutcome` — no retry, no interpretation. */
async function postNotarizeOnce(notaryUrl: string, bundle: NotaryBundle): Promise<NotaryAttemptOutcome> {
  const url = notaryUrl.replace(/\/+$/, '') + '/notarize';
  let res: Response;
  try {
    res = await fetchNotary(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle),
    });
  } catch (e) {
    return { kind: 'network-error', message: e instanceof Error ? e.message : String(e) };
  }
  return { kind: 'response', status: res.status, body: await readJsonBody(res) };
}

/** Best-effort JSON parse — `undefined` on an empty or non-JSON body. Reading
 *  the body of every response (not just a success) is what lets `attemptNotarizeRound`
 *  see a `{ retryable: true }` field on an error body, wherever it's set. */
async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function extractNonce(body: unknown): string | null {
  const nonce = body && typeof body === 'object' ? (body as Record<string, unknown>)['nonce'] : undefined;
  return typeof nonce === 'string' && nonce ? nonce : null;
}

/**
 * The outcome of ONE mint-nonce-then-submit round. `not-entitled` (402 on the
 * challenge) and `challenge-malformed` (a 2xx challenge whose body carries no
 * usable nonce) are both PERMANENT states of the request as sent — retrying
 * the identical thing changes nothing, so `classifyRound` below marks them
 * `terminal` and they're never retried. `challenge`/`submit` carry whichever
 * HTTP call this round reached last, for `classifyNotaryAttempt` to classify.
 */
type NotarizeRoundOutcome =
  | { stage: 'not-entitled' }
  | { stage: 'challenge-malformed' }
  | { stage: 'challenge'; outcome: NotaryAttemptOutcome }
  | { stage: 'submit'; outcome: NotaryAttemptOutcome };

/**
 * ONE round of the Z4 handshake: mint the single-use nonce (① replay-closure)
 * via `POST /notarize/challenge`, then `POST /notarize` with it attached.
 *
 * A nonce is single-use — the App's `/notarize` consumes it BEFORE its own
 * ground-truth fetch (clud-bug-app PR #133), so on a transient failure THERE
 * (clud-bug#269's `503 { retryable: true }`), the nonce is already spent. A
 * bare retry of just `/notarize` on that stale nonce would come back a fresh
 * terminal 401 (spent nonce) — misreporting "the notary failed to answer" as
 * "the notary refused", the exact SPEC §6.5 confusion this whole path exists
 * to avoid. Re-minting the nonce EVERY round, not just the first, is what
 * keeps a retried round an honest re-ask of the same question.
 */
async function attemptNotarizeRound(notaryUrl: string, bundle: NotaryBundle): Promise<NotarizeRoundOutcome> {
  const challenge = await fetchChallengeOnce(notaryUrl, bundle);
  if (challenge.kind === 'network-error') return { stage: 'challenge', outcome: challenge };
  // 402 is not a decline of THIS bundle — it's "this install can't be
  // notarized at all" (no App / not entitled). Distinct from every other
  // status: never retried, and it falls back with its own loud warning
  // rather than the generic terminal/transient messages below.
  if (challenge.status === 402) return { stage: 'not-entitled' };
  if (classifyNotaryAttempt(challenge) !== 'accepted') return { stage: 'challenge', outcome: challenge };

  const nonce = extractNonce(challenge.body);
  if (!nonce) return { stage: 'challenge-malformed' };
  bundle.nonce = nonce;

  return { stage: 'submit', outcome: await postNotarizeOnce(notaryUrl, bundle) };
}

/** Classify a round for the retry driver. `classifyNotaryAttempt` — the SAME
 *  classifier every HTTP outcome in this file goes through — decides the
 *  `challenge`/`submit` stages; the two permanent stages are always `terminal`
 *  (stopping the retry loop immediately, on round 1). */
function classifyRound(round: NotarizeRoundOutcome): NotaryResponseClass {
  if (round.stage === 'not-entitled' || round.stage === 'challenge-malformed') return 'terminal';
  return classifyNotaryAttempt(round.outcome);
}

/**
 * The notary submit path (Phase Z). Reads + parses the bundle, LOCALLY
 * re-validates it (the handshake — a deterministic program refusing to certify
 * an inconsistent/ungrounded review), then runs the mint+submit round (above),
 * RETRYING it — bounded, with backoff (`requestNotaryWithRetry`) — for as long
 * as `classifyRound` says `transient`: SPEC §6.5, "failing to answer is not the
 * same as refusing". The server (Z4) re-validates ①–⑤ against GitHub and — as
 * SOLE issuer — posts the pinned check.
 *
 * Outcomes:
 *   'posted'   — the notary accepted; the SERVER owns the check, do not self-post.
 *   'rejected' — the certification is definitively refused (malformed / inconsistent /
 *                ungrounded bundle, OR a server 4xx AUTHORITATIVELY declining, on either
 *                `/challenge` or `/notarize`). Post NO check — never a false green off a
 *                bad artifact or over a server "no".
 *   'fallback' — every round FAILED TO ANSWER (network error / 5xx / a `retryable: true`
 *                body, exhausting the retry bound) or the install is NOT ENTITLED (402);
 *                neither is a verdict, so the caller self-posts the self-attested check
 *                (derived from THIS bundle) — never nothing, never a false green.
 */
async function submitToNotary(
  notaryUrl: string,
  bundlePath: string,
  cwd: string,
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

  // #266 — before anything else is decided about this bundle, replace its
  // attestation with the harness's own (§4.4:965). Nothing downstream — the
  // local pre-check, the challenge, the submit — may see the artifact's copy.
  await deriveAttestation(bundle, cwd);

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

  // Mint + submit, retrying the WHOLE round (bounded, with backoff) while
  // `classifyRound` says `transient` — SPEC §6.5: an unreachable notary is
  // never a refusal. A terminal decline (bad request / not-entitled / a real
  // 4xx) stops immediately; only a minted nonce that gets a real answer does.
  const { result: round, class: cls } = await requestNotaryWithRetry(
    () => attemptNotarizeRound(notaryUrl, bundle),
    classifyRound,
  );

  switch (round.stage) {
    case 'not-entitled':
      warn(
        [
          'this review is NOT notarized — no independent check verified it; the',
          'merge check is self-attested only.',
          'Install the clud-bug App / upgrade to certify: https://cludbug.dev',
        ].join('\n'),
      );
      return { outcome: 'fallback', bundle };

    case 'challenge-malformed':
      warn('notary challenge response is missing a nonce; falling back to the self-attested check.');
      return { outcome: 'fallback', bundle };

    case 'challenge': {
      const { outcome } = round;
      if (outcome.kind === 'network-error') {
        warn(`notary challenge endpoint unreachable (${outcome.message}); falling back to the self-attested check.`);
        return { outcome: 'fallback', bundle };
      }
      if (cls === 'terminal') {
        warn(`notary declined the challenge (HTTP ${outcome.status}); not certifying.`);
        return { outcome: 'rejected', bundle };
      }
      // transient, retries exhausted — the notary FAILED TO ANSWER, never a
      // refusal (SPEC §6.5). Fall back; never post nothing.
      warn(`notary challenge endpoint unavailable (HTTP ${outcome.status}); falling back to the self-attested check.`);
      return { outcome: 'fallback', bundle };
    }

    case 'submit': {
      const { outcome } = round;
      if (cls === 'accepted') {
        process.stdout.write(`clud-bug: notarized ${bundle.repo}@${bundle.head_sha.slice(0, 12)} (verdict=${bundle.verdict}); the notary posts the check.\n`);
        return { outcome: 'posted', bundle };
      }
      if (outcome.kind === 'network-error') {
        warn(`notary endpoint unreachable (${outcome.message}); falling back to the self-attested check.`);
        return { outcome: 'fallback', bundle };
      }
      // A 4xx is the SOLE issuer authoritatively declining — terminal, no check.
      if (cls === 'terminal') {
        warn(`notary declined the bundle (HTTP ${outcome.status}); not certifying.`);
        return { outcome: 'rejected', bundle };
      }
      // transient, retries exhausted (a 5xx, or a `retryable: true` body —
      // clud-bug-app#133's `503` on a ground-truth-fetch failure) — SPEC §6.5:
      // the notary FAILED TO ANSWER, which is never the same fact as a
      // refusal. Fall back to the self-attested check; never post nothing,
      // never claim a certification that did not happen.
      warn(`notary unavailable (HTTP ${outcome.status}); falling back to the self-attested check.`);
      return { outcome: 'fallback', bundle };
    }
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
  // `args.notary` (from --notary/--no-notary) OVERRIDES the manifest when set —
  // CI passes it derived from the BASE ref so a PR cannot self-disable the
  // notary via its own HEAD manifest. Unset → local default-on precedence.
  const notaryUrl = readNotaryConfig(manifest, args.notary);
  if (notaryUrl && typeof args.bundle === 'string' && args.bundle && !args.dryRun) {
    const { outcome, bundle } = await submitToNotary(notaryUrl, args.bundle, cwd, warn);
    if (outcome !== 'fallback') return;
    // Endpoint down → self-post below, derived from the ALREADY-VALIDATED bundle
    // (not the raw --verdict flags, which a bundle-only invocation never passes).
    fallbackBundle = bundle;
  }

  // --- strictMode: explicit flag wins, else the repo manifest -----------
  const strictMode =
    typeof args.strict === 'boolean' ? args.strict : (manifest as { strictMode?: unknown }).strictMode === true;

  // A bundle-fallback self-post reflects what was actually VALIDATED (bundle
  // verdict + its critical count); otherwise the raw flags.
  const verdict = fallbackBundle
    ? fallbackBundle.verdict
    : normalizeVerdict(typeof args.verdict === 'string' ? args.verdict : undefined);
  const criticalCount = fallbackBundle
    ? fallbackBundle.findings.filter((f) => f.severity === 'critical').length
    : Number(args.criticalCount ?? 0) || 0;
  // Source honors an explicit --source in BOTH paths. On the bundle-fallback
  // path a CI-originated invocation passes `--source ci` (the Action self-attests
  // as CI, not local), so only DEFAULT to 'local' there when --source is unset;
  // the non-bundle path keeps its 'ci'-unless-`--source local` default.
  const source: 'local' | 'ci' = fallbackBundle
    ? args.source === 'ci'
      ? 'ci'
      : 'local'
    : args.source === 'local'
      ? 'local'
      : 'ci';
  // SPEC §6.5 skip reason. Only read for `--verdict skipped`; a bundle can
  // never carry one (a bundle attests to a review that RAN), so the flag is the
  // sole source.
  const skipReason = typeof args.skipReason === 'string' ? args.skipReason : undefined;
  const { conclusion, title, summary } = deriveCheck({
    verdict,
    strictMode,
    criticalCount,
    source,
    ...(skipReason !== undefined ? { skipReason } : {}),
  });

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
