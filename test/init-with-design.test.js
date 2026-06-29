// rc.16 — `clud-bug init --with-design` installs the design-critic kit (3
// `kind: design` skills) and flips the off-by-default `design` block to
// enabled, so the visual review lens runs (local recipe + hosted bot).

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, access } from 'node:fs/promises';
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

async function readManifest(dir) {
  return JSON.parse(await readFile(join(dir, '.claude', 'skills', '.clud-bug.json'), 'utf8'));
}

test('--with-design is advertised in --help', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--with-design/);
});

test('init --with-design installs the design kit + enables the design lens', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-design-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, ['--with-design']);
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  // The design block is flipped on.
  assert.equal(manifest.design?.enabled, true, 'design.enabled should be true');

  // The 3 design-kit skills are registered with kind: design.
  const designEntries = (manifest.installed || []).filter((e) => e.kind === 'design');
  assert.ok(designEntries.length >= 3, `expected >=3 design entries, got ${designEntries.length}`);
  const slugs = designEntries.map((e) => e.slug).sort();
  assert.deepEqual(
    slugs,
    ['design-system-consistency', 'frontend-a11y', 'visual-polish'],
    'all three design-kit skills should be pinned',
  );
  for (const e of designEntries) {
    assert.equal(e.source, 'clud-bug-design', `${e.slug} source should be clud-bug-design`);
  }

  // The SKILL.md files were written, carrying `kind: design` frontmatter.
  const body = await readFile(
    join(dir, '.claude', 'skills', 'visual-polish', 'SKILL.md'),
    'utf8',
  );
  assert.match(body, /kind:\s*design/);
});

test('init WITHOUT --with-design leaves the design lens off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-nodesign-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = runInit(dir, []);
  assert.equal(r.status, 0, r.stderr);

  const manifest = await readManifest(dir);
  // No design block written, OR present but not enabled — either way, off.
  assert.notEqual(manifest.design?.enabled, true);
  const designEntries = (manifest.installed || []).filter((e) => e.kind === 'design');
  assert.equal(designEntries.length, 0, 'no design skills should be installed');

  // The design SKILL.md must not exist.
  let exists = true;
  try {
    await access(join(dir, '.claude', 'skills', 'visual-polish', 'SKILL.md'));
  } catch {
    exists = false;
  }
  assert.equal(exists, false);
});
