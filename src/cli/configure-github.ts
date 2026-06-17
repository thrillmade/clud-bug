// `clud-bug configure-github` CLI command — applies the SPEC §7 canonical
// branch protection ruleset to a target repo.
//
// External users installing the App expect "best practice branch protection"
// applied automatically. This command lets them opt in offline + dry-run
// safely BEFORE the App's auto-setup runs server-side. Same core logic
// powers both paths (the App imports `applyCanonicalRuleset` from
// clud-bug/core; this CLI passes a `gh api`-wrapping adapter so users
// don't need `@octokit/rest` on their machine).
//
// Usage:
//
//   clud-bug configure-github <owner>/<repo>
//   clud-bug configure-github <owner>/<repo> --dry-run
//   clud-bug configure-github <owner>/<repo> --branch develop
//
// Auth ladder:
//
//   1. `GITHUB_TOKEN` env var (CI-friendly, no `gh` install required)
//   2. `gh auth token` (developer workstation default)
//
// If neither produces a token, exits 1 with a recovery message.

import { spawn, spawnSync } from 'node:child_process';
import {
  applyCanonicalRuleset,
  loadCanonicalV1,
  type OctokitLike,
  type ApplyResult,
} from '../core/configure-github.js';

export interface RunConfigureGithubOptions {
  /** "owner/repo" target — required. */
  target?: string | null;
  /** Target branch (default `main`). */
  branch?: string;
  /** Render diff only; skip PATCH calls. */
  dryRun?: boolean;
  /** Suppress progress chatter; emit only the final `ok` summary. */
  quiet?: boolean;
  /** Resolver for the GitHub token (tests pass a stub). */
  resolveToken?: () => Promise<string | null>;
  /** Octokit factory (tests inject a fake; defaults to the gh-adapter). */
  octokitFactory?: (token: string) => OctokitLike;
  /** Stdout writer (tests capture). */
  stdout?: (msg: string) => void;
  /** Stderr writer (tests capture). */
  stderr?: (msg: string) => void;
}

const HELP = `clud-bug configure-github — apply SPEC §7 canonical branch protection.

Usage:
  clud-bug configure-github <owner>/<repo> [options]

Options:
  --dry-run         Compute diff and print it, but do NOT call PATCH endpoints.
  --branch <name>   Target branch (default: main).
  --quiet,-q        Suppress progress chatter; emit only the final summary.
  --help,-h         Show this help.

Auth (resolved in order):
  1. GITHUB_TOKEN env var (CI-friendly)
  2. \`gh auth token\` (developer workstation)

Exit codes:
  0  success or already-canonical
  1  auth missing, PATCH error, or unrecoverable transport failure
  2  CLI usage error (missing target, bad flag)
`;

/**
 * Entry point — wired into `clud-bug.js` dispatch. Returns a Node-style
 * exit code so the dispatcher can `process.exit()` deterministically. We
 * don't call `process.exit` ourselves so tests can drive the function
 * without taking down the harness.
 */
export async function runConfigureGithub(
  options: RunConfigureGithubOptions,
): Promise<number> {
  const {
    target,
    branch = 'main',
    dryRun = false,
    quiet = false,
    resolveToken = defaultResolveToken,
    octokitFactory = ghCliOctokit,
    stdout = (msg) => process.stdout.write(msg),
    stderr = (msg) => process.stderr.write(msg),
  } = options;

  if (!target) {
    stderr(HELP);
    return 2;
  }
  const match = /^([^/]+)\/([^/]+)$/.exec(target);
  if (!match) {
    stderr(
      `clud-bug configure-github: target must be in owner/repo form, got "${target}".\n`,
    );
    return 2;
  }
  const [, owner, repo] = match as unknown as [unknown, string, string];

  const token = await resolveToken();
  if (!token) {
    stderr(
      'clud-bug configure-github: no GitHub token found.\n' +
        '  Set GITHUB_TOKEN, or install + auth gh: brew install gh && gh auth login\n',
    );
    return 1;
  }

  if (!quiet) {
    stdout(
      `\u{1F41B} configure-github: applying canonical-v1 ruleset to ${owner}/${repo} (branch=${branch})\n`,
    );
  }

  const octokit = octokitFactory(token);
  let dryResult: ApplyResult;
  try {
    dryResult = await applyCanonicalRuleset(octokit, {
      owner,
      repo,
      branch,
      dryRun: true,
    });
  } catch (err) {
    stderr(
      `clud-bug configure-github: failed to read current state: ${stringifyError(err)}\n`,
    );
    return 1;
  }

  if (dryResult.alreadyCanonical) {
    if (!quiet) stdout('  No changes — repo already matches canonical-v1.\n');
    stdout(`ok configure-github: ${owner}/${repo} already canonical-v1\n`);
    return 0;
  }

  if (!quiet) {
    stdout(`  Planned changes (${dryResult.changes.length}):\n`);
    for (const c of dryResult.changes) stdout(`    - ${c}\n`);
  }

  if (dryRun) {
    stdout(
      `ok configure-github: dry-run on ${owner}/${repo} — ${dryResult.changes.length} change${dryResult.changes.length === 1 ? '' : 's'} pending\n`,
    );
    return 0;
  }

  let applyResult: ApplyResult;
  try {
    applyResult = await applyCanonicalRuleset(octokit, {
      owner,
      repo,
      branch,
    });
  } catch (err) {
    stderr(
      `clud-bug configure-github: PATCH failed: ${stringifyError(err)}\n`,
    );
    return 1;
  }

  stdout(
    `ok configure-github: ${owner}/${repo} converged to canonical-v1 (${applyResult.changes.length} change${applyResult.changes.length === 1 ? '' : 's'})\n`,
  );
  return 0;
}

/**
 * Auth ladder: env var first, then `gh auth token`. Surfaces a token
 * string on success or `null` if neither source has one (caller prints
 * the recovery hint).
 */
async function defaultResolveToken(): Promise<string | null> {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (result.status === 0) {
    const tok = result.stdout.trim();
    if (tok) return tok;
  }
  return null;
}

/**
 * Builds an `OctokitLike` instance backed by `gh api` shell-outs. This
 * lets us satisfy the structural interface without pulling in
 * `@octokit/rest` as a runtime dep (~200KB). The App passes its real
 * Octokit instance instead.
 */
export function ghCliOctokit(token: string): OctokitLike {
  // We pass GITHUB_TOKEN through the spawn env so gh's API surface picks
  // it up consistently whether the user supplied env or gh auth.
  const env = { ...process.env, GITHUB_TOKEN: token };

  function ghApi<T>(
    method: 'GET' | 'PUT' | 'PATCH' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const args: string[] = ['api', '-X', method];
      if (body !== undefined) {
        args.push('--input', '-');
      }
      args.push(path);
      // Add an Accept header so 404s return the structured error, not a
      // friendlier shell hint. The wrapping err.message detection in
      // `isBranchNotProtected` keys on the structured form.
      args.push('-H', 'Accept: application/vnd.github+json');
      const child = spawn('gh', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout!.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr!.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          const httpMatch = /HTTP (\d{3})/.exec(stderr);
          const status = httpMatch ? Number(httpMatch[1]) : undefined;
          const err = new Error(
            (stderr.trim() || stdout.trim() || `gh api exited ${code}`).slice(
              0,
              500,
            ),
          ) as Error & { status?: number };
          if (status !== undefined) err.status = status;
          reject(err);
          return;
        }
        try {
          resolve(stdout ? (JSON.parse(stdout) as T) : ({} as T));
        } catch (parseErr) {
          reject(parseErr);
        }
      });
      if (body !== undefined) {
        child.stdin!.end(JSON.stringify(body));
      } else {
        child.stdin!.end();
      }
    });
  }

  return {
    repos: {
      async getBranchProtection({ owner, repo, branch }) {
        const data = await ghApi<unknown>(
          'GET',
          `/repos/${owner}/${repo}/branches/${branch}/protection`,
        );
        return { data: data as Awaited<ReturnType<OctokitLike['repos']['getBranchProtection']>>['data'] };
      },
      async updateBranchProtection({ owner, repo, branch, ...rest }) {
        return ghApi(
          'PUT',
          `/repos/${owner}/${repo}/branches/${branch}/protection`,
          rest,
        );
      },
      async get({ owner, repo }) {
        const data = await ghApi<unknown>(
          'GET',
          `/repos/${owner}/${repo}`,
        );
        return { data: data as Awaited<ReturnType<OctokitLike['repos']['get']>>['data'] };
      },
      async update({ owner, repo, ...rest }) {
        return ghApi('PATCH', `/repos/${owner}/${repo}`, rest);
      },
    },
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Re-exported so callers can preload the ruleset (e.g. for a `--show-ruleset`
 * flag in future). Currently exists for parity with the App's pattern.
 */
export { loadCanonicalV1 };
