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
  resolveTestsDeclaration,
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
 * pushed ref on stdin. `envOverrides` merges on top of the ambient
 * `process.env` — used by the #319 node-infra-failure tests below to put a
 * broken `node` shim earlier on PATH without touching this machine's real one. */
async function runPrePush(cwd, refLines, script = PREPUSH, envOverrides) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-prepush-run-'));
  const path = join(dir, 'pre-push');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return spawnSync(path, ['origin', 'file:///origin'], {
    cwd,
    encoding: 'utf8',
    input: refLines.length ? refLines.join('\n') + '\n' : '',
    env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
  });
}

/** A fake `node` on PATH that always fails — stands in for BOTH "missing"
 * (command not found, would exit 127 with no shim at all) and "broken"
 * (a corrupted install, any non-zero exit): the #319 fix checks the exit
 * status of the `node` invocation, not what kind of failure produced it. */
async function installBrokenNode() {
  const binDir = await mkdtemp(join(tmpdir(), 'clud-bug-brokennode-'));
  const nodePath = join(binDir, 'node');
  await writeFile(nodePath, '#!/bin/sh\nexit 1\n');
  await chmod(nodePath, 0o755);
  return binDir;
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
    // #319: a passing declaration keeps this test focused on range
    // computation — an undeclared repo now BLOCKS (see the declaration-matrix
    // block below), which is a different concern from this test's.
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
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
    // #319: declared + passing, for the same reason as the test above.
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
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

  // #319: this used to allow-and-warn (the OLD screenshot of a deliberately
  // incomplete §6.7). The table's "nothing declared" row BLOCKS regardless of
  // suite detection — the yes/no split only changes which reason is printed.
  // This fixture has no test files, so it exercises the "no" side.
  it('§6.7 (#319): NO declaration and NO detected suite still BLOCKS the push — "nothing" always blocks', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: q']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1); // a revert to the old allow-and-warn behavior must fail this
    expect(r.stderr).toMatch(/PUSH BLOCKED/);
    expect(r.stderr).toMatch(/no "tests" declaration/);
    expect(r.stderr).not.toMatch(/review-prompt --trigger push/); // model never runs
  });

  it('§6.7 (#319): a repo WITH test files and NO declaration BLOCKS with the "has tests" reason', async () => {
    const origin = (await makeClonePair({ version: 1, installed: [] })).origin;
    await mkdir(join(origin, 'src', '__tests__'), { recursive: true });
    await writeFile(join(origin, 'src', '__tests__', 'foo.test.js'), 'test();');
    git(origin, ['add', 'src']);
    git(origin, ['commit', '-q', '-m', 'add a test file']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: r']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PUSH BLOCKED/);
    expect(r.stderr).toMatch(/has test files but no "tests" declaration/);
  });

  it('§6.7 (#319): a package.json test script alone (no matching filenames) is ALSO detected as a suite', async () => {
    // Signal 2 (PKG_TEST_SCRIPT_PARSER), independent of signal 1 (filenames):
    // a repo whose only test file is named something the pattern would never
    // match, but whose package.json declares a REAL (non-placeholder) test
    // script, must still be treated as having a suite.
    const origin = (await makeClonePair({ version: 1, installed: [] })).origin;
    await writeFile(join(origin, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest --ci' } }));
    git(origin, ['add', 'package.json']);
    git(origin, ['commit', '-q', '-m', 'add package.json']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: s']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/has test files but no "tests" declaration/);
  });

  it('§6.7 (#319): the npm-init PLACEHOLDER test script does not count as a suite', async () => {
    const origin = (await makeClonePair({ version: 1, installed: [] })).origin;
    await writeFile(
      join(origin, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    git(origin, ['add', 'package.json']);
    git(origin, ['commit', '-q', '-m', 'npm init default']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: t']);
    const head = git(clone, ['rev-parse', 'HEAD']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD^']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1); // still blocks (nothing declared) …
    // … but with the GENERIC reason, not the "has tests" one — the
    // placeholder must not register as a detected suite.
    expect(r.stderr).not.toMatch(/has test files but no "tests" declaration/);
    expect(r.stderr).toMatch(/PUSH BLOCKED — .*has no "tests" declaration/);
  });

  it('§6.7 (#319): "tests": "none" declared against a repo WITH test files BLOCKS — the declaration contradicts the repo', async () => {
    const origin = (await makeClonePair({ version: 1, installed: [], tests: 'none' })).origin;
    await mkdir(join(origin, 'tests'), { recursive: true });
    await writeFile(join(origin, 'tests', 'foo_test.py'), 'def test_x(): pass');
    git(origin, ['add', 'tests', '.claude']);
    git(origin, ['commit', '-q', '-m', 'add a test file after declaring none']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: u']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PUSH BLOCKED/);
    expect(r.stderr).toMatch(/declares "tests": "none" but has test files/);
    expect(r.stderr).not.toMatch(/review-prompt --trigger push/);
  });

  it('§6.7 (#319): a DECLARED command still runs regardless of suite detection (detection never overrides a real declaration)', async () => {
    const origin = (await makeClonePair({ version: 1, installed: [], tests: 'true' })).origin;
    await mkdir(join(origin, 'tests'), { recursive: true });
    await writeFile(join(origin, 'tests', 'foo_test.py'), 'def test_x(): pass');
    git(origin, ['add', 'tests']);
    git(origin, ['commit', '-q', '-m', 'add a test file']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: v']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/mechanical check \(6\.7 — tests before review\): true/);
    expect(r.stderr).toMatch(/review-prompt --trigger push/);
  });

  it('§6.7 (#319): a filename merely CONTAINING "test" (e.g. "latest.txt") is not a false-positive suite match', async () => {
    const origin = (await makeClonePair({ version: 1, installed: [], tests: 'none' })).origin;
    await writeFile(join(origin, 'latest.txt'), 'not a test');
    await mkdir(join(origin, 'contest'), { recursive: true });
    await writeFile(join(origin, 'contest', 'results.txt'), 'not a test dir either');
    git(origin, ['add', 'latest.txt', 'contest']);
    git(origin, ['commit', '-q', '-m', 'files that merely contain "test" as a substring']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: w']);
    const head = git(clone, ['rev-parse', 'HEAD']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD^']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0); // "none" against a falsely-detected suite would have blocked
    expect(r.stderr).toMatch(/declares "tests": "none" — no mechanical check to run/);
  });

  it('§6.7 (#319) bootstrap exemption: a push whose ONLY change adds the missing declaration is allowed', async () => {
    // "A push whose only change is adding that declaration MUST be allowed,
    // or the config that unblocks pushing can never itself be pushed." The
    // base ref still declares NOTHING — that is the whole point: this exact
    // push is what would fix it, and must not be judged by the state it
    // corrects.
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await writeFile(
      join(clone, '.claude', 'skills', '.clud-bug.json'),
      JSON.stringify({ version: 1, installed: [], tests: 'true' }),
    );
    git(clone, ['add', '.claude']);
    git(clone, ['commit', '-q', '-m', 'declare tests (the fix-push)']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/this push only changes clud-bug local-gate config/);
  });

  it('§6.7 (#319) bootstrap exemption: a push that ALSO changes other files does not qualify — the old block still applies', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await writeFile(
      join(clone, '.claude', 'skills', '.clud-bug.json'),
      JSON.stringify({ version: 1, installed: [], tests: 'true' }),
    );
    await writeFile(join(clone, 'feature.txt'), 'unrelated change');
    git(clone, ['add', '.claude', 'feature.txt']);
    git(clone, ['commit', '-q', '-m', 'declare tests AND ship a feature in the same push']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    // Judged by the OLD base-ref state (nothing declared) — exemption does
    // not apply because the diff is not JUST clud-bug's own local-gate
    // config. This is read from the base ref (§6.3), so the new "true" the
    // working tree added has no effect on THIS push's own verdict.
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PUSH BLOCKED/);
  });

  // MINOR (#321 panel) — the exemption as first shipped only recognized a
  // diff touching EXACTLY `.claude/skills/.clud-bug.json`. A real bootstrap
  // run of `clud-bug init --hook-trigger both --commit` (or `update`, moving
  // a repo onto the push trigger for the first time) writes the declaration
  // AND merges the commit-review hook into `.claude/settings.json` in the
  // SAME commit — the narrower check never fired for that push, wedging
  // exactly the scenario §6.7's exemption exists for. Widened to a fixed
  // two-file allowlist (both owned exclusively by clud-bug's own install
  // tooling, never user content) rather than to `.claude/` broadly, so the
  // test right above (an unrelated `feature.txt` riding along) still blocks.
  it('§6.7 (#319/#321) bootstrap exemption: widened to ALSO cover .claude/settings.json (the hook-install file init writes in the same bootstrap commit)', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await writeFile(
      join(clone, '.claude', 'skills', '.clud-bug.json'),
      JSON.stringify({ version: 1, installed: [], tests: 'true' }),
    );
    await mkdir(join(clone, '.claude'), { recursive: true });
    await writeFile(join(clone, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    git(clone, ['add', '.claude']);
    git(clone, ['commit', '-q', '-m', 'bootstrap: declare tests AND install the commit-review hook']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0); // a revert to the exact-match check must fail this
    expect(r.stderr).toMatch(/this push only changes clud-bug local-gate config/);
  });

  it('§6.7 (#319/#321) bootstrap exemption: .claude/settings.json ALONE (no declaration change) also qualifies', async () => {
    // Generalizing to an allowlist (not just "exactly the declaration file")
    // must hold for any subset of it, not only the one pairing named above.
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await mkdir(join(clone, '.claude'), { recursive: true });
    await writeFile(join(clone, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    git(clone, ['add', '.claude']);
    git(clone, ['commit', '-q', '-m', 'install the commit-review hook only']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/this push only changes clud-bug local-gate config/);
  });

  it('§6.7 (#319/#321) bootstrap exemption: settings.json PLUS an unrelated file still does not qualify', async () => {
    const { clone } = await makeClonePair({ version: 1, installed: [] });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    await mkdir(join(clone, '.claude'), { recursive: true });
    await writeFile(join(clone, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
    await writeFile(join(clone, 'feature.txt'), 'unrelated change');
    git(clone, ['add', '.claude', 'feature.txt']);
    git(clone, ['commit', '-q', '-m', 'install the hook AND ship a feature in the same push']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PUSH BLOCKED/);
  });

  // CRITICAL (#321 panel, both lenses) — a broken/unavailable "node" during
  // the declaration or detection read is an INFRA failure, never a
  // repo-config state. Before the fix, node failing here left `testdecl`
  // empty exactly like a genuinely undeclared repo, and the verdict step
  // blocked on "nothing declared" — a broken toolchain wedging a push, which
  // 6.7 forbids outright: "A broken binary MUST NOT be able to wedge a push."
  it('§6.7 (#319/#321) CRITICAL: a broken "node" during the DECLARATION read fails OPEN, not "nothing declared"', async () => {
    // A real declaration exists on the base ref — if the fix regresses to
    // treating a node failure as an empty read, this looks exactly like the
    // "nothing declared" row and blocks.
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: node-broken-decl']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const brokenNodeDir = await installBrokenNode();
    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`], PREPUSH, {
      PATH: `${brokenNodeDir}:${process.env.PATH}`,
    });

    expect(r.status).toBe(0); // MUST NOT block — this is the tool breaking, not the repo
    expect(r.stderr).toMatch(/could not read the "tests" declaration/);
    expect(r.stderr).toMatch(/node/);
    expect(r.stderr).not.toMatch(/PUSH BLOCKED/);
    expect(r.stderr).toMatch(/review-prompt --trigger push/); // the model half still runs (4.1: advisory)
  });

  it('§6.7 (#319/#321) CRITICAL: a broken "node" during SUITE DETECTION (package.json parse) also fails OPEN — not just the declaration read', async () => {
    // No .clud-bug.json at all, so the DECLARATION-read node call never even
    // fires — only the SECOND node invocation (package.json's test script,
    // for suite detection) hits the broken binary. Pins that the fix covers
    // BOTH node call sites, not only the one the declaration read uses.
    const origin = (await makeClonePair()).origin;
    await writeFile(join(origin, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest --ci' } }));
    git(origin, ['add', 'package.json']);
    git(origin, ['commit', '-q', '-m', 'add package.json']);
    const clone = join(origin, '..', `${origin.split('/').pop()}-clone2`);
    git(origin, ['clone', '-q', origin, clone]);
    git(clone, ['config', 'user.email', 'test@test']);
    git(clone, ['config', 'user.name', 'Test']);
    git(clone, ['config', 'commit.gpgsign', 'false']);
    const remoteOid = git(clone, ['rev-parse', 'HEAD']);
    git(clone, ['commit', '-q', '--allow-empty', '-m', 'feat: node-broken-detect']);
    const head = git(clone, ['rev-parse', 'HEAD']);

    const brokenNodeDir = await installBrokenNode();
    const r = await runPrePush(clone, [`refs/heads/main ${head} refs/heads/main ${remoteOid}`], PREPUSH, {
      PATH: `${brokenNodeDir}:${process.env.PATH}`,
    });

    expect(r.status).toBe(0); // MUST NOT block on a real (but undetectable) suite
    expect(r.stderr).toMatch(/could not read the "tests" declaration/);
    expect(r.stderr).not.toMatch(/PUSH BLOCKED/);
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
    // #319: declared + passing — this test is about chaining order, not the
    // declaration matrix.
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
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
    // #319: declared + passing — this test is about multi-ref reporting, not
    // the declaration matrix.
    const { clone } = await makeClonePair({ version: 1, installed: [], tests: 'true' });
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

describe('resolveTestsDeclaration (#319 — §6.7 "Setup MUST ask, and MUST NOT complete without an answer")', () => {
  // `ask` is a plain injected function — no real stdin anywhere in this
  // block, matching this file's own `runInitBranchProtection`-style seam.
  const askReturning = (answer) => async () => answer;

  it('ALWAYS returns a value in the interactive path — a blank answer accepts the shown default, it never skips', async () => {
    const withDetection = await resolveTestsDeclaration({ acceptAll: false, detected: 'npm test', ask: askReturning('') });
    expect(withDetection).toEqual({ value: 'npm test', source: 'user-accepted-default' });

    const withoutDetection = await resolveTestsDeclaration({ acceptAll: false, detected: null, ask: askReturning('') });
    expect(withoutDetection).toEqual({ value: 'none', source: 'user-accepted-default' });
  });

  it('a typed answer wins over the detected suggestion', async () => {
    const r = await resolveTestsDeclaration({ acceptAll: false, detected: 'npm test', ask: askReturning('  make test  ') });
    // Trimmed, and the user's own words — the suggestion is a default, not a floor.
    expect(r).toEqual({ value: 'make test', source: 'user-entered' });
  });

  it('a typed "none" is honoured verbatim (not specially re-labeled)', async () => {
    const r = await resolveTestsDeclaration({ acceptAll: false, detected: 'npm test', ask: askReturning('none') });
    expect(r).toEqual({ value: 'none', source: 'user-entered' });
  });

  it('--accept-all with a detected command accepts it automatically, without asking', async () => {
    let asked = false;
    const ask = async () => { asked = true; return ''; };
    const r = await resolveTestsDeclaration({ acceptAll: true, detected: 'npm test', ask });
    expect(r).toEqual({ value: 'npm test', source: 'accept-all-detected' });
    expect(asked).toBe(false); // --accept-all never prompts
  });

  // CRITICAL (#321 panel) — this used to return `value: null` here and the
  // caller (`main.ts`) skipped the manifest write entirely, so a freshly
  // `init --accept-all`-ed repo with nothing detected reached its first push
  // with NO declaration — which the pre-push hook this same run installs
  // then BLOCKS ("nothing declared" always blocks). A non-interactive setup
  // trapping its own very next push is exactly what §6.7's "MUST NOT complete
  // without an answer" forbids. §6.7's table makes "no suite detected" +
  // "none" declared a PASS, so "none" here is the honest value these local
  // detectors actually support — not a guess "accept-all-detected" already
  // wasn't making for a REAL command.
  it('--accept-all with NOTHING detected declares "none" (the honest value for "no suite detected"), never leaves it unset', async () => {
    const r = await resolveTestsDeclaration({ acceptAll: true, detected: null, ask: askReturning('') });
    expect(r).toEqual({ value: 'none', source: 'accept-all-undeclared' });
  });
});
