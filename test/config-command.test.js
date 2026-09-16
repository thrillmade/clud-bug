// `clud-bug config` — SPEC 2.0 §1.6:260's "Every named setting MUST be
// settable by a command, and nobody should need to hand-edit the file", and
// §1.6:262's "A tool asked to weaken one of these by an agent MUST refuse and
// say why" (clud-bug#271).
//
// End-to-end through the real binary, because the exit code IS the contract a
// script consumes: 0 ok · 1 I/O or a file this tool will not overwrite ·
// 2 unknown key · 3 value outside the domain · 4 refused.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { chmod, mkdtemp, writeFile, mkdir, readdir, rm, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import {
  HONEST_GUARANTEE, NAMED_CONFIG_KEYS, CONFIG_KEYS, NOT_IN_SPEC,
} from '../src/core/config-schema.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');
const MANIFEST = join('.claude', 'skills', '.clud-bug.json');

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** The same run, started now and awaited later — for the concurrency test. */
function runAsync(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function makeRepo(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-config-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

const BASE_MANIFEST = `{
  "version": 1,
  "installed": [],
  "somethingThisVersionNeverHeardOf": {
    "nested": [1, 2, 3]
  },
  "ciChecks": [
    "build"
  ]
}
`;

test('config list names every settable key, its default and who may write it', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'list']);
    assert.equal(r.status, 0, r.stderr);
    for (const key of NAMED_CONFIG_KEYS) {
      assert.ok(r.stdout.includes(key), `missing ${key}`);
    }
    // §1.6:247 — a tool's own state is not a setting, so it is not offered.
    assert.equal(r.stdout.includes('last_update_version'), false);
    // The humans-only keys say so where a person reads them.
    assert.match(r.stdout, /review\.strict_mode.*\n?.*humans only|humans only.*review\.strict_mode/s);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config list --json is machine-readable and carries owner + spec per key', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'list', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout);
    const entry = payload.settings.find((s) => s.key === 'review.ci_checks');
    assert.deepEqual(entry.value, ['build']);
    assert.equal(entry.source, 'file');
    assert.equal(entry.owner, 'agent');
    assert.equal(entry.spec, '§4.7');
    const strict = payload.settings.find((s) => s.key === 'review.strict_mode');
    assert.equal(strict.owner, 'human');
    assert.equal(strict.source, 'default');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A section number next to a setting that section never mentions is a
// citation a reader goes and checks, so it has to be real or absent.
test('config list says plainly where SPEC 2.0 names no section, instead of citing one', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'list']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(NOT_IN_SPEC), 'config list must say when there is no section');
    const pinLine = r.stdout.split('\n').find((l) => l.includes('Pin clud-bug'));
    assert.ok(pinLine, 'control: pin_version must be in the listing at all');
    assert.equal(/§/.test(pinLine), false, `pin_version still cites a section: ${pinLine}`);
    // Control: a setting SPEC does name still carries its section.
    const ciLine = r.stdout.split('\n').find((l) => l.includes('Narrows which CI checks'));
    assert.match(ciLine, /§4\.7/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config get prints the value from the file, and the documented default when absent', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const set = run(dir, ['config', 'get', 'review.ci_checks']);
    assert.equal(set.status, 0, set.stderr);
    assert.equal(set.stdout, '["build"]\n');

    const absent = run(dir, ['config', 'get', 'review.trigger']);
    assert.equal(absent.status, 0, absent.stderr);
    assert.equal(absent.stdout, '"push"\n');

    const json = run(dir, ['config', 'get', 'review.trigger', '--json']);
    assert.deepEqual(JSON.parse(json.stdout), {
      key: 'review.trigger',
      value: 'push',
      source: 'default',
      owner: 'agent',
      spec: '§4.1',
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// §1.6:243 — "any tool that rewrites the file MUST round-trip [an
// unrecognised] key unchanged".
test('config set rewrites only the setting asked for; every other byte survives', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'set', 'review.ci_checks', '["build","typecheck"]']);
    assert.equal(r.status, 0, r.stderr);
    const after = await readFile(join(dir, MANIFEST), 'utf8');
    assert.equal(after, `{
  "version": 1,
  "installed": [],
  "somethingThisVersionNeverHeardOf": {
    "nested": [
      1,
      2,
      3
    ]
  },
  "ciChecks": [
    "build",
    "typecheck"
  ]
}
`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set creates the manifest when the repository has none', async () => {
  const dir = await makeRepo({});
  try {
    const r = run(dir, ['config', 'set', 'tests', 'npm test']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')).tests, 'npm test');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// #271 ruling 5 — an unrecognized `--flag` after the value used to be folded
// silently into it (`rest.join(' ')` joined every remaining token, flags
// included), so a typo'd or invented flag never errored — it just corrupted
// the value written. `config set` takes no flags of its own.
test('config set refuses an unrecognized flag instead of folding it into the value', async () => {
  const dir = await makeRepo({});
  try {
    const r = run(dir, ['config', 'set', 'tests', 'none', '--cwd', dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown flag "--cwd"/);
    // Nothing was written — a refused parse writes no manifest at all.
    const wrote = await stat(join(dir, '.claude', 'skills', '.clud-bug.json')).then(() => true, () => false);
    assert.equal(wrote, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config unset removes an agent-owned key and leaves the rest alone', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'unset', 'review.ci_checks']);
    assert.equal(r.status, 0, r.stderr);
    const after = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
    assert.equal('ciChecks' in after, false);
    assert.deepEqual(after.somethingThisVersionNeverHeardOf, { nested: [1, 2, 3] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// §1.6:262 — the refusal this whole issue exists for.
test('config set refuses review.strict_mode, says why, and writes nothing', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'set', 'review.strict_mode', 'false']);
    assert.equal(r.status, 4);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /refusing to set review\.strict_mode/);
    assert.match(r.stderr, /§1\.6/);
    assert.match(r.stderr, /A person sets it by editing "strictMode" in \.claude\/skills\/\.clud-bug\.json/);
    // The claim never grows past what it can keep.
    assert.ok(r.stderr.includes(HONEST_GUARANTEE), 'refusal must carry the honest guarantee verbatim');
    assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), BASE_MANIFEST);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A refusal writes no manifest, and — however it left — releases the lock it
// took to decide. A leaked lock is the failure mode that turns one bad run
// into every later `config set` waiting on a file nobody holds.
test('a refused config set writes no manifest and leaves no lock behind', async () => {
  const dir = await makeRepo({});
  const skills = join(dir, '.claude', 'skills');
  try {
    assert.equal(run(dir, ['config', 'set', 'review.strict_mode', 'false']).status, 4);
    assert.equal(run(dir, ['config', 'unset', 'design.gate']).status, 4);
    assert.equal(run(dir, ['config', 'set', 'installed', '[]']).status, 4);
    assert.deepEqual(await readdir(skills), []);
    // Control: a write this command DOES accept lands, and clears up after itself.
    assert.equal(run(dir, ['config', 'set', 'review.trigger', 'both']).status, 0);
    assert.deepEqual(await readdir(skills), ['.clud-bug.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set refuses every humans-only key, and only those', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const values = {
      'review.strict_mode': 'false',
      'review.auto_fix': '{"mode":"off"}',
      'review.passes.blocking': '[]',
      'review.strict_skills': '[]',
      'design.gate': 'advisory',
    };
    for (const [key, value] of Object.entries(values)) {
      assert.equal(CONFIG_KEYS[key].owner, 'human', key);
      const r = run(dir, ['config', 'set', key, value]);
      assert.equal(r.status, 4, `${key} → ${r.status}: ${r.stderr}`);
    }
    // …and an agent-owned neighbour in the same block still goes through.
    assert.equal(run(dir, ['config', 'set', 'design.enabled', 'true']).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config unset refuses a humans-only key — an absent gate setting is a weaker one', async () => {
  const dir = await makeRepo({
    [MANIFEST]: '{\n  "version": 1,\n  "installed": [],\n  "strictMode": true\n}\n',
  });
  try {
    const r = run(dir, ['config', 'unset', 'review.strict_mode']);
    assert.equal(r.status, 4);
    assert.match(await readFile(join(dir, MANIFEST), 'utf8'), /"strictMode": true/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set refuses a whole-block write that would drop a humans-only key nested in it', async () => {
  const manifest = `{
  "version": 1,
  "installed": [],
  "reviewPasses": {
    "count": 2,
    "blocking": [
      "design"
    ]
  }
}
`;
  const dir = await makeRepo({ [MANIFEST]: manifest });
  try {
    const r = run(dir, ['config', 'set', 'review.passes', '{"count":3}']);
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /review\.passes\.blocking/);
    assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), manifest);

    // Carrying it through unchanged is fine — the refusal is about the
    // humans-only value, not about the block it sits in.
    const ok = run(dir, ['config', 'set', 'review.passes', '{"count":3,"blocking":["design"]}']);
    assert.equal(ok.status, 0, ok.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set refuses a tool-owned key without pretending it is a gate setting', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'set', 'installed', '[]']);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /clud-bug's own bookkeeping/);
    assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), BASE_MANIFEST);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// §1.6:260 — "refusing a value the setting cannot take and saying what it can".
test('config set refuses a value outside the domain and names the domain', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'set', 'review.trigger', 'nightly']);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /review\.trigger cannot take "nightly"/);
    assert.match(r.stderr, /commit, push, or both/);
    assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), BASE_MANIFEST);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set refuses an unknown key with a did-you-mean', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const near = run(dir, ['config', 'set', 'review.strictmode', 'true']);
    assert.equal(near.status, 2);
    assert.match(near.stderr, /did you mean review\.strict_mode\?/);

    const far = run(dir, ['config', 'get', 'not_a_setting_at_all']);
    assert.equal(far.status, 2);
    assert.match(far.stderr, /clud-bug config list/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// The `readManifest` data-loss bug this command must never inherit: a
// swallowed parse error used to return a FRESH EMPTY manifest, and the write
// that followed deleted the repository's whole configuration.
test('config set on a malformed file exits 1 and leaves the file byte-identical', async () => {
  const broken = '{\n  "strictMode": true,,\n}\n';
  const dir = await makeRepo({ [MANIFEST]: broken });
  try {
    const r = run(dir, ['config', 'set', 'tests', 'npm test']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), broken);

    const get = run(dir, ['config', 'get', 'review.ci_checks']);
    assert.equal(get.status, 1, 'a read must not report defaults over a file it could not parse');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Only ENOENT means "no manifest yet". Any other read failure used to read as
// one, and the write that followed persisted the fresh empty object — the same
// total loss as the parse error above, at exit 0.
test('config set on a file it cannot read exits 1 and replaces nothing', async (ctx) => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  const path = join(dir, MANIFEST);
  try {
    // Writable, unreadable: the exact shape that loses the file, because the
    // write that follows a swallowed read succeeds.
    await chmod(path, 0o222);
    let denied = true;
    try { await readFile(path, 'utf8'); denied = false; } catch { /* EACCES */ }
    // Root reads a 0222 file regardless, so the OS cannot produce the failure
    // this pins; skipping is honest, passing vacuously would not be.
    if (!denied) ctx.skip();

    const r = run(dir, ['config', 'set', 'review.trigger', 'both']);
    assert.equal(r.status, 1, `exit ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /could not be read/);
    await chmod(path, 0o644);
    assert.equal(await readFile(path, 'utf8'), BASE_MANIFEST);
  } finally {
    await chmod(path, 0o644).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

// §6.7 — "Detection is what makes `none` honest: it cannot be pasted into a
// repository the detector can see has tests."
test('config set tests none is refused where a suite is detectable', async () => {
  const dir = await makeRepo({
    [MANIFEST]: BASE_MANIFEST,
    'package.json': JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }, null, 2),
  });
  try {
    const r = run(dir, ['config', 'set', 'tests', 'none']);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /vitest run/);
    assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), BASE_MANIFEST);

    // The real command is always allowed.
    assert.equal(run(dir, ['config', 'set', 'tests', 'vitest run']).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// §6.7's detector is the pre-push hook's, and the hook reads test FILES off
// the base ref as well as `scripts.test` (TEST_FILE_PATTERN, src/cli/hooks.ts).
// A `none` accepted here on a repository full of `*.test.ts` is a declaration
// the very next push blocks — the contradiction this refusal exists to catch,
// landed at exit 0.
test('config set tests none is refused on a suite no package.json test script names', async () => {
  const shapes = {
    'src/thing.test.ts': 'export {};\n',
    'tests/test_thing.py': 'def test_x():\n    pass\n',
    'pkg/thing_test.go': 'package pkg\n',
    'spec/thing_spec.rb': '# spec\n',
    '__tests__/thing.js': 'test("x", () => {});\n',
  };
  for (const [path, content] of Object.entries(shapes)) {
    const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST, [path]: content });
    try {
      const r = run(dir, ['config', 'set', 'tests', 'none']);
      assert.equal(r.status, 3, `${path} → ${r.status}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes(path), `refusal must name what it saw, got: ${r.stderr}`);
      // No script to suggest, so it must still say what to do instead.
      assert.match(r.stderr, /clud-bug config set tests/);
      assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), BASE_MANIFEST);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

// The other direction: source files that merely live near tests are not a
// suite, or the honest declaration becomes unwritable.
test('config set tests none is allowed on a repository whose files only look like code', async () => {
  const dir = await makeRepo({
    [MANIFEST]: BASE_MANIFEST,
    'src/index.ts': 'export const x = 1;\n',
    'src/latest.tsx': 'export const y = 2;\n',
    'docs/protest.md': '# not a suite\n',
  });
  try {
    const r = run(dir, ['config', 'set', 'tests', 'none']);
    assert.equal(r.status, 0, `${r.status}: ${r.stderr}`);
    assert.equal(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')).tests, 'none');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A value every reader trims back to `none` IS `none` — so the refusal has to
// see it as one. Otherwise one trailing space walks past §6.7's honesty rule
// and lands a declaration `readTestsDeclaration` and the pre-push hook both
// resolve to exactly the refused value.
test('config set tests none is refused however it is padded', async () => {
  const dir = await makeRepo({
    [MANIFEST]: BASE_MANIFEST,
    'package.json': JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }, null, 2),
  });
  try {
    for (const padded of ['none ', ' none', ' none ', '\tnone\n']) {
      const r = run(dir, ['config', 'set', 'tests', padded]);
      assert.equal(r.status, 3, `${JSON.stringify(padded)} → ${r.status}: ${r.stderr}`);
      assert.equal(await readFile(join(dir, MANIFEST), 'utf8'), BASE_MANIFEST);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// The other half of the same rule: what lands on disk is what a reader
// resolves, so a padded command is never a second spelling of the value.
test('config set stores the tests declaration a reader resolves, not the padding', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'set', 'tests', '  npm test  ']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')).tests, 'npm test');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config set tests none is allowed where no suite is detectable', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const r = run(dir, ['config', 'set', 'tests', 'none']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')).tests, 'none');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// §1.6:260 — "its non-interactive form MUST be scriptable — the same command
// in a terminal and in a workflow". A refusal that keys on an agent marker
// would be both spoofable and a different command in CI.
test('the same command gives the same answer under CI and agent-harness env markers', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  const agentEnv = { CI: 'true', CLAUDE_CODE: '1', GITHUB_ACTIONS: 'true', TERM: 'dumb' };
  try {
    const plain = run(dir, ['config', 'set', 'review.strict_mode', 'true']);
    const harness = run(dir, ['config', 'set', 'review.strict_mode', 'true'], agentEnv);
    assert.equal(plain.status, 4);
    assert.equal(harness.status, plain.status);
    assert.equal(harness.stderr, plain.stderr);

    const getPlain = run(dir, ['config', 'get', 'review.ci_checks']);
    const getHarness = run(dir, ['config', 'get', 'review.ci_checks'], agentEnv);
    assert.equal(getHarness.stdout, getPlain.stdout);
    assert.equal(getHarness.status, getPlain.status);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// `config set` is a read-modify-write, and concurrent ones lost whole keys:
// each read the same bytes, each wrote its own one-key edit over them, and the
// settings the losers had written were simply gone — at exit 0, with nothing
// on stderr. A configuration that silently drops what you just set is worse
// than one that refuses, so every write is serialized.
test('concurrent config set invocations all land, and drop nothing they did not touch', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const writes = [
      ['review.trigger', 'both'],
      ['tests', 'npm test'],
      ['review.notary', 'false'],
      ['pin_version', '0.7.0'],
      ['design.enabled', 'true'],
      ['review_context', 'focus on the diff'],
      ['review.cost_cap_usd', '5'],
      ['excluded_baselines', '["design"]'],
    ];
    const results = await Promise.all(writes.map(([key, value]) =>
      runAsync(dir, ['config', 'set', key, value])));
    results.forEach((r, i) => {
      assert.equal(r.status, 0, `${writes[i][0]} → ${r.status}: ${r.stdout}${r.stderr}`);
    });

    const after = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
    assert.deepEqual(
      {
        reviewTrigger: after.reviewTrigger,
        tests: after.tests,
        notary: after.notary,
        pinVersion: after.pinVersion,
        design: after.design,
        reviewContext: after.reviewContext,
        perPrCapUsd: after.perPrCapUsd,
        excludedBaselines: after.excludedBaselines,
      },
      {
        reviewTrigger: 'both',
        tests: 'npm test',
        notary: false,
        pinVersion: '0.7.0',
        design: { enabled: true },
        reviewContext: 'focus on the diff',
        perPrCapUsd: 5,
        excludedBaselines: ['design'],
      },
    );
    // §1.6:243 — the key none of them had heard of survives all eight.
    assert.deepEqual(after.somethingThisVersionNeverHeardOf, { nested: [1, 2, 3] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// The lock above serializes clud-bug's own writers. It says nothing about a
// READER that arrives mid-write — the pre-push hook, the Action, a `config
// get` — and an in-place write is a window in which that reader gets half a
// file. The concurrency repro hit exactly that ("Unexpected end of JSON input"
// on a file nobody had corrupted). The write is a rename over the target
// instead, and from outside the process the way to tell those apart is the
// inode: writing in place keeps it, replacing the file does not.
test('config set replaces the manifest rather than writing over it in place', async () => {
  const dir = await makeRepo({ [MANIFEST]: BASE_MANIFEST });
  try {
    const before = await stat(join(dir, MANIFEST));
    assert.equal(run(dir, ['config', 'set', 'review.trigger', 'both']).status, 0);
    const after = await stat(join(dir, MANIFEST));
    assert.notEqual(after.ino, before.ino, 'the manifest was written in place, half-file and all');
    // Control: it is the same path, holding the new value — not a file moved aside.
    assert.equal(JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')).reviewTrigger, 'both');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('clud-bug --help documents config and the humans-only refusal', () => {
  const r = run(process.cwd(), ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /config .*get|config get/);
  assert.match(r.stdout, /humans only/i);
});
