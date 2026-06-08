// Helpers for managing `required_conversation_resolution` on the default
// branch via the `gh` CLI. Factored out so `runInit` can call this without
// embedding `spawnSync` boilerplate, and so tests can swap a mock for the
// real `gh` invocation.
//
// Why `gh` rather than direct fetch(): clud-bug already depends on `gh`
// being installed and authenticated (workflows use `gh pr comment`, edit
// workflows use `gh pr create`). Reusing it inherits the user's auth
// instead of asking them to set up another token.
//
// API endpoints used:
//   GET /repos/{owner}/{repo}
//     → .default_branch
//   GET /repos/{owner}/{repo}/branches/{branch}/protection
//     → .required_conversation_resolution.enabled (true/false), OR 404 if
//       the branch has no protection rule at all.
//   POST /repos/{owner}/{repo}/branches/{branch}/protection/required_conversation_resolution
//     → enables the single flag without touching other settings. This is
//       a real single-flag endpoint; we don't have to GET-merge-PUT the
//       full protection JSON.

import { spawn } from 'node:child_process';

export interface GhResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface GhOptions {
  stdin?: string | undefined;
}

// Pluggable invoker shape — the CLI uses `defaultGh`, tests pass a mock.
export type GhInvoker = (args: string[], opts?: GhOptions) => Promise<GhResult>;

// Default `gh` invoker: spawns `gh <args>` and resolves with
// { code, stdout, stderr }. Tests pass a function with the same shape.
function defaultGh(args: string[], opts: GhOptions = {}): Promise<GhResult> {
  const { stdin } = opts;
  return new Promise<GhResult>((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // Under strict typing, spawn() can return null for stdio pipes when
    // stdio is configured to ignore the stream. We requested 'pipe' for
    // all three so the streams are guaranteed; the `!` non-null asserts
    // make this explicit and keep the runtime semantics identical.
    child.stdout!.on('data', (d: Buffer | string) => { stdout += d; });
    child.stderr!.on('data', (d: Buffer | string) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (stdin) child.stdin!.end(stdin);
    else child.stdin!.end();
  });
}

export interface DetectRepoOptions {
  gh?: GhInvoker | undefined;
}

export interface DetectedRepo {
  owner: string;
  repo: string;
}

// Returns { owner, repo } from the local git remote. Uses
// `gh repo view --json owner,name` so it doesn't depend on parsing URLs.
export async function detectRepo({ gh = defaultGh }: DetectRepoOptions = {}): Promise<DetectedRepo> {
  const { code, stdout, stderr } = await gh(['repo', 'view', '--json', 'owner,name']);
  if (code !== 0) {
    throw new Error(`gh repo view failed (${code}): ${stderr.trim() || '(no stderr)'}`);
  }
  const parsed = JSON.parse(stdout) as { owner: { login: string }; name: string };
  return { owner: parsed.owner.login, repo: parsed.name };
}

export interface DetectDefaultBranchOptions {
  owner: string;
  repo: string;
  gh?: GhInvoker | undefined;
}

// Returns the default branch name (e.g. "main", "master", "trunk").
export async function detectDefaultBranch(
  { owner, repo, gh = defaultGh }: DetectDefaultBranchOptions,
): Promise<string> {
  const { code, stdout, stderr } = await gh(['api', `repos/${owner}/${repo}`, '--jq', '.default_branch']);
  if (code !== 0) {
    throw new Error(`Could not read default_branch for ${owner}/${repo}: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout.trim();
}

export type ProtectionState =
  | { state: 'enabled' }
  | { state: 'disabled' }
  | { state: 'no-protection' }
  | { state: 'forbidden' }
  | { state: 'unknown'; reason: string };

export interface GetProtectionStateOptions {
  owner: string;
  repo: string;
  branch: string;
  gh?: GhInvoker | undefined;
}

// Inspects the current required_conversation_resolution state. Returns
// one of:
//   { state: 'enabled' }
//   { state: 'disabled' }
//   { state: 'no-protection' }   // branch has no protection rule at all
//   { state: 'forbidden' }       // user lacks admin perms
//   { state: 'unknown', reason }  // any other failure mode
//
// The reason this returns a discriminated union rather than throwing is
// that runInit decides what to do based on the state: each value above
// has a different user-facing message and follow-up action.
export async function getProtectionState(
  { owner, repo, branch, gh = defaultGh }: GetProtectionStateOptions,
): Promise<ProtectionState> {
  const { code, stdout, stderr } = await gh([
    'api',
    `repos/${owner}/${repo}/branches/${branch}/protection`,
    '--jq', '.required_conversation_resolution.enabled // false',
  ]);
  if (code === 0) {
    return { state: stdout.trim() === 'true' ? 'enabled' : 'disabled' };
  }
  // gh prints HTTP details to stderr. Look for the markers we recognize.
  // We deliberately key on 403 / 'Forbidden' / 'Resource not accessible'
  // rather than the bare word 'admin' — gh's error vocabulary can mention
  // 'admin' in unrelated contexts (administrator@…, admin api endpoint,
  // future error copy) and we don't want to misclassify those as
  // permission failures.
  const blob = `${stdout}\n${stderr}`;
  if (/404|Branch not protected|Not Found/i.test(blob)) return { state: 'no-protection' };
  if (/403|Forbidden|Resource not accessible/i.test(blob)) return { state: 'forbidden' };
  return { state: 'unknown', reason: stderr.trim() || stdout.trim() || `gh exited ${code}` };
}

export interface EnableConversationResolutionOptions {
  owner: string;
  repo: string;
  branch: string;
  gh?: GhInvoker | undefined;
}

export type EnableResult =
  | { ok: true }
  | { ok: false; state: 'no-protection' | 'forbidden' | 'unknown'; reason: string };

// Enables the single flag via the dedicated endpoint. Doesn't touch any
// other protection settings. Returns { ok: true } on success or
// { ok: false, state, reason } using the same state taxonomy as
// getProtectionState() so callers can produce a consistent message.
export async function enableConversationResolution(
  { owner, repo, branch, gh = defaultGh }: EnableConversationResolutionOptions,
): Promise<EnableResult> {
  const { code, stdout, stderr } = await gh([
    'api', '-X', 'POST',
    `repos/${owner}/${repo}/branches/${branch}/protection/required_conversation_resolution`,
  ]);
  if (code === 0) return { ok: true };
  // Match the same precise alternatives as getProtectionState — no bare
  // 'admin' fallback to avoid misclassifying unrelated error messages
  // that happen to contain the word.
  const blob = `${stdout}\n${stderr}`;
  if (/404|Branch not protected|Not Found/i.test(blob)) {
    return { ok: false, state: 'no-protection', reason: 'Branch has no base protection rule; enable basic branch protection first.' };
  }
  if (/403|Forbidden|Resource not accessible/i.test(blob)) {
    return { ok: false, state: 'forbidden', reason: 'You do not have admin permissions on this repository.' };
  }
  return { ok: false, state: 'unknown', reason: stderr.trim() || stdout.trim() || `gh exited ${code}` };
}
