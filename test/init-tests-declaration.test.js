// #319 — SPEC 2.0 §6.7: "A repository states whether it has a test suite and
// how to run it. Setup MUST ask, and MUST NOT complete without an answer."
//
// These exercise `clud-bug init`'s side of the declaration matrix through the
// real CLI (spawned, `--accept-all` — the only path testable without piping
// real stdin; the interactive branch is covered directly, with an injected
// `ask`, in `resolveTestsDeclaration`'s own tests in pre-push-hook.test.js).

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function runInit(dir, extraArgs) {
  return spawnSync(
    process.execPath,
    [CLI, 'init', '--offline', '--accept-all', '--no-set-protection', ...extraArgs],
    {
      cwd: dir,
      env: { ...process.env, HOME: dir, CLUD_BUG_QUIET: '1' },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
}

async function makeRepoDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

async function readManifest(dir) {
  return JSON.parse(await readFile(join(dir, '.claude', 'skills', '.clud-bug.json'), 'utf8'));
}

test('init --accept-all auto-declares a detected package.json test script', async () => {
  const dir = await makeRepoDir('clud-bug-tests-detect-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }));
  const r = runInit(dir, []); // push is the default trigger — wantsPrePushHook
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  assert.equal(manifest.tests, 'vitest run');
  // Not asserting on r.stdout here: the announcing log() line is a `log()`
  // call, suppressed under this test harness's CLUD_BUG_QUIET=1 — the
  // manifest value above is the real, always-observable behavior.
});

// CRITICAL (#321 panel) — this used to leave "tests" UNSET here, which
// wedged the very next push: the pre-push hook this same init run installs
// BLOCKS on "nothing declared" regardless of suite detection. A
// non-interactive `--accept-all` run that reaches its own first push already
// trapped is exactly what §6.7's "MUST NOT complete without an answer"
// forbids. §6.7's table makes "no suite detected" + "none" declared a PASS,
// so "none" is the honest value nothing-detected supports — not a guess.
test('init --accept-all with NOTHING detected declares "tests": "none" — never leaves the config in a state its own hook rejects', async () => {
  const dir = await makeRepoDir('clud-bug-tests-nodetect-');
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  assert.equal(manifest.tests, 'none');
  assert.match(r.stderr, /No test suite auto-detected/);
  assert.match(r.stderr, /declared "tests": "none"/);
});

test('init ignores the npm-init placeholder test script — same as no script at all (declares "none", not unset)', async () => {
  const dir = await makeRepoDir('clud-bug-tests-placeholder-');
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
  );
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  assert.equal(manifest.tests, 'none');
  assert.match(r.stderr, /No test suite auto-detected/);
});

test('init --no-hooks never asks — there is no mechanical gate to declare for', async () => {
  const dir = await makeRepoDir('clud-bug-tests-nohooks-');
  const r = runInit(dir, ['--no-hooks']);
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  assert.equal(manifest.tests, undefined);
  assert.doesNotMatch(r.stderr, /BLOCKS a push with no declaration/);
  assert.doesNotMatch(r.stdout, /tests declaration/);
});

test('init --hook-trigger commit (no pre-push surface) never asks either — same reason', async () => {
  const dir = await makeRepoDir('clud-bug-tests-committrigger-');
  const r = runInit(dir, ['--hook-trigger', 'commit']);
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  assert.equal(manifest.tests, undefined);
  assert.doesNotMatch(r.stderr, /BLOCKS a push with no declaration/);
});

test('a SECOND init never re-asks once "tests" is already declared — idempotent, not nagging', async () => {
  const dir = await makeRepoDir('clud-bug-tests-idem-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }));
  assert.equal(runInit(dir, []).status, 0);
  assert.equal((await readManifest(dir)).tests, 'vitest run');

  // Second run: change package.json's script — if init re-asked, this would
  // silently overwrite the user's own (possibly hand-edited) declaration.
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'jest' } }));
  const r2 = runInit(dir, []);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal((await readManifest(dir)).tests, 'vitest run', 're-init must not silently overwrite an existing declaration');
});

test('the pre-push hook installed by this same init run actually reads the declaration it just wrote', async () => {
  // End-to-end: init detects+declares, and the hook it installs in the SAME
  // run honours that declaration once merged to the default branch (§6.3 —
  // reads the base ref, so it must be committed, not just written).
  const dir = await makeRepoDir('clud-bug-tests-e2e-');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'exit 0' } }));
  const r = runInit(dir, ['--commit']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((await readManifest(dir)).tests, 'exit 0');

  const clonePath = join(dirname(dir), `${dir.split('/').pop()}-clone`);
  const cloneResult = spawnSync('git', ['clone', '-q', dir, clonePath], { encoding: 'utf8' });
  assert.equal(cloneResult.status, 0, cloneResult.stderr);
  spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: clonePath });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: clonePath });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: clonePath });
  // A NEW branch, not `main` — pushing the currently-checked-out branch of a
  // non-bare repo is refused by git itself (denyCurrentBranch), unrelated to
  // anything under test here. Matches pre-push-hook.test.js's own e2e test.
  spawnSync('git', ['checkout', '-q', '-b', 'e2e'], { cwd: clonePath });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'feat: e2e'], { cwd: clonePath });

  const hookPath = join(dir, '.git', 'hooks', 'pre-push');
  const hookBody = await readFile(hookPath, 'utf8');
  assert.match(hookBody, /clud-bug-pre-push-review/);

  const installedHook = join(clonePath, '.git', 'hooks', 'pre-push');
  await mkdir(join(clonePath, '.git', 'hooks'), { recursive: true });
  await writeFile(installedHook, hookBody);
  await chmod(installedHook, 0o755);

  const push = spawnSync('git', ['push', '-q', 'origin', 'e2e'], { cwd: clonePath, encoding: 'utf8' });
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stderr, /mechanical check \(6\.7 — tests before review\): exit 0/);
});

// CRITICAL (#321 panel) — end-to-end pin for the actual user-visible bug:
// before the fix, `init --accept-all` with nothing detected left "tests"
// UNSET, and the pre-push hook this exact run installs then BLOCKED the very
// next push ("nothing declared" always blocks, regardless of what — if
// anything — was detected). A revert of the hooks.ts/main.ts fix reproduces
// that: this push goes from allowed back to BLOCKED.
test('the pre-push hook installed by a --accept-all init with NOTHING detected does NOT block the first push', async () => {
  const dir = await makeRepoDir('clud-bug-tests-e2e-nodetect-');
  const r = runInit(dir, ['--commit']); // no package.json — nothing to detect
  assert.equal(r.status, 0, r.stderr);
  assert.equal((await readManifest(dir)).tests, 'none');

  const clonePath = join(dirname(dir), `${dir.split('/').pop()}-clone`);
  const cloneResult = spawnSync('git', ['clone', '-q', dir, clonePath], { encoding: 'utf8' });
  assert.equal(cloneResult.status, 0, cloneResult.stderr);
  spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: clonePath });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: clonePath });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: clonePath });
  spawnSync('git', ['checkout', '-q', '-b', 'e2e'], { cwd: clonePath });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'feat: e2e'], { cwd: clonePath });

  const hookPath = join(dir, '.git', 'hooks', 'pre-push');
  const hookBody = await readFile(hookPath, 'utf8');
  const installedHook = join(clonePath, '.git', 'hooks', 'pre-push');
  await mkdir(join(clonePath, '.git', 'hooks'), { recursive: true });
  await writeFile(installedHook, hookBody);
  await chmod(installedHook, 0o755);

  const push = spawnSync('git', ['push', '-q', 'origin', 'e2e'], { cwd: clonePath, encoding: 'utf8' });
  assert.equal(push.status, 0, push.stderr); // a revert to the old "leave unset" behavior blocks this
  assert.doesNotMatch(push.stderr, /PUSH BLOCKED/);
  assert.match(push.stderr, /declares "tests": "none" — no mechanical check to run/);
});
