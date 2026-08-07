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
  loadPreset,
  isPresetName,
  DEFAULT_PRESET,
  PRESET_NAMES,
  type OctokitLike,
  type ApplyResult,
  type PresetName,
} from '../core/configure-github.js';

export interface RunConfigureGithubOptions {
  /** "owner/repo" target — required. */
  target?: string | null;
  /**
   * Ruleset preset: baseline · clud-bug · skdd · public-guard.
   * Defaults to `skdd`. Invalid values exit 2 (usage error).
   */
  preset?: string;
  /** Target branch (default `main`). */
  branch?: string;
  /** Render diff only; skip PATCH calls. */
  dryRun?: boolean;
  /** Suppress progress chatter; emit only the final `ok` summary. */
  quiet?: boolean;
  /** Emit the SPEC §3.23.1 status payload as JSON instead of key-colon-value. */
  json?: boolean;
  /** Resolver for the GitHub token (tests pass a stub). */
  resolveToken?: () => Promise<string | null>;
  /** Octokit factory (tests inject a fake; defaults to the gh-adapter). */
  octokitFactory?: (token: string) => OctokitLike;
  /** Stdout writer (tests capture). */
  stdout?: (msg: string) => void;
  /** Stderr writer (tests capture). */
  stderr?: (msg: string) => void;
}

const HELP = `clud-bug configure-github — one-stop repo setup (conveniences + SPEC §6.1 ruleset).

Usage:
  clud-bug configure-github <owner>/<repo> [options]

Applies, in order, for the selected preset:
  1. Repo conveniences (ALL presets): squash-only merges, auto-merge +
     delete-branch-on-merge on, PR title/body as the squash commit message.
  2. The canonical branch ruleset for the chosen preset.

Options:
  --preset <name>   Ruleset preset: baseline | clud-bug | skdd | public-guard.
                    Default: skdd. (baseline = structural only; clud-bug adds
                    the clud-bug-review gate; skdd adds SkDD derived-docs
                    checks; public-guard = 1 approval + code-owner.)
  --dry-run         Compute diff and print it, but do NOT create/update anything.
  --branch <name>   Target branch (default: main).
  --quiet,-q        Suppress progress chatter; emit only the final summary.
  --json            Emit the status payload as JSON (machine consumption).
  --help,-h         Show this help.

Auth (resolved in order):
  1. GITHUB_TOKEN env var (CI-friendly)
  2. \`gh auth token\` (developer workstation)

Exit codes:
  0  success or already-canonical
  1  auth missing, ruleset write error, or unrecoverable transport failure
  2  CLI usage error (missing target, bad flag)
`;

/** Resolved outcome of a configure-github run, for the §3.23.1 status payload. */
export interface ConfigureSummary {
  owner: string;
  repo: string;
  /** The preset applied (baseline · clud-bug · skdd · public-guard). */
  preset?: string;
  /** True when the repo already matches canonical-v1 (idempotent no-op). */
  alreadyCanonical: boolean;
  /** True when this was a --dry-run (no PATCH calls made). */
  dryRun: boolean;
  /** Number of changes (applied, or pending for dry-run; 0 for a no-op). */
  changes: number;
}

/**
 * SPEC §3.23.1 (NORMATIVE): emit a single-line status payload carrying
 * `alreadyCanonical` + `rulesetVersion` as named fields — JSON for machine
 * consumption, key-colon-value for humans.
 */
export function formatConfigureSummary(summary: ConfigureSummary, json: boolean): string {
  const { owner, repo, preset, alreadyCanonical, dryRun, changes } = summary;
  if (json) {
    return (
      JSON.stringify({ owner, repo, preset, alreadyCanonical, rulesetVersion: 'v2', dryRun, changes }) + '\n'
    );
  }
  const presetTag = preset ? ` preset: ${preset}` : '';
  const presetParen = preset ? ` (${preset})` : '';
  if (alreadyCanonical) {
    return `ok configure-github: owner: ${owner} repo: ${repo}${presetTag} alreadyCanonical: true rulesetVersion: v2\n`;
  }
  const plural = changes === 1 ? '' : 's';
  if (dryRun) {
    return `ok configure-github: dry-run on ${owner}/${repo}${presetParen} — ${changes} change${plural} pending\n`;
  }
  return `ok configure-github: ${owner}/${repo} converged to canonical-v1${presetParen} (${changes} change${plural})\n`;
}

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
    preset: presetOpt,
    branch = 'main',
    dryRun = false,
    quiet = false,
    json = false,
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

  // Resolve + validate the preset (usage error before any network call).
  const preset: string = presetOpt ?? DEFAULT_PRESET;
  if (!isPresetName(preset)) {
    stderr(
      `clud-bug configure-github: unknown preset "${preset}" (valid: ${PRESET_NAMES.join(', ')}).\n`,
    );
    return 2;
  }

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
      `\u{1F41B} configure-github: applying "${preset}" preset (conveniences + ruleset) to ${owner}/${repo} (branch=${branch})\n`,
    );
  }

  // Single-call orchestration: the CLI previously called
  // applyCanonicalRuleset twice in apply mode (dry-run first to display the
  // planned changes, then a real call to apply). That two-read pattern
  // opened a TOCTOU window — concurrent changes between the two reads
  // could make the displayed list diverge from the actually-applied list,
  // and the dry-run cost a redundant API round-trip every time. Drop the
  // preview-first read: pass `dryRun` straight through. The function's
  // idempotency contract (returns `alreadyCanonical: true` + empty changes
  // on a no-op) means we don't need a separate "look before you leap"
  // call. Users who want preview semantics run `--dry-run` first as a
  // distinct invocation — idiomatic CLI behavior. Surfaced by PR #166
  // reviewer (CTO follow-up 2026-06-17).
  const octokit = octokitFactory(token);
  let result: ApplyResult;
  try {
    result = await applyCanonicalRuleset(octokit, {
      owner,
      repo,
      branch,
      preset,
      dryRun,
    });
  } catch (err) {
    stderr(
      `clud-bug configure-github: ${dryRun ? 'failed to read current state' : 'ruleset write failed'}: ${stringifyError(err)}\n`,
    );
    return 1;
  }

  if (result.alreadyCanonical) {
    if (!quiet) stdout('  No changes — repo already matches canonical-v1.\n');
    stdout(formatConfigureSummary({ owner, repo, preset, alreadyCanonical: true, dryRun, changes: 0 }, json));
    return 0;
  }

  if (!quiet) {
    const verb = dryRun ? 'Planned' : 'Applied';
    stdout(`  ${verb} changes (${result.changes.length}):\n`);
    for (const c of result.changes) stdout(`    - ${c}\n`);
  }

  if (dryRun) {
    stdout(formatConfigureSummary({ owner, repo, preset, alreadyCanonical: false, dryRun: true, changes: result.changes.length }, json));
    return 0;
  }

  stdout(formatConfigureSummary({ owner, repo, preset, alreadyCanonical: false, dryRun: false, changes: result.changes.length }, json));
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
      // Pin the rulesets API media type; the wrapping error carries the
      // parsed HTTP status (from `HTTP NNN` in gh's stderr) so transport
      // failures surface with a real status code, not a shell hint.
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
      async getRepoRulesets({ owner, repo, includes_parents }) {
        // `?per_page=100` (not `--paginate`) to grab all rulesets in one
        // call — a repo realistically has a handful, and --paginate emits
        // multiple concatenated JSON arrays that our single JSON.parse can't
        // consume (see the v0.6.30 --paginate → ?per_page=100 decision).
        const parents = includes_parents === undefined ? false : includes_parents;
        const data = await ghApi<unknown>(
          'GET',
          `/repos/${owner}/${repo}/rulesets?per_page=100&includes_parents=${parents}`,
        );
        return {
          data: (Array.isArray(data) ? data : []) as Awaited<
            ReturnType<OctokitLike['repos']['getRepoRulesets']>
          >['data'],
        };
      },
      async getRepoRuleset({ owner, repo, ruleset_id }) {
        const data = await ghApi<unknown>(
          'GET',
          `/repos/${owner}/${repo}/rulesets/${ruleset_id}`,
        );
        return {
          data: data as Awaited<
            ReturnType<OctokitLike['repos']['getRepoRuleset']>
          >['data'],
        };
      },
      async createRepoRuleset({ owner, repo, ...body }) {
        const data = await ghApi<unknown>(
          'POST',
          `/repos/${owner}/${repo}/rulesets`,
          body,
        );
        return {
          data: data as Awaited<
            ReturnType<OctokitLike['repos']['createRepoRuleset']>
          >['data'],
        };
      },
      async updateRepoRuleset({ owner, repo, ruleset_id, ...body }) {
        const data = await ghApi<unknown>(
          'PUT',
          `/repos/${owner}/${repo}/rulesets/${ruleset_id}`,
          body,
        );
        return {
          data: data as Awaited<
            ReturnType<OctokitLike['repos']['updateRepoRuleset']>
          >['data'],
        };
      },
      // Repo-level conveniences (universal hygiene): GET the repo settings,
      // PATCH the drifted merge/branch-cleanup fields. Restored alongside the
      // ruleset applier so `configure-github` is the one-stop setup command.
      async get({ owner, repo }) {
        const data = await ghApi<unknown>('GET', `/repos/${owner}/${repo}`);
        return {
          data: data as Awaited<
            ReturnType<OctokitLike['repos']['get']>
          >['data'],
        };
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
 * Re-exported so callers can preload a ruleset (e.g. for a `--show-ruleset`
 * flag in future). `loadCanonicalV1` resolves the default (skdd) preset;
 * `loadPreset(name)` picks a specific variant.
 */
export { loadCanonicalV1, loadPreset };
export type { PresetName };
