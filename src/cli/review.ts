// `clud-bug review-done <sha>` / `clud-bug review --pending` (#239) — the
// two-phase-marker completion step and the durable pending-queue drain.
//
// The commit-review hook (hooks.ts) writes `clud-bug-hook-fired` BEFORE the
// agent actually reviews anything — the hook can only know a recipe was
// SURFACED, never that it was FOLLOWED. Before this, that meant a
// usage-limit-killed session left a marker indistinguishable from a
// completed review: the next hook fire saw the sha match and exited 0. Now
// `clud-bug-hook-fired` means only "surfaced, pending"; ONLY this verb
// (`review-done`, run by the agent as the LAST step of the recipe it was
// handed) writes `clud-bug-review-done`. The hook re-fires — and durably
// queues the abandoned sha — for anything `fired` but not yet `done`.
//
// `--pending` drains `.git/clud-bug-pending` (relative to the git COMMON
// dir, so it's shared across every linked worktree — see hooks.ts's #240
// vector-1 fix): a durable queue of shas whose review deferred (a
// usage-limit kill, or a recipe-fetch tooling error) that nothing
// previously enumerated — the old skip path was a dead end.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderReviewRecipe, resolveReviewInputs } from './review-prompt.js';
import { HOOK_FIRED_FILE, REVIEW_DONE_FILE, PENDING_QUEUE_FILE } from './hooks.js';

interface ReviewArgs {
  pending?: boolean;
  cwd?: string;
  diffSizeBytes?: number;
  _?: string[];
}

interface ReviewDoneArgs {
  cwd?: string;
  _?: string[];
}

function sh(cmd: string, args: string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

/**
 * Resolve the SAME shared bookkeeping directory the hook script's shell logic
 * uses (hooks.ts): `git rev-parse --git-common-dir`, then a `cd "$dir" && pwd`
 * normalization pass run in the SAME subshell mechanism as the hook — not a
 * reimplementation in `node:path` — so the two can never disagree about
 * where the markers live even under an edge case (a symlinked checkout path)
 * where `path.resolve` and a shell's `pwd` could diverge. Worktree-aware:
 * this is the ONE location shared by every linked worktree of a repo.
 */
function resolveCommonGitDir(cwd: string): string | null {
  const dir = sh('git', ['rev-parse', '--git-common-dir'], cwd);
  if (!dir.ok || !dir.out) return null;
  const abs = spawnSync('sh', ['-c', 'cd "$1" 2>/dev/null && pwd', '_', dir.out], {
    cwd,
    encoding: 'utf8',
  });
  const out = (abs.stdout ?? '').trim();
  return abs.status === 0 && out ? out : null;
}

function resolveSha(cwd: string, explicit: string | undefined): string | null {
  const sha = (explicit ?? '').trim();
  if (sha) return sha;
  const r = sh('git', ['rev-parse', 'HEAD'], cwd);
  return r.ok && r.out ? r.out : null;
}

/**
 * `clud-bug review-done [sha]` — the explicit completion step the hook's
 * recipe instructs the agent to run once it ACTUALLY finishes reviewing a
 * commit (not merely once the recipe was surfaced). Writes the shared
 * `clud-bug-review-done` marker (git COMMON dir — worktree-shared, #240
 * vector 1) so the next hook fire sees `fired === done` for this sha and
 * doesn't re-open it. Defaults to HEAD when no sha is given.
 */
export async function runReviewDone(args: ReviewDoneArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const warn = (m: string) => process.stderr.write(`clud-bug review-done: ${m}\n`);

  const explicitSha = args._?.[1];
  const sha = resolveSha(cwd, explicitSha);
  if (!sha) return void warn('could not resolve a sha (pass one explicitly, or run inside a git repo).');

  const gitdir = resolveCommonGitDir(cwd);
  if (!gitdir) return void warn('could not resolve the git common dir; not marking done.');

  try {
    await writeFile(join(gitdir, REVIEW_DONE_FILE), sha);
  } catch (e) {
    return void warn(`could not write the done marker (${e instanceof Error ? e.message : String(e)}).`);
  }

  // The hook proactively queues every sha it hands off (so an abandoned
  // review is drainable even if no LATER commit ever discovers it stuck) —
  // remove it here now that it's actually confirmed done, so a completed
  // review doesn't linger in `clud-bug review --pending`'s drain list.
  const pendingPath = join(gitdir, PENDING_QUEUE_FILE);
  try {
    const raw = await readFile(pendingPath, 'utf8');
    const remaining = raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== sha);
    await writeFile(pendingPath, remaining.length > 0 ? remaining.join('\n') + '\n' : '');
  } catch {
    // no pending file, or this sha was never in it — nothing to remove.
  }

  process.stdout.write(`clud-bug: review-done ${sha}\n`);
}

/**
 * `clud-bug review --pending` — drain `.git/clud-bug-pending` (git COMMON
 * dir), printing one recipe per queued sha (oldest first) so the agent can
 * follow each in turn, then clearing the queue (drained shas become the
 * agent's responsibility from here, same fire-and-forget contract as the
 * live hook's exit-2 handoff). Each printed recipe still ends with the same
 * `clud-bug review-done <sha>` instruction, so a session that dies AGAIN
 * mid-drain still re-queues correctly next time (the fired marker is set by
 * the hook only for the LIVE HEAD commit, not for drained pending entries —
 * so a drained sha that never gets `review-done`'d simply stays undrained
 * from `clud-bug-pending`'s perspective only in the sense that this command
 * already removed it; the sha's own fired/done pair, if it has one, is
 * unaffected).
 */
export async function runReview(args: ReviewArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const warn = (m: string) => process.stderr.write(`clud-bug review: ${m}\n`);

  if (!args.pending) {
    warn('no verb given — did you mean `clud-bug review --pending`?');
    process.exitCode = 2;
    return;
  }

  const gitdir = resolveCommonGitDir(cwd);
  if (!gitdir) return void warn('could not resolve the git common dir; nothing to drain.');

  const pendingPath = join(gitdir, PENDING_QUEUE_FILE);
  let raw = '';
  try {
    raw = await readFile(pendingPath, 'utf8');
  } catch {
    // no queue file — nothing pending.
  }
  const shas = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (shas.length === 0) {
    process.stdout.write('clud-bug: no pending reviews.\n');
    return;
  }

  // `design` + `probes` are deliberately not forwarded: both are pr-gated and
  // this drain is always a `commit` trigger, so `resolveReviewInputs` returns
  // them undefined anyway. `prose` IS forwarded — SPEC 2.0 §2.2's prose pass
  // "Runs: always", so it is not trigger-gated (clud-bug#263).
  const { plan, reviewContext, prose, notaryUrl } = await resolveReviewInputs(
    cwd,
    'commit',
    args.diffSizeBytes,
  );

  const recipes = shas.map((sha, i) => {
    const recipe = renderReviewRecipe({
      plan,
      trigger: 'commit',
      notaryUrl,
      targetSha: sha,
      ...(reviewContext ? { reviewContext } : {}),
      ...(prose ? { prose } : {}),
    });
    return `# Pending review ${i + 1}/${shas.length}\n\n${recipe}`;
  });

  // Drain — once handed off via stdout, these are the agent's responsibility
  // (the same fire-and-forget contract the live hook's exit-2 handoff uses).
  // Never leaves an old queue file around for a NEXT pending sha (added
  // later, after this drain) to be silently deduplicated against.
  try {
    await writeFile(pendingPath, '');
  } catch (e) {
    warn(`drained ${shas.length} pending review(s) but could not clear the queue file (${e instanceof Error ? e.message : String(e)}) — it may re-print next time.`);
  }

  process.stdout.write(
    `clud-bug: draining ${shas.length} pending review(s) — follow each recipe below, then run ` +
      `\`clud-bug review-done <sha>\` for each.\n\n` +
      recipes.join('\n\n---\n\n') +
      '\n',
  );
}

// Re-exported so callers that only need the marker filenames (e.g. tests)
// don't have to import from hooks.ts directly.
export { HOOK_FIRED_FILE, REVIEW_DONE_FILE, PENDING_QUEUE_FILE };
