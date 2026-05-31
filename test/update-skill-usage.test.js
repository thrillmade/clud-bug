// CLI tests for `clud-bug update-skill-usage --stdin` (v0.6.29, Component 4).
//
// Verifies the subcommand:
// - reads structured-output JSON from stdin
// - computes the per-skill loads/citations delta
// - merges into .claude/skills/.clud-bug.json atomically
// - is idempotent across repeated runs
// - handles missing/malformed JSON gracefully

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function run(cwd, args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(opts.env || {}) },
    input: opts.input,
  });
}

async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-usage-'));
  await mkdir(join(dir, '.claude', 'skills'), { recursive: true });
  return dir;
}

test('update-skill-usage: errors when --stdin missing', () => {
  const r = run(process.cwd(), ['update-skill-usage']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--stdin is required/);
});

test('update-skill-usage: empty stdin is a no-op (returns 0)', async () => {
  const dir = await makeWorkspace();
  await writeFile(join(dir, '.claude/skills/.clud-bug.json'), '{"version": 1}');
  const r = run(dir, ['update-skill-usage', '--stdin'], { input: '' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /stdin empty/);
});

test('update-skill-usage: malformed JSON exits 2', async () => {
  const dir = await makeWorkspace();
  const r = run(dir, ['update-skill-usage', '--stdin'], { input: 'not-json{{{' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid JSON/);
});

test('update-skill-usage: payload with no skills is a no-op', async () => {
  const dir = await makeWorkspace();
  await writeFile(join(dir, '.claude/skills/.clud-bug.json'), '{"version": 1}');
  const payload = JSON.stringify({ summary: 'no findings', verdict: 'pass' });
  const r = run(dir, ['update-skill-usage', '--stdin'], { input: payload });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /no skills/);
});

test('update-skill-usage: writes usage block on first run', async () => {
  const dir = await makeWorkspace();
  await writeFile(join(dir, '.claude/skills/.clud-bug.json'), '{"version": 1}');
  const payload = JSON.stringify({
    per_skill_scan: [
      { skill: 'critical-issues-only', outcome: 'scanned 3 files' },
      { skill: 'evidence-based-review', outcome: '0 findings' },
    ],
    critical_findings: [
      { skill: 'critical-issues-only', summary: 'nullderef', file: 'a.js', line: 12 },
    ],
  });
  const r = run(dir, ['update-skill-usage', '--stdin'], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(await readFile(join(dir, '.claude/skills/.clud-bug.json'), 'utf8'));
  assert.equal(json.usage['critical-issues-only'].loads, 1);
  assert.equal(json.usage['critical-issues-only'].citations, 1);
  assert.equal(json.usage['evidence-based-review'].loads, 1);
  assert.equal(json.usage['evidence-based-review'].citations, 0);
  assert.ok(json.usage['critical-issues-only'].last_cited);
});

test('update-skill-usage: idempotent accumulation across two runs', async () => {
  const dir = await makeWorkspace();
  await writeFile(join(dir, '.claude/skills/.clud-bug.json'), '{"version": 1}');
  const payload = JSON.stringify({
    per_skill_scan: [{ skill: 'pii-and-compliance', outcome: 'scan' }],
    critical_findings: [{ skill: 'pii-and-compliance', summary: 'pii', file: 'x.js', line: 1 }],
  });
  run(dir, ['update-skill-usage', '--stdin'], { input: payload });
  run(dir, ['update-skill-usage', '--stdin'], { input: payload });
  const json = JSON.parse(await readFile(join(dir, '.claude/skills/.clud-bug.json'), 'utf8'));
  assert.equal(json.usage['pii-and-compliance'].loads, 2);
  assert.equal(json.usage['pii-and-compliance'].citations, 2);
});

test('update-skill-usage: skips with warning when .clud-bug.json missing', async () => {
  const dir = await makeWorkspace();
  // No .clud-bug.json on disk — CLI returns 0 with a stderr note rather
  // than failing the workflow. The workflow template bootstraps an
  // empty shell before invoking, so this path only fires when the
  // workspace is unusual (e.g., a consumer hasn't run `clud-bug init`).
  const payload = JSON.stringify({
    per_skill_scan: [{ skill: 'logmind', outcome: 'scan' }],
  });
  const r = run(dir, ['update-skill-usage', '--stdin'], { input: payload });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /no \.clud-bug\.json/);
});
