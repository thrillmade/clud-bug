// #276 — `clud-bug update` and the git `pre-push` review hook.
//
// The contract mirrors the commit hook's (`update.ts` step 5c): refresh OUR
// marked hook in place, and touch nothing else. It must NOT install the
// pre-push surface into a repo that never opted into it — SPEC 2.0 §4.1 says
// the local review "is off unless asked for", so `update` refreshing what is
// installed is correct and `update` ADDING a surface would not be.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile, chmod, stat, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runUpdate } from '../src/cli/update.js';
import { buildPrePushHookScript, CLUD_BUG_PREPUSH_MARKER } from '../src/cli/hooks.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(REPO_ROOT, 'templates');
const BASELINE = join(TEMPLATES, 'skills', 'baseline');
const offlineLoadBaseline = { cacheDir: null, fetch: async () => { throw new Error('test: no network'); } };

async function makeGitRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-update-prepush-'));
  const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  await mkdir(join(dir, '.claude', 'skills'), { recursive: true });
  await writeFile(
    join(dir, '.claude', 'skills', '.clud-bug.json'),
    // A non-empty `installed` — `runUpdate` short-circuits with `missing:
    // 'init'` on an empty manifest and no review workflow, so an empty one
    // would make every assertion below vacuously "pass" by never running.
    JSON.stringify({
      version: 1,
      installed: [
        { slug: 'critical-issues-only', name: 'critical-issues-only', source: 'bundled', kind: 'bundled', description: '' },
      ],
    }),
  );
  await mkdir(join(dir, '.claude', 'skills', 'critical-issues-only'), { recursive: true });
  await writeFile(join(dir, '.claude', 'skills', 'critical-issues-only', 'SKILL.md'), '---\nname: x\n---\n');
  return dir;
}

const hookPath = (dir) => join(dir, '.git', 'hooks', 'pre-push');

const update = (dir) =>
  runUpdate({
    cwd: dir,
    templatesDir: TEMPLATES,
    baselineDir: BASELINE,
    ourVersion: '0.7.0-test',
    loadBaselineOpts: offlineLoadBaseline,
  });

test('runUpdate: refreshes a STALE clud-bug pre-push hook in place', async () => {
  const dir = await makeGitRepo();
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  // A hook carrying our marker but an old body — what a version bump looks like.
  const stale = `#!/bin/sh\n# ${CLUD_BUG_PREPUSH_MARKER} v0 — old body\nexit 0\n`;
  await writeFile(hookPath(dir), stale);
  await chmod(hookPath(dir), 0o755);

  const r = await update(dir);
  assert.equal(await readFile(hookPath(dir), 'utf8'), buildPrePushHookScript());
  assert.ok(r.changed.some((c) => c.label === 'pre-push review hook'), 'refresh must be reported');
  // git silently skips a non-executable hook — the refresh must not drop the bit.
  assert.notEqual((await stat(hookPath(dir))).mode & 0o111, 0);
});

test('runUpdate: an already-current pre-push hook is a no-op, not a rewrite', async () => {
  const dir = await makeGitRepo();
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  await writeFile(hookPath(dir), buildPrePushHookScript());
  await chmod(hookPath(dir), 0o755);

  const r = await update(dir);
  assert.ok(r.unchanged.some((c) => c.label === 'pre-push review hook'));
  assert.ok(!r.changed.some((c) => c.label === 'pre-push review hook'));
});

test('runUpdate: §4.1 — never ADDS the pre-push surface to a repo that did not opt in', async () => {
  const dir = await makeGitRepo();
  await update(dir);
  let exists = true;
  try {
    await access(hookPath(dir));
  } catch {
    exists = false;
  }
  assert.equal(exists, false, 'update must refresh what is installed, never install a new surface');
});

test('runUpdate: leaves a FOREIGN pre-push hook completely alone', async () => {
  const dir = await makeGitRepo();
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  const foreign = '#!/bin/sh\nmake lint\n';
  await writeFile(hookPath(dir), foreign);

  await update(dir);
  assert.equal(await readFile(hookPath(dir), 'utf8'), foreign);
});
