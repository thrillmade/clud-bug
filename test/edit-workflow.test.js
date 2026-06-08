import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isWorkflowFile, makeBranchName, getPendingWorkflowEdits } from '../lib/edit-workflow.js';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-edit-wf-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@test');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'README.md'), 'baseline\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('isWorkflowFile: matches clud-bug-*.yml in .github/workflows', () => {
  assert.equal(isWorkflowFile('.github/workflows/clud-bug-review.yml'), true);
  assert.equal(isWorkflowFile('.github/workflows/clud-bug-audit.yml'), true);
  assert.equal(isWorkflowFile('.github/workflows/clud-bug-self-update.yml'), true);
  assert.equal(isWorkflowFile('.github/workflows/clud-bug-review.yaml'), true);
});

test('isWorkflowFile: does not match unrelated files', () => {
  assert.equal(isWorkflowFile('.github/workflows/ci.yml'), false);
  assert.equal(isWorkflowFile('.github/workflows/claude-code-review.yml'), false);
  assert.equal(isWorkflowFile('templates/workflow.yml.tmpl'), false);
  assert.equal(isWorkflowFile('package.json'), false);
  assert.equal(isWorkflowFile('clud-bug-review.yml'), false);
});

test('makeBranchName: ISO timestamp slug', () => {
  const branch = makeBranchName(new Date('2026-05-15T07:30:45Z'));
  assert.equal(branch, 'clud-bug/edit-workflow-2026-05-15T07-30-45');
});

test('getPendingWorkflowEdits: empty working tree', async () => {
  const dir = await makeRepo();
  try {
    const r = getPendingWorkflowEdits(dir);
    assert.equal(r.allWorkflow, true);
    assert.equal(r.files.length, 0);
    assert.equal(r.nonWorkflow.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('getPendingWorkflowEdits: only workflow changes → allWorkflow true', async () => {
  const dir = await makeRepo();
  try {
    await mkdir(join(dir, '.github/workflows'), { recursive: true });
    await writeFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'name: x\n');
    const r = getPendingWorkflowEdits(dir);
    assert.equal(r.allWorkflow, true);
    assert.deepEqual(r.files, ['.github/workflows/clud-bug-review.yml']);
    assert.deepEqual(r.nonWorkflow, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('getPendingWorkflowEdits: mixed changes → allWorkflow false, nonWorkflow listed', async () => {
  const dir = await makeRepo();
  try {
    await mkdir(join(dir, '.github/workflows'), { recursive: true });
    await writeFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'name: x\n');
    await writeFile(join(dir, 'src.ts'), 'export {};\n');
    const r = getPendingWorkflowEdits(dir);
    assert.equal(r.allWorkflow, false);
    assert.deepEqual(r.nonWorkflow.sort(), ['src.ts']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('getPendingWorkflowEdits: only non-workflow changes → allWorkflow false', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(join(dir, 'package.json'), '{}\n');
    const r = getPendingWorkflowEdits(dir);
    assert.equal(r.allWorkflow, false);
    assert.deepEqual(r.nonWorkflow, ['package.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('getPendingWorkflowEdits: ignores non-clud-bug workflow files', async () => {
  // Editing .github/workflows/ci.yml is NOT a clud-bug workflow edit;
  // the guard should treat it as non-workflow (so the user's mixed
  // CI tweak doesn't get bundled with workflow-self-mod-protected files).
  const dir = await makeRepo();
  try {
    await mkdir(join(dir, '.github/workflows'), { recursive: true });
    await writeFile(join(dir, '.github/workflows/ci.yml'), 'name: ci\n');
    const r = getPendingWorkflowEdits(dir);
    assert.equal(r.allWorkflow, false);
    assert.deepEqual(r.nonWorkflow, ['.github/workflows/ci.yml']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
