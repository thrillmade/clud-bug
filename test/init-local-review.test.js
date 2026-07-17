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

test('init installs BOTH the commit hook and the slash command by default (ZP3)', async () => {
  // Phase ZP3: --with-hooks is now ON by default (it implies --with-local-review),
  // so a bare `init` installs the commit-review hook AND the /clud-bug-review
  // slash command alongside the GitHub Action enforcer.
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-default-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);
  // slash command scaffolded (withHooks → withLocalReview)
  await access(join(dir, '.claude', 'commands', 'clud-bug-review.md'));
  // commit-review hook merged into settings.json
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].type, 'command');
});

test('init --no-hooks skips the commit hook (and the implied slash command)', async () => {
  // The negation flag installs only the GitHub Action enforcer (+ skills) —
  // no commit hook, and without withHooks the slash command isn't implied.
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-nohooks-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, ['--no-hooks']);
  assert.equal(r.status, 0, r.stderr);
  for (const p of [
    join(dir, '.claude', 'settings.json'),
    join(dir, '.claude', 'commands', 'clud-bug-review.md'),
  ]) {
    let exists = true;
    try {
      await access(p);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `${p} should not exist under --no-hooks`);
  }
});

test('--no-hooks is advertised in --help', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--no-hooks/);
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

test('init --local-only installs max mode (slash command + hook) but NO Action workflows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-localonly-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, ['--local-only']);
  assert.equal(r.status, 0, r.stderr);
  // max mode present: slash command + the type:command hook
  await access(join(dir, '.claude', 'commands', 'clud-bug-review.md'));
  const settings = JSON.parse(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].type, 'command');
  // NO GitHub Action workflows (those run claude-code-action with ANTHROPIC_API_KEY)
  for (const wf of ['clud-bug-review.yml', 'clud-bug-audit.yml', 'clud-bug-self-update.yml']) {
    let exists = true;
    try {
      await access(join(dir, '.github', 'workflows', wf));
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `${wf} must NOT be written under --local-only`);
  }
});
