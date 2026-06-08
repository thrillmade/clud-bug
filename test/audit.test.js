import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  durationToGitSince,
  computeAuditFileSet,
  renderAuditHeader,
} from '../lib/audit.js';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function makeRepo(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-audit-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('durationToGitSince: parses 7d, 2w, 1mo, 1y', () => {
  assert.equal(durationToGitSince('7d'), '7 days ago');
  assert.equal(durationToGitSince('1d'), '1 day ago');
  assert.equal(durationToGitSince('2w'), '2 weeks ago');
  assert.equal(durationToGitSince('1mo'), '1 month ago');
  assert.equal(durationToGitSince('3mo'), '3 months ago');
  assert.equal(durationToGitSince('1y'), '1 year ago');
});

test('durationToGitSince: returns null on empty input', () => {
  assert.equal(durationToGitSince(undefined), null);
  assert.equal(durationToGitSince(''), null);
});

test('durationToGitSince: throws on garbage', () => {
  assert.throws(() => durationToGitSince('soon'), /Unrecognized duration/);
  assert.throws(() => durationToGitSince('7'), /Unrecognized duration/);
  assert.throws(() => durationToGitSince('5x'), /Unrecognized duration/);
});

test('computeAuditFileSet: lists all tracked files when no filter given', async () => {
  const dir = await makeRepo({
    'src/a.ts': 'a', 'src/b.ts': 'b', 'README.md': 'r',
  });
  try {
    const files = computeAuditFileSet({ cwd: dir });
    assert.deepEqual(files, ['README.md', 'src/a.ts', 'src/b.ts']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('computeAuditFileSet: skips node_modules / dist / build', async () => {
  const dir = await makeRepo({
    'src/a.ts': 'a',
    'node_modules/foo/index.js': 'x',
    'dist/bundle.js': 'x',
    'coverage/lcov.info': 'x',
  });
  try {
    const files = computeAuditFileSet({ cwd: dir });
    assert.deepEqual(files, ['src/a.ts']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('computeAuditFileSet: scope glob narrows the file set', async () => {
  const dir = await makeRepo({
    'src/a.ts': 'a', 'src/lib/b.ts': 'b', 'app/c.ts': 'c', 'README.md': 'r',
  });
  try {
    const files = computeAuditFileSet({ cwd: dir, scopes: ['src/**/*.ts'] });
    assert.deepEqual(files, ['src/a.ts', 'src/lib/b.ts']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('computeAuditFileSet: changed-in window actually filters by date', async () => {
  // Backdate the initial commit ~30 days ago, then add a file today and
  // assert that --changed-in 7d returns only the recent file.
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-audit-time-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });

    await writeFile(join(dir, 'old.ts'), 'old');
    spawnSync('git', ['add', 'old.ts'], { cwd: dir });
    const oldDate = '2026-04-15T12:00:00Z';   // ~30 days before today (2026-05-15)
    spawnSync('git', ['commit', '-q', '-m', 'old'], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: oldDate, GIT_COMMITTER_DATE: oldDate },
    });

    await writeFile(join(dir, 'recent.ts'), 'fresh');
    spawnSync('git', ['add', 'recent.ts'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'recent'], { cwd: dir });

    const files = computeAuditFileSet({ cwd: dir, changedIn: '7d' });
    assert.ok(files.includes('recent.ts'), 'recent.ts should be in 7d window');
    assert.ok(!files.includes('old.ts'), 'old.ts should NOT be in 7d window');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('computeAuditFileSet: deleted files do not survive the manifest', async () => {
  // A file modified within the window and then deleted shouldn't appear in
  // the manifest (Claude can't audit a path that no longer exists on disk).
  const dir = await makeRepo({ 'gone.ts': 'gone', 'kept.ts': 'kept' });
  try {
    await writeFile(join(dir, 'gone.ts'), 'gone-modified');
    git(dir, 'add', 'gone.ts');
    git(dir, 'commit', '-q', '-m', 'modify gone.ts');
    git(dir, 'rm', 'gone.ts');
    git(dir, 'commit', '-q', '-m', 'delete gone.ts');

    const files = computeAuditFileSet({ cwd: dir, changedIn: '7d' });
    assert.ok(!files.includes('gone.ts'), 'deleted file must be excluded');
    assert.ok(files.includes('kept.ts'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('renderAuditHeader: includes date, scope, and file manifest', () => {
  const out = renderAuditHeader({
    date: '2026-05-15',
    scopeLabel: 'all tracked files',
    files: ['src/a.ts', 'src/b.ts'],
  });
  assert.match(out, /🐛 Clud Bug audit — 2026-05-15/);
  assert.match(out, /Files surveyed: \*\*2\*\*/);
  assert.match(out, /Scope: all tracked files/);
  assert.match(out, /src\/a\.ts/);
  assert.match(out, /## Findings/);
});
