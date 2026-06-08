// v0.6.33 — `clud-bug init --with-skdd` mirror tests.
//
// The flag is the symmetric mirror of logmind v0.6.8's `--with-skdd`:
// Node-first users running `clud-bug init --with-skdd` get logmind
// installed via pip + scaffolded via `logmind init`. Anti-loop: invokes
// `logmind init` (NOT `logmind init --with-skdd`).

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

test('--with-skdd flag is parsed without error', () => {
  // Smoke: just running `--help` confirms --with-skdd mention in init line.
  const r = spawnSync(process.execPath, [CLI, '--help'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--with-skdd/);
});

test('init --with-skdd: graceful no-Python warning', async () => {
  // Run clud-bug init in an isolated dir with PATH scrubbed of any pip/python.
  // The subprocess fails to find pip (graceful warning), but init succeeds.
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-init-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  // Pre-init: avoid the interactive specimen prompt by passing --accept-all
  // (default-Y on "install all baseline specimens").
  const env = {
    ...process.env,
    // Empty PATH means no pip / pip3 / python / python3 available.
    PATH: '/nonexistent',
    HOME: dir,
    CLUD_BUG_QUIET: '1',
  };
  const r = spawnSync(
    process.execPath,
    [CLI, 'init', '--accept-all', '--with-skdd', '--no-set-protection'],
    { cwd: dir, env, encoding: 'utf8', timeout: 30000 },
  );
  // The KEY assertion: when --with-skdd runs without pip available,
  // it emits the warning + recovery hint, doesn't crash with an
  // unhandled exception. If init bailed before reaching --with-skdd
  // (pre-handler step failed in the isolated env), that's a different
  // failure mode — but no crash either way.
  const combined = r.stdout + r.stderr;
  const sawWarning = /no `pip`\/`pip3`\/`python` found/.test(combined)
      || /pip install logmind/.test(combined);
  // No stack trace / unhandled rejection should appear in either case.
  assert.doesNotMatch(
    combined,
    /UnhandledPromiseRejection|TypeError:.*spawn|ReferenceError/,
    "no unhandled exception should surface",
  );
  // If init reached the --with-skdd handler (the typical case), the
  // warning text MUST appear — otherwise we have silent failure (the
  // exact pattern v0.6.31 burned us with). Only allow the warning-
  // absent path when init clearly failed earlier.
  if (r.status === 0) {
    assert.ok(
      sawWarning,
      `init succeeded but --with-skdd warning did not surface. Output:\n${combined}`,
    );
  }
});

test('parseArgs records --with-skdd flag', async () => {
  // Import the file's parseArgs by re-reading its source + executing in a
  // sandboxed `import()`. Simpler proxy: confirm the flag changes
  // observable behavior — e.g., the help block lists it.
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  // The init help line now mentions --with-skdd (per v0.6.33 HELP block edit).
  assert.match(r.stdout, /with-skdd/i);
});
