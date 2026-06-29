// `clud-bug post-check-run` (H3) — post the `clud-bug-review` GitHub check-run
// from the local recipe or the self-hosted Action, so a clean review can GATE
// merge on those surfaces too (the hosted bot already posts it).
//
// Usage:
//   clud-bug post-check-run --sha <sha> --verdict clean|critical|failed \
//     [--critical-count N] [--source local|ci] [--strict|--no-strict] \
//     [--owner O --repo R] [--details-url URL] [--dry-run]
//
// Verdict → conclusion is the shared `deriveCheck` brain. strictMode defaults to
// the repo's `.clud-bug.json` (so `critical` blocks only where the repo opted in)
// unless `--strict/--no-strict` overrides. Best-effort: any failure prints a
// warning and exits 0 — posting a check must never break the review or a commit.

import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { deriveCheck, normalizeVerdict, CLUD_BUG_CHECK_NAME } from '../core/index.js';
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
  dryRun?: boolean;
  cwd?: string;
  _?: string[];
}

function sh(cmd: string, cmdArgs: string[], input?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
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

  const verdict = normalizeVerdict(typeof args.verdict === 'string' ? args.verdict : undefined);
  const criticalCount = Number(args.criticalCount ?? 0) || 0;
  const source = args.source === 'local' ? 'local' : 'ci';
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
