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
  // CI root-cause fix (#321 follow-up): repo-LOCAL identity, matching the
  // makeRepo() helper in hooks.test.js / pre-push-hook.test.js. runInit()
  // below spawns `clud-bug init` with HOME redirected to `dir` (isolating it
  // from this machine's real ~/.gitconfig), so `git commit` inside init's
  // --commit step had no configured identity to fall back on anywhere except
  // git's own OS-level auto-detect from username+hostname — which silently
  // SUCCEEDS on macOS (a printed advisory, commit still made) but FAILS HARD
  // on a fresh Ubuntu Actions runner ("unable to auto-detect email address").
  // main.ts's --commit step never checked git commit's exit status (fixed
  // separately in main.ts), so the CLI reported success while `dir` was left
  // with ZERO commits — an unborn `main`. The two e2e tests below then clone
  // that empty repo and expect a resolvable default branch; git itself can't
  // give them one ("warning: You appear to have cloned an empty repository"),
  // so the pre-push hook's own honest "no default-branch ref" fail-open
  // fired instead of the declared-tests output they assert on — CI-only,
  // because only CI's git lacks the auto-detect fallback macOS has. Repo-
  // local config is read regardless of $HOME, so this removes the dependency
  // on host git's identity auto-detection entirely, on every platform.
  spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
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

// CI root-cause fix (#321 follow-up) — main.ts's --commit step used to run
// `git add`/`git commit` via spawnSync without ever checking their exit
// status, so a failed commit (the CI failure investigated above: no git
// identity reachable) was silently swallowed — init reported success while
// nothing was committed. A pre-commit hook that always refuses is a
// deterministic, platform-independent way to force `git commit` to fail —
// orthogonal to the identity/auto-detect variance that made the ORIGINAL
// failure mode CI-only and hard to reproduce locally.
test('init --commit warns (never silently succeeds) when git commit itself fails', async () => {
  const dir = await makeRepoDir('clud-bug-tests-commitfail-');
  const hooksDir = join(dir, '.git', 'hooks');
  await mkdir(hooksDir, { recursive: true });
  await writeFile(join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 1\n');
  await chmod(join(hooksDir, 'pre-commit'), 0o755);

  const r = runInit(dir, ['--commit']);
  // The optional --commit step failing must not abort init itself — the
  // scaffolding above it is already written and useful on its own.
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /git commit failed/);
  assert.match(r.stderr, /nothing was committed/);

  // The manifest was still written even though the commit step failed...
  const manifest = await readManifest(dir);
  assert.equal(manifest.tests, 'none');
  // ...but nothing was actually committed — init did NOT silently claim
  // success. A revert of the exit-status check makes this assertion fail:
  // the old code left the same warn()-less silence this whole test exists
  // to catch, so `git log` here would need to explicitly re-detect the
  // absence some other way — this is the direct, positive check instead.
  const log = spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(log.status, 0, 'expected an unborn (commit-less) repo — the failed commit must not be silently treated as done');
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
