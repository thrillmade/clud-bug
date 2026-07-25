// Tests for src/cli/review.ts — `clud-bug review-done <sha>` and
// `clud-bug review --pending` (#239): the two-phase-marker completion step
// and the durable pending-queue drain the commit-review hook (hooks.ts)
// relies on so a usage-limit-killed review is never mistaken for a
// completed one, and an abandoned review is never invisible to a drain.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HOOK_FIRED_FILE, REVIEW_DONE_FILE, PENDING_QUEUE_FILE } from '../src/cli/hooks.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-review-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);

  const skillsDir = join(dir, '.claude', 'skills');
  await mkdir(join(skillsDir, 'critical-issues-only'), { recursive: true });
  await writeFile(
    join(skillsDir, '.clud-bug.json'),
    JSON.stringify({
      version: 1,
      installed: [
        { slug: 'critical-issues-only', name: 'critical-issues-only', source: 'manual', kind: 'baseline', description: 'x' },
      ],
    }),
  );
  await writeFile(
    join(skillsDir, 'critical-issues-only', 'SKILL.md'),
    '---\nname: critical-issues-only\ndescription: x\nsource: manual\nreview_mode: shared\n---\n\nrules',
  );
  return dir;
}

describe('clud-bug review-done', () => {
  it('defaults to HEAD when no sha is given, writing the shared done marker', async () => {
    const dir = await makeRepo();
    const head = git(dir, ['rev-parse', 'HEAD']);

    const r = run(dir, ['review-done']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(head);

    const done = await readFile(join(dir, '.git', REVIEW_DONE_FILE), 'utf8');
    expect(done.trim()).toBe(head);
  });

  it('accepts an explicit sha', async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, 'f.txt'), 'x');
    git(dir, ['add', 'f.txt']);
    git(dir, ['commit', '-q', '-m', 'feat: f']);
    const oldSha = git(dir, ['rev-parse', 'HEAD~1']);

    const r = run(dir, ['review-done', oldSha]);
    expect(r.status).toBe(0);
    const done = await readFile(join(dir, '.git', REVIEW_DONE_FILE), 'utf8');
    expect(done.trim()).toBe(oldSha);
  });

  it('#239: removes the confirmed sha from the pending queue (a completed review must not linger in --pending)', async () => {
    const dir = await makeRepo();
    const sha = git(dir, ['rev-parse', 'HEAD']);
    const otherSha = 'a'.repeat(40);
    await writeFile(join(dir, '.git', PENDING_QUEUE_FILE), `${sha}\n${otherSha}\n`);

    const r = run(dir, ['review-done', sha]);
    expect(r.status).toBe(0);

    const pending = await readFile(join(dir, '.git', PENDING_QUEUE_FILE), 'utf8');
    expect(pending).not.toContain(sha);
    expect(pending).toContain(otherSha); // unrelated queued sha survives
  });

  it('#240 vector 1: writes the done marker to the SHARED common dir even when run from a linked worktree', async () => {
    const dir = await makeRepo();
    const wtDir = join(dir, '..', `${dir.split('/').pop()}-wt`);
    git(dir, ['worktree', 'add', '-q', wtDir, '-b', 'wt1']);
    await writeFile(join(wtDir, 'g.txt'), 'y');
    git(wtDir, ['add', 'g.txt']);
    git(wtDir, ['commit', '-q', '-m', 'feat: g']);
    const wtSha = git(wtDir, ['rev-parse', 'HEAD']);

    const r = run(wtDir, ['review-done']);
    expect(r.status).toBe(0);

    // Lands in the PRIMARY checkout's .git (shared common dir), not the
    // worktree-private .git/worktrees/wt1/.
    const done = await readFile(join(dir, '.git', REVIEW_DONE_FILE), 'utf8');
    expect(done.trim()).toBe(wtSha);
  });
});

describe('clud-bug review --pending', () => {
  it('reports "no pending reviews" when the queue is empty or missing', async () => {
    const dir = await makeRepo();
    const r = run(dir, ['review', '--pending']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no pending reviews/i);
  });

  it('#239: drains 2 queued shas — prints one recipe per sha, oldest first, and clears the queue', async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, 'a.txt'), 'a');
    git(dir, ['add', 'a.txt']);
    git(dir, ['commit', '-q', '-m', 'feat: a']);
    const shaA = git(dir, ['rev-parse', 'HEAD']);

    await writeFile(join(dir, 'b.txt'), 'b');
    git(dir, ['add', 'b.txt']);
    git(dir, ['commit', '-q', '-m', 'feat: b']);
    const shaB = git(dir, ['rev-parse', 'HEAD']);

    await writeFile(join(dir, '.git', PENDING_QUEUE_FILE), `${shaA}\n${shaB}\n`);

    const r = run(dir, ['review', '--pending']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/draining 2 pending review/i);
    expect(r.stdout).toContain(shaA);
    expect(r.stdout).toContain(shaB);
    // oldest (A) printed before newest (B)
    expect(r.stdout.indexOf(shaA)).toBeLessThan(r.stdout.indexOf(shaB));
    // each recipe targets its OWN sha via `git show <sha>`, not HEAD
    expect(r.stdout).toMatch(new RegExp(`git show[^\\n]*${shaA}`));
    expect(r.stdout).toMatch(new RegExp(`git show[^\\n]*${shaB}`));
    // each still ends with the review-done completion instruction
    expect(r.stdout).toMatch(/review-done <sha>/);

    const pendingAfter = await readFile(join(dir, '.git', PENDING_QUEUE_FILE), 'utf8');
    expect(pendingAfter.trim()).toBe('');

    // draining again now reports empty
    const r2 = run(dir, ['review', '--pending']);
    expect(r2.stdout).toMatch(/no pending reviews/i);
  });

  it('#240 vector 1: drains a worktree-made commit from the PRIMARY checkout (shared queue)', async () => {
    const dir = await makeRepo();
    const wtDir = join(dir, '..', `${dir.split('/').pop()}-wt2`);
    git(dir, ['worktree', 'add', '-q', wtDir, '-b', 'wt2']);
    await writeFile(join(wtDir, 'g.txt'), 'y');
    git(wtDir, ['add', 'g.txt']);
    git(wtDir, ['commit', '-q', '-m', 'feat: g']);
    const wtSha = git(wtDir, ['rev-parse', 'HEAD']);

    // Simulate the hook having proactively queued the worktree commit (it
    // writes to the shared common dir — see hooks.ts / hooks.test.js).
    await writeFile(join(dir, '.git', PENDING_QUEUE_FILE), `${wtSha}\n`);

    // Drain run from the PRIMARY checkout must see it.
    const r = run(dir, ['review', '--pending']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(wtSha);
  });

  it('without --pending, warns rather than silently no-op-ing', async () => {
    const dir = await makeRepo();
    const r = run(dir, ['review']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--pending/);
  });
});
