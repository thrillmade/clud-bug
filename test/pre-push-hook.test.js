// #276 — the PRE-PUSH surface (SPEC 2.0 §6.7 / §4.1).
//
// Before this landed, `git grep -inE 'pre-push|prePush|pre_push' origin/main --
// src/ templates/` returned ZERO hits (control probe `PostToolUse` → 2 files,
// so the search itself worked) while §4.1 said of the local review: "A reviewer
// MUST support both, and push is the default".
//
// These cover the pure builder + the install planner, then EXECUTE the
// generated script against REAL git state — real remotes, real ref-line stdin,
// a real chained hook — the same way test/hooks.test.js exercises the commit
// hook rather than only asserting on its command string.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildPrePushHookScript,
  planPrePushInstall,
  CLUD_BUG_PREPUSH_MARKER,
  PREPUSH_CHAINED_FILE,
} from '../src/cli/hooks.js';

const PREPUSH = buildPrePushHookScript();
/** git's "this ref does not exist on the other side" sentinel. */
const ZERO = '0000000000000000000000000000000000000000';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-prepush-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

/** A real origin + a clone of it, so `refs/remotes/origin/HEAD` resolves and
 * the default-branch config read (§6.7) has something real to read. */
async function makeClonePair(cludBugJson) {
  const origin = await makeRepo();
  if (cludBugJson !== undefined) {
    await mkdir(join(origin, '.claude', 'skills'), { recursive: true });
    await writeFile(join(origin, '.claude', 'skills', '.clud-bug.json'), JSON.stringify(cludBugJson));
    git(origin, ['add', '.claude']);
    git(origin, ['commit', '-q', '-m', 'declare tests']);
  }
  const clone = join(origin, '..', `${origin.split('/').pop()}-clone`);
  git(origin, ['clone', '-q', origin, clone]);
  git(clone, ['config', 'user.email', 'test@test']);
  git(clone, ['config', 'user.name', 'Test']);
  git(clone, ['config', 'commit.gpgsign', 'false']);
  return { origin, clone };
}

/** Invoke the script the way git does: an executable file, argv = <remote>
 * <url>, and one `<local ref> <local oid> <remote ref> <remote oid>` line per
 * pushed ref on stdin. */
async function runPrePush(cwd, refLines, script = PREPUSH) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-prepush-run-'));
  const path = join(dir, 'pre-push');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return spawnSync(path, ['origin', 'file:///origin'], {
    cwd,
    encoding: 'utf8',
    input: refLines.length ? refLines.join('\n') + '\n' : '',
  });
}

describe('buildPrePushHookScript', () => {
  it('is valid POSIX sh', () => {
    const r = spawnSync('sh', ['-n'], { input: PREPUSH, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('carries the marker and runs review-prompt at the PUSH trigger, floating to @next', () => {
    expect(PREPUSH).toContain(CLUD_BUG_PREPUSH_MARKER);
    expect(PREPUSH).toMatch(/npx clud-bug@next review-prompt --trigger push/);
    // The pin is overridable for a repo that wants a frozen exact version,
    // exactly like buildCommitReviewCommand.
    expect(buildPrePushHookScript('0.7.0-rc.99')).toMatch(/npx clud-bug@0\.7\.0-rc\.99 review-prompt/);
  });

  it('§6.7: reads the tests declaration from the DEFAULT BRANCH, never the working tree', () => {
    // "The declaration is read from the default branch, never the working
    // tree" — so `git show <baseref>:<path>`, never a filesystem read.
    expect(PREPUSH).toContain('git show "$baseref:.claude/skills/.clud-bug.json"');
    expect(PREPUSH).toContain('git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD"');
    expect(PREPUSH).not.toMatch(/cat ["']?\.claude\/skills/);
    // …and parses it with a real parser, not shell string-munging.
    expect(PREPUSH).toMatch(/node -e .*JSON\.parse/);
  });

  it('§6.7: the mechanical check runs BEFORE the model, and is the only blocking path', () => {
    const testBlock = PREPUSH.indexOf('PUSH BLOCKED');
    const modelStep = PREPUSH.indexOf('review-prompt --trigger push');
    expect(testBlock).toBeGreaterThan(-1);
    expect(modelStep).toBeGreaterThan(-1);
    expect(testBlock).toBeLessThan(modelStep); // "order is fixed"
    // §4.1 — "the local review is advisory and MUST NOT block the command that
    // triggered it": the model half always ends in exit 0.
    expect(PREPUSH.trimEnd().endsWith('exit 0')).toBe(true);
  });

  it('does NO network I/O — a synchronous git hook must not be able to hang a push', () => {
    expect(PREPUSH).not.toMatch(/curl|wget/);
    // `npx` appears exactly once, inside the quoted directive the agent runs —
    // the hook itself never executes it. (The commit hook can afford the
    // round-trip because Claude Code runs it `async: true`; git offers no
    // equivalent, so a hung registry call would stall the push.)
    expect(PREPUSH.match(/npx /g)).toHaveLength(1);
    expect(PREPUSH).toMatch(/cmd="npx clud-bug@next review-prompt/);
  });
});

describe('planPrePushInstall', () => {
  it('writes when nothing is installed', () => {
    const p = planPrePushInstall({ script: PREPUSH });
    expect(p.action).toBe('write');
    expect(p.content).toBe(PREPUSH);
  });

  it('refreshes OUR hook in place — idempotent re-install, never a duplicate', () => {
    const p = planPrePushInstall({ existing: PREPUSH, script: PREPUSH });
    expect(p.action).toBe('refresh');
    expect(p.content).toBe(PREPUSH);
    expect(p.moveExistingTo).toBeUndefined();
  });

  it('§6.7: chains a FOREIGN hook rather than clobbering it', () => {
    const p = planPrePushInstall({ existing: '#!/bin/sh\nmake lint\n', script: PREPUSH });
    expect(p.action).toBe('chain');
    expect(p.moveExistingTo).toBe(PREPUSH_CHAINED_FILE);
    expect(p.content).toBe(PREPUSH);
  });

  it('refuses rather than destroy a second user hook', () => {
    const p = planPrePushInstall({
      existing: '#!/bin/sh\nmake lint\n',
      chainedExists: true,
      script: PREPUSH,
    });
    expect(p.action).toBe('skip');
    expect(p.content).toBeUndefined();
  });

  it('treats a whitespace-only hook as absent', () => {
    expect(planPrePushInstall({ existing: '   \n', script: PREPUSH }).action).toBe('write');
  });
});

describe('pre-push hook — integration (real git state)', () => {
  it('a NEW branch (all-zero remote oid) still computes a range, not the whole history', async () => {
    const { clone } = await makeClonePair();
    git(clone, ['checkout', '-q', '-b', 'feature']);
    await writeFile(join(clone, 'a.txt'), 'a');
    git(clone, ['add', 'a.txt']);
    git(clone, ['commit', '-q', '-m', 'feat: a']);
    const head = git(clone, ['rev-parse', 'HEAD']);
    const base = git(clone, ['rev-parse', 'HEAD^']);

    const r = await runPrePush(clone, [`refs/heads/feature ${head} refs/heads/feature ${ZERO}`]);
    expect(r.status).toBe(0); // §4.1 — the review never blocks
    expect(r.stderr).toContain(`--range ${base}..${head}`);
  });

  it('a fast-forward push reviews exactly remote..local — ONE range, not one review per commit', async () => {
    const { clone } = await makeClonePair();
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    for (const n of ['1', '2', '3']) {
      await writeFile(join(clone, `f${n}.txt`), n);
      git(clone, ['add', `f${n}.txt`]);
      git(clone, ['commit', '-q', '-m', `feat: ${n}`]);
    }
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    // One range spanning all three commits — no per-commit fan-out. §4.1's own
    // reason for preferring push: "a commit often catches work half-done and
    // reports defects the next commit was going to fix anyway".
    expect(r.stderr).toContain(`--range ${remoteOid}..${head}`);
    expect(r.stderr.match(/--range /g)).toHaveLength(1);
  });

  it('a branch DELETION has no diff in existence to review, and says so', async () => {
    const { clone } = await makeClonePair();
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    const r = await runPrePush(clone, [`(delete) ${ZERO} refs/heads/gone ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/nothing to review/i);
    expect(r.stderr).not.toMatch(/review-prompt/);
  });

  it('§6.7: a DECLARED test command that fails BLOCKS the push, and the model does not run', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'exit 3' });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await writeFile(join(clone, 'x.txt'), 'x');
    git(clone, ['add', 'x.txt']);
    git(clone, ['commit', '-q', '-m', 'feat: x']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1); // the ONLY blocking path in the whole script
    expect(r.stderr).toMatch(/PUSH BLOCKED/);
    expect(r.stderr).toMatch(/exited 3/);
    // "the model only runs if it passes" — nothing was surfaced for review.
    expect(r.stderr).not.toMatch(/review-prompt --trigger push/);
  });

  it('§6.7: a DECLARED test command that passes lets the push through, then surfaces the review', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await writeFile(join(clone, 'y.txt'), 'y');
    git(clone, ['add', 'y.txt']);
    git(clone, ['commit', '-q', '-m', 'feat: y']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/mechanical check/);
    expect(r.stderr).toMatch(/review-prompt --trigger push/);
  });

  it('§6.7: the declaration is read from the DEFAULT BRANCH — a working-tree edit changes nothing', async () => {
    // origin/main declares a PASSING command; the working tree tries to swap in
    // a failing one. §6.7: "An agent may edit the local config freely and it
    // changes nothing until merged, which needs a review."
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
    await writeFile(
      join(clone, '.claude', 'skills', '.clud-bug.json'),
      JSON.stringify({ version: 1, installed: [], tests: 'exit 9' }),
    );
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: local edit only']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0); // the working tree's `exit 9` was NOT honoured
    expect(r.stderr).toContain('mechanical check (6.7 — tests before review): true');
    expect(r.stderr).not.toMatch(/exit 9/);
  });

  it('§6.7: `"tests": "none"` runs no mechanical check but still surfaces the review', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'none' });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: z']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/declares "tests": "none"/);
    expect(r.stderr).toMatch(/review-prompt --trigger push/);
  });

  it('§6.5: no declaration → allows, but REPORTS that the gate could not run (never a silent green)', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: q']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no "tests" declaration/);
    expect(r.stderr).toMatch(/review-prompt --trigger push/);
  });

  it('§6.7: an unresolvable default branch ALLOWS the push and says so (a broken gate never wedges it)', async () => {
    // No remote at all: no origin/HEAD, no origin/main — the config for the
    // mechanical check is unresolvable. "An engine that is missing, stale, or
    // cannot resolve its configuration allows."
    const repo = await makeRepo();
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'second']);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const base = git(repo, ['rev-parse', 'HEAD^']);

    const r = await runPrePush(repo, [`refs/heads/main ${head} refs/heads/main ${base}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no default-branch ref/);
    expect(r.stderr).toMatch(/review-prompt --trigger push/);
  });

  it('§6.7 ownership: a chained foreign hook runs FIRST, with git ref lines replayed on its stdin', async () => {
    const { clone } = await makeClonePair();
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: chained']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const hooksDir = join(clone, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const chainedPath = join(hooksDir, PREPUSH_CHAINED_FILE);
    // Echoes its argv and whatever stdin it received, so this proves the ref
    // lines were REPLAYED rather than swallowed by our own `cat` — a chained
    // hook that gets empty stdin is silently broken, which is the whole risk.
    await writeFile(chainedPath, '#!/bin/sh\necho "CHAINED argv=$*"\ncat\nexit 0\n');
    await chmod(chainedPath, 0o755);

    const refLine = `refs/heads/main ${head} refs/heads/main ${remoteOid}`;
    const r = await runPrePush(clone, [refLine]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('CHAINED argv=origin file:///origin');
    expect(r.stdout).toContain(refLine);
    expect(r.stderr).toMatch(/review-prompt --trigger push/);
  });

  it('§6.7 ownership: a chained hook that blocks blocks the push, and our review never runs', async () => {
    const { clone } = await makeClonePair();
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: blocked']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const hooksDir = join(clone, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const chainedPath = join(hooksDir, PREPUSH_CHAINED_FILE);
    await writeFile(chainedPath, '#!/bin/sh\nexit 7\n');
    await chmod(chainedPath, 0o755);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(7); // the other tool's verdict is honoured verbatim
    expect(r.stderr).toMatch(/blocked by the pre-push hook clud-bug chained to/);
    expect(r.stderr).not.toMatch(/review-prompt --trigger push/);
  });

  it('multiple refs in one push are reported, not silently reduced to one', async () => {
    const { clone } = await makeClonePair();
    const mainRemote = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'main moves']);
    const mainHead = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['checkout', '-q', '-b', 'other']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'other moves']);
    const otherHead = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [
      `refs/heads/main ${mainHead} refs/heads/main ${mainRemote}`,
      `refs/heads/other ${otherHead} refs/heads/other ${mainHead}`,
    ]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/2 refs were pushed/);
  });

  it('a real `git push` actually fires the installed hook (end to end, not simulated stdin)', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'exit 5' });
    const hooksDir = join(clone, '.git', 'hooks');
    await mkdir(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, 'pre-push');
    await writeFile(hookPath, PREPUSH);
    await chmod(hookPath, 0o755);

    git(clone, ['checkout', '-q', '-b', 'e2e']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: e2e']);

    const push = spawnSync('git', ['push', '-q', 'origin', 'e2e'], { cwd: clone, encoding: 'utf8' });
    // The declared command fails, so the real push is really refused.
    expect(push.status).not.toBe(0);
    expect(push.stderr).toMatch(/PUSH BLOCKED/);
  });
});
