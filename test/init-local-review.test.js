// Wave 6b — `clud-bug init --with-local-review` scaffolds the local-mode
// /clud-bug-review slash command at .claude/commands/clud-bug-review.md.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
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

test('--with-local-review is advertised in --help', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--with-local-review/);
});

test('init --with-local-review scaffolds the /clud-bug-review slash command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-lr-'));
  await mkdir(join(dir, '.git'), { recursive: true });
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

test('init without --with-local-review does NOT scaffold the slash command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-nolr-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);
  let exists = true;
  try {
    await access(join(dir, '.claude', 'commands', 'clud-bug-review.md'));
  } catch {
    exists = false;
  }
  assert.equal(exists, false, 'slash command should not exist without the flag');
});

test('init --with-hooks scaffolds the native commit-review hook + the slash command', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-hooks-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, ['--with-hooks']);
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
  assert.match(entry.hooks[0].command, /clud-bug-local-review/);
  assert.match(entry.hooks[0].command, /review-prompt --trigger commit/);
  // also fires on `logmind log` — the thrillmade commit primitive
  assert.equal(entry.hooks[1].if, 'Bash(logmind log *)');
  assert.equal(entry.hooks[1].type, 'command');
});

test('init --with-hooks does NOT clobber a pre-existing malformed settings.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-hooks-bad-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  await mkdir(join(dir, '.claude'), { recursive: true });
  const settingsPath = join(dir, '.claude', 'settings.json');
  const malformed = '{ "model": "opus", oops not json';
  await writeFile(settingsPath, malformed);
  const r = runInit(dir, ['--with-hooks']);
  assert.equal(r.status, 0, r.stderr);
  // the user's (malformed) file must be left untouched, never overwritten with just our hook
  const after = await readFile(settingsPath, 'utf8');
  assert.equal(after, malformed, 'malformed settings.json must not be clobbered');
});
