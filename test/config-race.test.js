// The manifest changing UNDER a `clud-bug config` write (clud-bug#271).
//
// The lock in skills.ts serializes clud-bug's own `config set` / `config
// unset` invocations against each other, and config-command.test.js proves
// that. It says nothing about `init`, `update`, `add`, `remove` or a person
// with an editor — none of those take it. Any of them can replace the
// manifest while this command sits between its read and its write, and the
// one-key edit the command then writes was computed from bytes that are no
// longer on disk: whatever the other writer put there is gone, at exit 0,
// with nothing on stderr. So the write compares first, and writes nothing
// when the bytes moved.
//
// In process rather than through the binary, and the racing write is landed
// by the test itself in the window: the window is a few microseconds wide, so
// a timing race would be a test that passes because the failure is rare. The
// exit code and the message are still the ones a person sees — `runConfig`'s
// own — because that is what this pins.

import { test, vi } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Hoisted with the mock factory below, which vitest runs before this file's
// own top-level bindings exist.
const race = vi.hoisted(() => ({ path: null, bytes: null }));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    readFile: async (...args) => {
      // `finally`, so the write lands after a read that found no file too —
      // that is how a first install looks to this command.
      try {
        return await actual.readFile(...args);
      } finally {
        if (race.bytes !== null && String(args[0]) === race.path) {
          const landing = race.bytes;
          race.bytes = null; // once: the write's own re-read must see it
          await actual.writeFile(race.path, landing);
        }
      }
    },
  };
});

const { runConfig } = await import('../src/cli/config.js');

const BEFORE = `{
  "version": 1,
  "installed": [],
  "tests": "npm test"
}
`;
// What `init`, `update`, `add`, `remove` or a hand edit leaves behind — same
// file, different bytes, and a key this command never read.
const OTHER = `{
  "version": 1,
  "installed": [],
  "tests": "npm test",
  "ciChecks": ["build", "typecheck"]
}
`;

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-race-'));
  const path = join(dir, '.claude', 'skills', '.clud-bug.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, BEFORE);
  return { dir, path };
}

/**
 * `runConfig` writes to stderr and ends in `process.exit`; in process that
 * would take the test runner with it, so the exit is recorded and unwound.
 */
async function runCommand(cwd, argv) {
  const stdout = [];
  const stderr = [];
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdout.push(s); return true; }),
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { stderr.push(s); return true; }),
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw Object.assign(new Error(`exit ${code}`), { exitCode: code });
    }),
  ];
  let status = 0;
  try {
    await runConfig({ _: argv, cwd });
  } catch (err) {
    if (err.exitCode === undefined) throw err;
    status = err.exitCode;
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return { status, stdout: stdout.join(''), stderr: stderr.join('') };
}

test('control: with nothing racing it, the same write lands', async () => {
  const { dir, path } = await makeRepo();
  try {
    race.path = path;
    race.bytes = null;
    const r = await runCommand(dir, ['config', 'set', 'review.trigger', 'both']);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).reviewTrigger, 'both');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set refuses when the manifest changed between its read and its write', async () => {
  const { dir, path } = await makeRepo();
  try {
    race.path = path;
    race.bytes = OTHER;
    const r = await runCommand(dir, ['config', 'set', 'review.trigger', 'both']);
    assert.equal(race.bytes, null, 'control: the racing write never fired');
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /changed while this command was running/);
    assert.match(r.stderr, /Nothing was written/);
    // Byte for byte what the other writer left: not merged, not re-stamped.
    assert.equal(await readFile(path, 'utf8'), OTHER);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config unset refuses on the same change, and drops nothing', async () => {
  const { dir, path } = await makeRepo();
  try {
    race.path = path;
    race.bytes = OTHER;
    const r = await runCommand(dir, ['config', 'unset', 'tests']);
    assert.equal(race.bytes, null, 'control: the racing write never fired');
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /changed while this command was running/);
    assert.equal(await readFile(path, 'utf8'), OTHER);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A first install has no file at all. "Absent" and "absent, then somebody
// created it" are different bytes, and only one of them is safe to write over.
test('config set refuses when another writer created the manifest first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-race-new-'));
  const path = join(dir, '.claude', 'skills', '.clud-bug.json');
  try {
    await mkdir(dirname(path), { recursive: true });
    race.path = path;
    race.bytes = OTHER;
    const r = await runCommand(dir, ['config', 'set', 'review.trigger', 'both']);
    assert.equal(race.bytes, null, 'control: the racing write never fired');
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /changed while this command was running/);
    assert.equal(await readFile(path, 'utf8'), OTHER);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
