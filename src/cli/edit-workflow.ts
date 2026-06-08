import { spawnSync } from 'node:child_process';

// Validates that the working tree's pending changes are scoped to
// .github/workflows/clud-bug-*.yml. If yes, creates a branch, commits,
// pushes, and prints the gh command for opening a PR. Mixed changes are
// refused — the whole point is to keep workflow edits in an isolated PR
// so claude-code-action's workflow-self-mod guard doesn't bundle them
// with other reviewable work.

export interface PendingWorkflowEdits {
  allWorkflow: boolean;
  files: string[];
  nonWorkflow: string[];
}

export function getPendingWorkflowEdits(cwd: string = process.cwd()): PendingWorkflowEdits {
  // --untracked-files=all so new files in new directories are reported as
  // individual paths instead of being collapsed to the parent dir (default
  // 'normal' mode would emit '.github/' for a brand-new clud-bug-review.yml).
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    // r.stderr is `string | null` under strict; safe to coalesce to '' for the
    // error message — null here means the child failed to spawn entirely.
    throw new Error(`git status failed: ${(r.stderr ?? '').trim()}`);
  }
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter(Boolean);
  if (lines.length === 0) return { allWorkflow: true, files: [], nonWorkflow: [] };

  const files: string[] = [];
  const nonWorkflow: string[] = [];
  for (const line of lines) {
    // porcelain format: XY <space> <path> ; rename: XY old -> new
    // .pop() on a non-empty split always yields a string here, but
    // noUncheckedIndexedAccess makes TS pessimistic — coalesce + trim.
    const path = (line.slice(3).split(' -> ').pop() ?? '').trim();
    files.push(path);
    if (!isWorkflowFile(path)) nonWorkflow.push(path);
  }
  return { allWorkflow: nonWorkflow.length === 0, files, nonWorkflow };
}

export function isWorkflowFile(path: string): boolean {
  return /^\.github\/workflows\/clud-bug-.*\.ya?ml$/.test(path);
}

export function makeBranchName(date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `clud-bug/edit-workflow-${stamp}`;
}

export interface GitOptions {
  allowFail?: boolean | undefined;
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[], opts: GitOptions = {}): GitResult {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${(r.stderr ?? '').trim()}`);
  }
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}
