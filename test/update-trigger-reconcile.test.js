// #253 residual / SPEC 2.0 §4.1 + §1.6 — `clud-bug update` reconciles the
// installed local-review hooks to `manifest.reviewTrigger` (written by
// `init --hook-trigger`, CONFIG_KEYS from #271) instead of treating "a hook
// file happens to exist" as a second, driftable record of which surface is
// wanted. Mirrors test/update-pre-push.test.js's fixture shape.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile, chmod, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runUpdate } from '../src/cli/update.js';
import {
  buildPrePushHookScript, CLUD_BUG_PREPUSH_MARKER, PREPUSH_CHAINED_FILE,
  buildCommitReviewCommand, mergeLocalReviewHook,
} from '../src/cli/hooks.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(REPO_ROOT, 'templates');
const BASELINE = join(TEMPLATES, 'skills', 'baseline');
const offlineLoadBaseline = { cacheDir: null, fetch: async () => { throw new Error('test: no network'); } };

async function makeGitRepo(reviewTrigger) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-trigger-reconcile-'));
  const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  await mkdir(join(dir, '.claude', 'skills'), { recursive: true });
  await writeFile(
    join(dir, '.claude', 'skills', '.clud-bug.json'),
    JSON.stringify({
      version: 1,
      ...(reviewTrigger !== undefined ? { reviewTrigger } : {}),
      tests: 'none',
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
const settingsPath = (dir) => join(dir, '.claude', 'settings.json');

const update = (dir) =>
  runUpdate({
    cwd: dir,
    templatesDir: TEMPLATES,
    baselineDir: BASELINE,
    ourVersion: '0.7.0-test',
    loadBaselineOpts: offlineLoadBaseline,
  });

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

test('runUpdate: reviewTrigger "both" ADDS the missing pre-push hook to a commit-only repo', async () => {
  const dir = await makeGitRepo('both');
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(settingsPath(dir), JSON.stringify(mergeLocalReviewHook(undefined, buildCommitReviewCommand())));

  const r = await update(dir);
  assert.equal(await exists(hookPath(dir)), true, 'the pre-push hook must be installed');
  assert.equal(await readFile(hookPath(dir), 'utf8'), buildPrePushHookScript());
  assert.ok(r.changed.some((c) => c.label.includes('pre-push review hook installed')));
  // The commit hook (still named by "both") must survive, refreshed.
  const settings = await readFile(settingsPath(dir), 'utf8');
  assert.match(settings, /clud-bug-local-review/);
});

test('runUpdate: reviewTrigger "both" ADDS the missing commit hook to a push-only repo', async () => {
  const dir = await makeGitRepo('both');
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  await writeFile(hookPath(dir), buildPrePushHookScript());
  await chmod(hookPath(dir), 0o755);

  const r = await update(dir);
  const settings = JSON.parse(await readFile(settingsPath(dir), 'utf8'));
  assert.equal(settings.hooks.PostToolUse.some((e) => e.hooks.some((h) => String(h.command || '').includes('clud-bug-local-review'))), true);
  assert.ok(r.changed.some((c) => c.label === 'commit-review + attestation hooks'));
  // The pre-push hook (still named by "both") must survive, refreshed.
  assert.equal(await readFile(hookPath(dir), 'utf8'), buildPrePushHookScript());
});

test('runUpdate: reviewTrigger "commit" REMOVES a pre-push hook no longer named, with no chained hook to restore', async () => {
  const dir = await makeGitRepo('commit');
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  await writeFile(hookPath(dir), buildPrePushHookScript());
  await chmod(hookPath(dir), 0o755);

  const r = await update(dir);
  assert.equal(await exists(hookPath(dir)), false, 'the pre-push hook must be removed');
  assert.ok(r.changed.some((c) => c.label.includes('pre-push review hook removed')));
});

test('runUpdate: reviewTrigger "commit" REMOVING the pre-push hook restores a hook it had chained to (§6.7)', async () => {
  const dir = await makeGitRepo('commit');
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true });
  const foreign = '#!/bin/sh\nmake lint\n';
  await writeFile(join(dir, '.git', 'hooks', PREPUSH_CHAINED_FILE), foreign);
  await chmod(join(dir, '.git', 'hooks', PREPUSH_CHAINED_FILE), 0o755);
  await writeFile(hookPath(dir), buildPrePushHookScript());
  await chmod(hookPath(dir), 0o755);

  await update(dir);
  assert.equal(await readFile(hookPath(dir), 'utf8'), foreign, 'the foreign hook must be restored to its own slot');
  assert.equal(await exists(join(dir, '.git', 'hooks', PREPUSH_CHAINED_FILE)), false, 'the chained backup must be consumed, not left behind');
});

test('runUpdate: reviewTrigger "push" REMOVES a commit-review entry no longer named, keeping attestation entries', async () => {
  const dir = await makeGitRepo('push');
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(settingsPath(dir), JSON.stringify(mergeLocalReviewHook(undefined, buildCommitReviewCommand())));

  const r = await update(dir);
  const settings = JSON.parse(await readFile(settingsPath(dir), 'utf8'));
  const post = settings.hooks.PostToolUse;
  assert.equal(post.some((e) => e.hooks.some((h) => String(h.command || '').includes('clud-bug-local-review'))), false, 'the commit-review entry must be gone');
  assert.equal(post.some((e) => e.matcher === 'Agent'), true, 'the attestation dispatch entry must survive');
  assert.ok(r.changed.some((c) => c.label.includes('commit-review hook removed')));
  // The pre-push hook (now the only named surface) must be installed too.
  assert.equal(await readFile(hookPath(dir), 'utf8'), buildPrePushHookScript());
});

test('runUpdate: NO reviewTrigger recorded (pre-#253 manifest) — refreshes what exists, adds/removes nothing', async () => {
  const dir = await makeGitRepo(undefined);
  await mkdir(join(dir, '.claude'), { recursive: true });
  await writeFile(settingsPath(dir), JSON.stringify(mergeLocalReviewHook(undefined, buildCommitReviewCommand())));

  await update(dir);
  assert.equal(await exists(hookPath(dir)), false, 'no reviewTrigger recorded — update must not add a surface never asked for');
  const settings = await readFile(settingsPath(dir), 'utf8');
  assert.match(settings, /clud-bug-local-review/, 'the pre-existing commit hook must simply be refreshed');
});

test('runUpdate: reviewTrigger set but NEITHER hook ever installed — installs nothing (not the first install of a surface)', async () => {
  const dir = await makeGitRepo('both');
  await update(dir);
  assert.equal(await exists(hookPath(dir)), false);
  assert.equal(await exists(settingsPath(dir)), false, 'no settings.json — nothing to retrofit attestation onto, and no surface to add from zero');
});
