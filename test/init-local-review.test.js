// Wave 6b — `clud-bug init --with-local-review` scaffolds the local-mode
// /clud-bug-review slash command at .claude/commands/clud-bug-review.md.
//
// #276 — `init --with-hooks` now installs the PRE-PUSH surface by default.
// SPEC 2.0 §4.1: "Where it is enabled, the repository chooses when: after a
// commit, or before a push. A reviewer MUST support both, and push is the
// default". The commit hook is still fully supported; it is now reached by
// `--hook-trigger commit` (or `both`) instead of being the only option.
//
// The fixtures below are REAL `git init` repos, not a bare `mkdir .git`: the
// pre-push hook is written to `git rev-parse --git-path hooks`, which needs an
// actual repository to resolve.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access, stat } from 'node:fs/promises';
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

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const prePushPath = (dir) => join(dir, '.git', 'hooks', 'pre-push');

test('--with-local-review is advertised in --help', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--with-local-review/);
});

test('--hook-trigger is advertised in --help, and names push as the default', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--hook-trigger/);
  assert.match(r.stdout, /push \(default\)/);
});

test('init --with-local-review scaffolds the /clud-bug-review slash command', async () => {
  const dir = await makeRepoDir('clud-bug-lr-');
  const r = runInit(dir, ['--with-local-review']);
  assert.equal(r.status, 0, r.stderr);
  const body = await readFile(join(dir, '.claude', 'commands', 'clud-bug-review.md'), 'utf8');
  assert.match(body, /<!-- clud-bug-local-version:/);
  assert.match(body, /description: Review the current branch's open PR locally/);
  assert.match(body, /\(clud-bug local-mode\)/);
  // rc.11 review fix: edit-in-place must look the comment up via the REST
  // issues-comments endpoint (integer id), NOT `gh pr view --json comments`
  // (GraphQL node id → PATCH 404 → duplicate comments on every re-run).
  assert.match(body, /repos\/\{owner\}\/\{repo\}\/issues\/<PR_NUMBER>\/comments/);
});

test('#276: a bare init installs the PRE-PUSH hook + the slash command (SPEC §4.1: push is the default)', async () => {
  const dir = await makeRepoDir('clud-bug-default-');
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);
  // slash command scaffolded (withHooks → withLocalReview)
  await access(join(dir, '.claude', 'commands', 'clud-bug-review.md'));
  // the git pre-push hook, executable, running review-prompt at the push trigger
  const hook = await readFile(prePushPath(dir), 'utf8');
  assert.match(hook, /clud-bug-pre-push-review/);
  assert.match(hook, /review-prompt --trigger push/);
  const mode = (await stat(prePushPath(dir))).mode & 0o111;
  assert.notEqual(mode, 0, 'the pre-push hook must be executable or git silently skips it');
  // …and NOT the commit hook: §4.1 makes this one choice, not both. Asserted on
  // the hook's own marker, not on the absence of settings.json: since #266 that
  // file also carries the harness-attestation registration, which §4.4:961
  // requires of every repo with a local review surface and which is independent
  // of WHICH trigger surfaces the recipe.
  const settings = await readFile(join(dir, '.claude', 'settings.json'), 'utf8');
  assert.equal(settings.includes('clud-bug-local-review'), false, 'no commit-review hook on the push surface');
  assert.match(settings, /clud-bug-attest/);
});

test('#276: --hook-trigger commit restores the commit-review hook (and writes no pre-push hook)', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-commit-');
  const r = runInit(dir, ['--hook-trigger', 'commit']);
  assert.equal(r.status, 0, r.stderr);
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].type, 'command');
  assert.equal(await exists(prePushPath(dir)), false);
});

test('#276: --hook-trigger both installs each surface', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-both-');
  const r = runInit(dir, ['--hook-trigger', 'both']);
  assert.equal(r.status, 0, r.stderr);
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].type, 'command');
  assert.match(await readFile(prePushPath(dir), 'utf8'), /clud-bug-pre-push-review/);
});

// #253 residual / SPEC 2.0 §4.1 + §1.6: `review.trigger` (on disk:
// `reviewTrigger`) is a real setting now — `init` persists whichever surface
// `--hook-trigger` actually installed through the schema (CONFIG_KEYS
// already declares the key; #271), so it has one source of truth instead of
// living only as "whichever hook file happens to exist".
test('#253: init --hook-trigger <push|commit|both> writes manifest.reviewTrigger to match', async () => {
  for (const trigger of ['push', 'commit', 'both']) {
    const dir = await makeRepoDir(`clud-bug-trigger-write-${trigger}-`);
    const r = runInit(dir, ['--hook-trigger', trigger]);
    assert.equal(r.status, 0, r.stderr);
    const manifest = JSON.parse(await readFile(join(dir, '.claude', 'skills', '.clud-bug.json'), 'utf8'));
    assert.equal(manifest.reviewTrigger, trigger);
  }
});

test('#253: init --no-hooks records no review.trigger — there is no local surface to name one for', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-no-hooks-');
  const r = runInit(dir, ['--no-hooks']);
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(await readFile(join(dir, '.claude', 'skills', '.clud-bug.json'), 'utf8'));
  assert.equal(manifest.reviewTrigger, undefined);
});

test('#276: an unrecognized --hook-trigger warns and falls back to push, never silently installs nothing', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-bogus-');
  const r = runInit(dir, ['--hook-trigger', 'bogus']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Unrecognized --hook-trigger/);
  assert.match(await readFile(prePushPath(dir), 'utf8'), /clud-bug-pre-push-review/);
});

// #276 bugfix (panel-reproduced, this repo's own PR #296): `runInit` resolved
// `hookTrigger` from CLI args alone, defaulting to 'push' with no regard for
// what was already installed. A bare re-run of `init` — which the README
// documents as normal ("Re-runs replace the prior block in place") — on a
// repo that had opted into ONLY the commit hook therefore silently grew an
// unrequested BLOCKING pre-push surface. `update.ts`'s refresh guard (~line
// 218) already promises the opposite ("switching is an explicit `clud-bug
// init --hook-trigger push`"); these two tests pin `init` to that promise.
test('#276 (bugfix): a bare re-init on a commit-only repo must NOT silently add the pre-push surface', async () => {
  const dir = await makeRepoDir('clud-bug-preserve-commit-');
  // Opt into commit-only review, explicitly.
  assert.equal(runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']).status, 0);
  assert.equal(await exists(join(dir, '.claude', 'settings.json')), true);
  assert.equal(await exists(prePushPath(dir)), false);

  // Bare re-run, no flags at all — must PRESERVE the commit-only surface.
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    await exists(prePushPath(dir)),
    false,
    'a bare re-run must not add the blocking pre-push surface to a commit-only repo',
  );
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].type, 'command'); // commit hook still there
  // The preserved choice is reported, not silent — and warn() survives the
  // --quiet the test harness runs under (CLUD_BUG_QUIET=1 in `runInit` above).
  assert.match(r.stderr, /preserving the existing local-review surface \(commit\)/);
});

test('#276: an explicit --hook-trigger push on a commit-only repo DOES add the pre-push surface (override wins)', async () => {
  const dir = await makeRepoDir('clud-bug-override-push-');
  assert.equal(runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']).status, 0);
  assert.equal(await exists(prePushPath(dir)), false);

  const r = runInit(dir, ['--hook-trigger', 'push']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(prePushPath(dir), 'utf8'), /clud-bug-pre-push-review/);
});

// #253 residual (ruling 1, panel-reproduced): the bare-re-run fallback above
// resolved `hookTrigger` from the hook FILES on disk alone, with no regard
// for a `review.trigger` the manifest already recorded — so a
// `clud-bug config set review.trigger push` on a commit-only repo silently
// reverted to `commit` on the very next bare `init --with-hooks` (the commit
// hook FILE was still there; `config set` does not touch hook files). SPEC
// 2.0 §4.1 + §1.6: the manifest's own value, once set, is the ONE source of
// truth — a hook file's presence is derived state, never a second record of
// it. Reproduced exactly as the reviewer did, against the built CLI.
test('#253: a `config set review.trigger` survives a bare `init --with-hooks` re-run', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-survives-');
  const manifestPath = join(dir, '.claude', 'skills', '.clud-bug.json');

  assert.equal(runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']).status, 0);
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).reviewTrigger, 'commit');

  const configSet = spawnSync(process.execPath, [CLI, 'config', 'set', 'review.trigger', 'push'], {
    cwd: dir,
    env: { ...process.env, HOME: dir },
    encoding: 'utf8',
  });
  assert.equal(configSet.status, 0, configSet.stderr);
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).reviewTrigger, 'push');
  // config set never touches a hook file — the commit hook is still on disk,
  // which is exactly what the old file-only fallback trusted over the manifest.
  assert.equal(await exists(prePushPath(dir)), false);

  const r = runInit(dir, ['--with-hooks']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    JSON.parse(await readFile(manifestPath, 'utf8')).reviewTrigger,
    'push',
    'the config-set trigger must survive a bare re-run — a hook FILE is derived state, never a second source of truth',
  );
  // the manifest is honoured, not just preserved verbatim: the surface it
  // now names gets reconciled onto disk too.
  assert.match(await readFile(prePushPath(dir), 'utf8'), /clud-bug-pre-push-review/);
});

// #253 residual (ruling 1's own break-it finding): the fix above made the
// MANIFEST correct on a bare re-run, but `runInit`'s hook reconciliation was
// still add-only — a switch surfaced through the manifest could leave the
// OLD surface's hook installed alongside the new one. Both directions
// reproduced exactly as the reviewer did, against the built CLI.
test('#253: switching review.trigger commit -> push via a bare re-run removes the stale commit-review hook entry', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-switch-cp-');
  const manifestPath = join(dir, '.claude', 'skills', '.clud-bug.json');

  assert.equal(runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']).status, 0);
  let settings = await readFile(join(dir, '.claude', 'settings.json'), 'utf8');
  assert.equal(settings.includes('clud-bug-local-review'), true, 'commit hook must be installed first');

  const configSet = spawnSync(process.execPath, [CLI, 'config', 'set', 'review.trigger', 'push'], {
    cwd: dir,
    env: { ...process.env, HOME: dir },
    encoding: 'utf8',
  });
  assert.equal(configSet.status, 0, configSet.stderr);

  const r = runInit(dir, ['--with-hooks']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).reviewTrigger, 'push');
  assert.match(await readFile(prePushPath(dir), 'utf8'), /clud-bug-pre-push-review/);
  settings = await readFile(join(dir, '.claude', 'settings.json'), 'utf8');
  assert.equal(
    settings.includes('clud-bug-local-review'),
    false,
    'the stale commit-review hook entry must be removed, not left alongside the new pre-push surface',
  );
  assert.match(settings, /clud-bug-attest/, 'the #266 attestation entries must survive the removal');
});

test('#253: switching review.trigger push -> commit via a bare re-run removes the stale pre-push hook file', async () => {
  const dir = await makeRepoDir('clud-bug-trigger-switch-pc-');
  const manifestPath = join(dir, '.claude', 'skills', '.clud-bug.json');

  assert.equal(runInit(dir, ['--with-hooks', '--hook-trigger', 'push']).status, 0);
  assert.match(await readFile(prePushPath(dir), 'utf8'), /clud-bug-pre-push-review/);

  const configSet = spawnSync(process.execPath, [CLI, 'config', 'set', 'review.trigger', 'commit'], {
    cwd: dir,
    env: { ...process.env, HOME: dir },
    encoding: 'utf8',
  });
  assert.equal(configSet.status, 0, configSet.stderr);

  const r = runInit(dir, ['--with-hooks']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).reviewTrigger, 'commit');
  assert.equal(
    await exists(prePushPath(dir)),
    false,
    'the stale blocking pre-push hook must be removed, not left installed alongside the commit surface',
  );
  const settings = await readFile(join(dir, '.claude', 'settings.json'), 'utf8');
  assert.equal(settings.includes('clud-bug-local-review'), true, 'the new commit-review hook must be installed');
});

test('#276: init preserves a foreign pre-push hook by chaining to it (SPEC §6.7)', async () => {
  const dir = await makeRepoDir('clud-bug-chain-');
  const foreign = '#!/bin/sh\n# somebody else was here\nmake lint\n';
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  await writeFile(prePushPath(dir), foreign);
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);
  // theirs preserved verbatim, ours installed, and ours invokes theirs
  assert.equal(await readFile(join(dir, '.git', 'hooks', 'pre-push.clud-bug-chained'), 'utf8'), foreign);
  const ours = await readFile(prePushPath(dir), 'utf8');
  assert.match(ours, /clud-bug-pre-push-review/);
  assert.match(ours, /pre-push\.clud-bug-chained/);
});

test('#276: re-running init is idempotent — it refreshes ours and never re-chains', async () => {
  const dir = await makeRepoDir('clud-bug-idem-');
  assert.equal(runInit(dir, []).status, 0);
  const first = await readFile(prePushPath(dir), 'utf8');
  assert.equal(runInit(dir, []).status, 0);
  assert.equal(await readFile(prePushPath(dir), 'utf8'), first);
  // a second install must NOT treat our own hook as foreign and archive it
  assert.equal(await exists(join(dir, '.git', 'hooks', 'pre-push.clud-bug-chained')), false);
});

test('init --no-hooks skips every local surface (and the implied slash command)', async () => {
  // The negation flag installs only the GitHub Action enforcer (+ skills) —
  // no hook of either kind, and without withHooks the slash command isn't implied.
  const dir = await makeRepoDir('clud-bug-nohooks-');
  const r = runInit(dir, ['--no-hooks']);
  assert.equal(r.status, 0, r.stderr);
  for (const path of [
    join(dir, '.claude', 'settings.json'),
    join(dir, '.claude', 'commands', 'clud-bug-review.md'),
    prePushPath(dir),
  ]) {
    assert.equal(await exists(path), false, `${path} should not exist under --no-hooks`);
  }
});

test('--no-hooks is advertised in --help', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--no-hooks/);
});

test('init --hook-trigger commit scaffolds the native commit-review hook + the slash command', async () => {
  const dir = await makeRepoDir('clud-bug-hooks-');
  const r = runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']);
  assert.equal(r.status, 0, r.stderr);
  // --with-hooks implies --with-local-review, so the slash command is there too
  await access(join(dir, '.claude', 'commands', 'clud-bug-review.md'));
  // the native `type: command` commit-review hook, merged into .claude/settings.json
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  const entry = settings.hooks.PostToolUse[0];
  assert.equal(entry.matcher, 'Bash');
  assert.equal(entry.hooks[0].type, 'command');
  assert.equal(entry.hooks[0].if, 'Bash(git commit *)');
  assert.equal(entry.hooks[0].async, true);
  // asyncRewake is what surfaces the recipe (exit 2) back to the agent — without
  // it the whole mechanism silently no-ops, so assert it end-to-end.
  assert.equal(entry.hooks[0].asyncRewake, true);
  assert.match(entry.hooks[0].command, /clud-bug-local-review/);
  assert.match(entry.hooks[0].command, /review-prompt --trigger commit/);
  // also fires on `logmind log` — the thrillmade commit primitive
  assert.equal(entry.hooks[1].if, 'Bash(logmind log *)');
  assert.equal(entry.hooks[1].type, 'command');
  assert.equal(entry.hooks[1].async, true);
  assert.equal(entry.hooks[1].asyncRewake, true);
});

test('init --hook-trigger commit does NOT clobber a pre-existing malformed settings.json', async () => {
  const dir = await makeRepoDir('clud-bug-hooks-bad-');
  await mkdir(join(dir, '.claude'), { recursive: true });
  const settingsPath = join(dir, '.claude', 'settings.json');
  const malformed = '{ "model": "opus", oops not json';
  await writeFile(settingsPath, malformed);
  const r = runInit(dir, ['--with-hooks', '--hook-trigger', 'commit']);
  assert.equal(r.status, 0, r.stderr);
  // the user's (malformed) file must be left untouched, never overwritten with just our hook
  const after = await readFile(settingsPath, 'utf8');
  assert.equal(after, malformed, 'malformed settings.json must not be clobbered');
});

test('init --local-only installs max mode (slash command + pre-push hook) but NO Action workflows', async () => {
  const dir = await makeRepoDir('clud-bug-localonly-');
  const r = runInit(dir, ['--local-only']);
  assert.equal(r.status, 0, r.stderr);
  // max mode present: slash command + the default (pre-push) local surface
  await access(join(dir, '.claude', 'commands', 'clud-bug-review.md'));
  assert.match(await readFile(prePushPath(dir), 'utf8'), /review-prompt --trigger push/);
  // NO GitHub Action workflows (those run claude-code-action with ANTHROPIC_API_KEY)
  for (const wf of ['clud-bug-review.yml', 'clud-bug-audit.yml', 'clud-bug-self-update.yml']) {
    assert.equal(
      await exists(join(dir, '.github', 'workflows', wf)),
      false,
      `${wf} must NOT be written under --local-only`,
    );
  }
});
