// One key space (clud-bug#271). SPEC §1.6:247 draws the line between a
// setting a person edits and a knob a tool tunes for itself — either way,
// nothing this tool WRITES into `.clud-bug.json` may be a key the schema
// cannot account for, or `clud-bug config` is a partial view of a file it
// claims to own.
//
// Two layers, because neither alone is enough:
//
//   BEHAVIOUR — run the real `init` (and `remove`) and account for every key
//               in the manifest they leave behind.
//   STATIC    — scan the source for manifest writes, so a key some future
//               command writes on a path this test never exercises still has
//               to be described. Carries its own control: the scan must find
//               the writes we already know about, or it is proving nothing.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { CONFIG_KEYS, CONFIG_KEY_NAMES } from '../src/core/config-schema.js';
import { TEST_FILE_PATTERN, NPM_INIT_TEST_PLACEHOLDER_PATTERN } from '../src/core/detect.js';
import { LOGMIND_TESTS_LINE_PATTERN } from '../src/core/tests-declaration.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'bin', 'clud-bug.js');

const PATHS = CONFIG_KEY_NAMES.map((name) => CONFIG_KEYS[name].path);

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    env: { ...process.env, HOME: dir, CLUD_BUG_QUIET: '1' },
    encoding: 'utf8',
    timeout: 60000,
  });
}

/** Every path in the manifest the schema does not describe. */
function unaccounted(value, path = []) {
  if (path.length > 0) {
    if (PATHS.some((p) => p.length === path.length && p.every((s, i) => s === path[i]))) return [];
    const isAncestor = PATHS.some(
      (p) => p.length > path.length && path.every((s, i) => p[i] === s),
    );
    if (!isAncestor) return [path.join('.')];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [path.join('.')];
  }
  return Object.entries(value).flatMap(([key, child]) => unaccounted(child, [...path, key]));
}

test('control: unaccounted() catches a key the schema does not describe', () => {
  assert.deepEqual(unaccounted({ strictMode: true }), []);
  assert.deepEqual(unaccounted({ aKeyNobodyDeclared: 1 }), ['aKeyNobodyDeclared']);
  assert.deepEqual(unaccounted({ design: { enabled: true } }), []);
  assert.deepEqual(unaccounted({ design: { madeUp: 1 } }), ['design.madeUp']);
});

test('every key clud-bug init writes is described by CONFIG_KEYS', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-parity-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  const r = run(dir, ['init', '--offline', '--accept-all', '--no-set-protection', '--with-design']);
  assert.equal(r.status, 0, r.stderr);

  const manifest = JSON.parse(
    await readFile(join(dir, '.claude', 'skills', '.clud-bug.json'), 'utf8'),
  );
  // The control for THIS assertion: init must actually have written settings,
  // or an empty manifest would pass trivially.
  assert.ok(Object.keys(manifest).length >= 5, `init wrote only ${Object.keys(manifest)}`);
  assert.equal(manifest.strictMode, true);
  assert.equal(typeof manifest.tests, 'string');
  assert.equal(manifest.design.enabled, true);
  assert.deepEqual(unaccounted(manifest), []);
});

test('every key still described after remove rewrites the manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-parity-rm-'));
  await mkdir(join(dir, '.git'), { recursive: true });
  assert.equal(
    run(dir, ['init', '--offline', '--accept-all', '--no-set-protection']).status,
    0,
  );
  const path = join(dir, '.claude', 'skills', '.clud-bug.json');
  const installed = JSON.parse(await readFile(path, 'utf8')).installed;
  assert.ok(installed.length > 0, 'init installed nothing to remove');
  const r = run(dir, ['remove', installed[0].slug]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(unaccounted(JSON.parse(await readFile(path, 'utf8'))), []);
});

test('every manifest key the source writes is described by CONFIG_KEYS', async () => {
  // `manifest.foo =`, `manifest['foo'] =`, `parsed.foo =`, and the schema's
  // own `stampSetting(manifest, 'key', …)` form.
  const ASSIGNMENT = /\b(?:manifest|parsed)(?:\.([A-Za-z_][A-Za-z0-9_]*)|\['([^']+)'\])\s*=[^=]/g;
  const onDisk = new Set(PATHS.map((p) => p[0]));
  const found = new Set();
  const offenders = [];

  for (const dir of [join(ROOT, 'src', 'cli'), join(ROOT, 'src', 'core')]) {
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.ts')) continue;
      const text = await readFile(join(dir, file), 'utf8');
      // Only files that actually touch the manifest — elsewhere `parsed.x =`
      // is some other parse (a verifier response, a coerced config fragment).
      if (!/\.clud-bug\.json|MANIFEST_FILE|writeManifest/.test(text)) continue;
      for (const m of text.matchAll(ASSIGNMENT)) {
        const key = m[1] ?? m[2];
        if (key === 'installed' && file === 'skills.ts') continue; // local rebuild, same key
        found.add(key);
        if (!onDisk.has(key)) offenders.push(`${file}: ${key}`);
      }
    }
  }

  // CONTROL: a scan that matches nothing would pass this test silently. These
  // are writes that exist today, in files this test does not own.
  for (const known of ['lastUpdateVersion', 'usage', 'installed']) {
    assert.ok(found.has(known), `scan found no "${known}" write — the scan is broken, not the code`);
  }
  assert.deepEqual(offenders, []);
});

// `stampSetting` is `init`'s whole write surface, and it is the schema's — so
// the owner check cannot be forgotten by a call site. An `init` that reaches
// for `setAt` directly has walked around `guardWrite` exactly the way the one
// hand-written `if` used to be all that stood in its way.
//
// The other spelling of the same bypass is a plain assignment, and it is the
// one this change actually removed: `manifest.design = { enabled: true }` runs
// no owner check AND replaces the whole subtree, so a `design.gate` a person
// set on the default branch goes back to advisory the next time somebody runs
// `init --with-design`. The scan above sees none of that — the key is one the
// schema knows, so the source scan at the top of this file waves it through.
const SETTING_ROOTS = new Set(
  CONFIG_KEY_NAMES.filter((name) => CONFIG_KEYS[name].owner !== 'tool')
    .map((name) => CONFIG_KEYS[name].path[0]),
);

function settingWrites(text) {
  const direct = [...text.matchAll(/\b(setConfigAt|setAt|unsetAt)\(/g)].map((m) => m[1]);
  for (const m of text.matchAll(/\bmanifest(?:\.([A-Za-z_]\w*)|\['([^']+)'\])\s*=[^=]/g)) {
    const key = m[1] ?? m[2];
    if (SETTING_ROOTS.has(key)) direct.push(`manifest.${key} =`);
  }
  return direct;
}

test('control: settingWrites() catches both spellings, and leaves bookkeeping alone', () => {
  assert.deepEqual(settingWrites('manifest.strictMode = true;'), ['manifest.strictMode =']);
  assert.deepEqual(settingWrites("manifest['design'] = { enabled: true };"), ['manifest.design =']);
  assert.deepEqual(settingWrites('manifest = setAt(manifest, path, v);'), ['setAt']);
  // `installed` is the tool's own, stamped by add/remove; and a read is not a write.
  assert.deepEqual(settingWrites('manifest.installed = [...manifest.installed, entry];'), []);
  assert.deepEqual(settingWrites('if (manifest.strictMode === undefined) {'), []);
});

test('init writes settings only through stampSetting', async () => {
  const main = await readFile(join(ROOT, 'src', 'cli', 'main.ts'), 'utf8');
  assert.ok(/\bstampSetting\(/.test(main), 'control: main.ts does not call stampSetting at all');
  const direct = settingWrites(main);
  assert.deepEqual(direct, [], `main.ts writes a setting without the guard: ${direct}`);
});

// A half-written manifest is a READER's problem — the pre-push hook and the
// Action both read this file while a command may be replacing it, and
// `writeFile` on the live path truncates before it writes. `writeManifestBytes`
// is the one place the bytes are replaced and it renames over the target; the
// inode test in config-command.test.js proves that for `config set`, and this
// one keeps a second writer from reopening the window somewhere else.
function manifestWrites(text) {
  return [...text.matchAll(/\bwriteFile\(([^;]{0,80})/g)]
    .filter((m) => /MANIFEST_FILE|\.clud-bug\.json/.test(m[1]))
    .map((m) => m[1].split('\n')[0].trim());
}

test('control: manifestWrites() catches a writeFile onto the manifest path', () => {
  assert.deepEqual(manifestWrites('await writeFile(join(dir, MANIFEST_FILE), text);'), [
    'join(dir, MANIFEST_FILE), text)',
  ]);
  assert.deepEqual(manifestWrites('await writeFile(tmp, serializeManifest(manifest));'), []);
});

test('nothing writes the manifest path except the rename in writeManifestBytes', async () => {
  const offenders = [];
  for (const dir of [join(ROOT, 'src', 'cli'), join(ROOT, 'src', 'core')]) {
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.ts')) continue;
      for (const call of manifestWrites(await readFile(join(dir, file), 'utf8'))) {
        offenders.push(`${file}: writeFile(${call}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// §6.7 detection has one meaning, and the pre-push hook owns the expression:
// `clud-bug config set tests none` refuses on exactly what that hook will
// detect at push time, or the command hands back a declaration the next push
// blocks.
//
// #253 residual (ruling 1): the hook no longer hand-copies this pattern — it
// `import`s TEST_FILE_PATTERN from src/core/detect.ts and renders it into the
// generated shell script at generation time, so the two are literally the
// same binding, not two literals a future edit can let drift. Two checks,
// because either alone proves less:
//   STATIC — hooks.ts must import the pattern, not re-declare a local copy
//            (a control against the exact regression this ruling fixed).
//   OUTPUT — the byte-for-byte pin ruling 1 asked to keep: the GENERATED
//            script's own grep expression, not just the source text, must
//            carry the identical pattern.
test('hooks.ts imports TEST_FILE_PATTERN from core/detect rather than re-declaring it', async () => {
  const hooks = await readFile(join(ROOT, 'src', 'cli', 'hooks.ts'), 'utf8');
  assert.match(hooks, /import\s*\{[^}]*\bTEST_FILE_PATTERN\b[^}]*\}\s*from\s*['"]\.\.\/core\/detect\.js['"]/);
  assert.doesNotMatch(hooks, /^const TEST_FILE_PATTERN\s*=/m, 'a second, hand-copied literal has crept back in');
});

test('the working-tree test-file detector matches the hook’s base-ref pattern exactly (generated script)', async () => {
  const { buildPrePushHookScript } = await import('../src/cli/hooks.js');
  const script = buildPrePushHookScript();
  const match = /grep -Eiq '([^']*)'/.exec(script);
  assert.ok(match, 'control: no grep -Eiq call in the generated pre-push script — the scan is broken');
  assert.ok(match[1].length > 20, `control: hook pattern came back empty: ${match[1]}`);
  assert.equal(TEST_FILE_PATTERN, match[1]);
});

// Same ONE-owner rule, the other two patterns the pre-push hook shares with
// src/core rather than hand-copying (#253 residual, ruling 1): the npm-init
// test-script placeholder (also shared with detectPackageTestScript, the
// working-tree twin `clud-bug config set tests`'s honesty check uses), and
// the .logmind/config.yml line pattern (shared with parseLogmindTests).
test('hooks.ts imports NPM_INIT_TEST_PLACEHOLDER_PATTERN and LOGMIND_TESTS_LINE_PATTERN rather than hand-copying them', async () => {
  const hooks = await readFile(join(ROOT, 'src', 'cli', 'hooks.ts'), 'utf8');
  assert.match(hooks, /import\s*\{[^}]*\bNPM_INIT_TEST_PLACEHOLDER_PATTERN\b[^}]*\}\s*from\s*['"]\.\.\/core\/detect\.js['"]/);
  assert.match(hooks, /import\s*\{[^}]*\bLOGMIND_TESTS_LINE_PATTERN\b[^}]*\}\s*from\s*['"]\.\.\/core\/tests-declaration\.js['"]/);
});

test('the generated pre-push script embeds NPM_INIT_TEST_PLACEHOLDER_PATTERN and LOGMIND_TESTS_LINE_PATTERN byte-for-byte', async () => {
  const { buildPrePushHookScript } = await import('../src/cli/hooks.js');
  const script = buildPrePushHookScript();
  assert.ok(script.includes(NPM_INIT_TEST_PLACEHOLDER_PATTERN), 'control: the placeholder pattern is not embedded verbatim');
  assert.ok(script.includes(LOGMIND_TESTS_LINE_PATTERN), 'control: the logmind line pattern is not embedded verbatim');
});
