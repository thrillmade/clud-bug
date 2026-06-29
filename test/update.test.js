import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runUpdate } from '../src/cli/update.js';
import { DEFAULTS } from '../src/core/render.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(REPO_ROOT, 'templates');
const BASELINE = join(TEMPLATES, 'skills', 'baseline');

// Forced through to loadBaseline so tests don't hit the live agent-skills
// repo or write to the user's real ~/.cache/clud-bug/skills/ dir.
const offlineLoadBaseline = { cacheDir: null, fetch: async () => { throw new Error('test: no network'); } };

async function makeRepo(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-update-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test('runUpdate: short-circuits when no manifest and no workflow exist', async () => {
  const dir = await makeRepo({});
  try {
    const r = await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.3.0',
      loadBaselineOpts: offlineLoadBaseline,
    });
    assert.equal(r.missing, 'init');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: rewrites stale-marker workflow + baseline; leaves custom skills alone', async () => {
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    // Stale marker (v0) — eligible for refresh under marker-driven mode.
    '.github/workflows/clud-bug-review.yml': '# clud-bug-template-version: v0\n# old contents\n',
    '.claude/skills/.clud-bug.json': JSON.stringify({
      version: 1,
      installed: [
        { slug: 'critical-issues-only', kind: 'baseline' },
        { slug: 'evidence-based-review', kind: 'baseline' },
        { slug: 'respect-existing-conventions', kind: 'baseline' },
      ],
    }),
    '.claude/skills/critical-issues-only/SKILL.md': '# stale baseline content\n',
    '.claude/skills/my-team-rules/SKILL.md': '---\nname: my-team-rules\ndescription: ours\n---\n# Hands off\n',
  });
  try {
    const r = await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.3.0',
      loadBaselineOpts: offlineLoadBaseline,
    });
    // Workflow refreshed
    const wf = await readFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'utf8');
    assert.match(wf, /allowedTools/);
    assert.match(wf, /^# clud-bug-template-version: v14/);
    // Baseline rewritten with current shipped content
    const baseline = await readFile(join(dir, '.claude/skills/critical-issues-only/SKILL.md'), 'utf8');
    assert.match(baseline, /critical-issues-only/);
    assert.doesNotMatch(baseline, /stale baseline content/);
    // Custom skill untouched
    const custom = await readFile(join(dir, '.claude/skills/my-team-rules/SKILL.md'), 'utf8');
    assert.match(custom, /Hands off/);
    // Manifest stamped
    const manifest = JSON.parse(await readFile(join(dir, '.claude/skills/.clud-bug.json'), 'utf8'));
    assert.equal(manifest.lastUpdateVersion, '0.3.0');
    assert.ok(manifest.lastUpdate);
    // The refreshed workflow records a from/to version note.
    const wfChange = r.changed.find((c) => c.label === 'review workflow');
    assert.equal(wfChange.from, 'v0');
    assert.equal(wfChange.to, 'v14');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: markerless workflow is preserved + reported as skipped', async () => {
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    // No `# clud-bug-template-version:` header — treat as user-customized.
    '.github/workflows/clud-bug-review.yml': 'name: My Custom Review\n# hand-edited by the team\n',
    '.claude/skills/.clud-bug.json': JSON.stringify({ version: 1, installed: [] }),
  });
  try {
    const r = await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.5.7',
      loadBaselineOpts: offlineLoadBaseline,
    });
    // Markerless file is preserved byte-for-byte.
    const wf = await readFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'utf8');
    assert.equal(wf, 'name: My Custom Review\n# hand-edited by the team\n');
    // Skipped list surfaces the file with a recovery hint.
    const skipped = r.skipped ?? [];
    const wfSkip = skipped.find((s) => s.label === 'review workflow');
    assert.ok(wfSkip, 'expected review workflow to be reported as skipped');
    assert.match(wfSkip.reason, /markerless/);
    assert.match(wfSkip.reason, /clud-bug init/);
    // Workflow itself is not in `changed`.
    assert.ok(!r.changed.some((c) => c.label === 'review workflow'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: current-marker workflow with matching contents is a no-op', async () => {
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    '.claude/skills/.clud-bug.json': JSON.stringify({ version: 1, installed: [] }),
    // Start with a stale-marker file so the first run refreshes it.
    '.github/workflows/clud-bug-review.yml': '# clud-bug-template-version: v0\n# stale\n',
  });
  try {
    // First pass refreshes to v1.
    await runUpdate({ cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.5.7', loadBaselineOpts: offlineLoadBaseline });
    const after1 = await readFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'utf8');
    // Second pass: marker is current AND content byte-matches → unchanged.
    const r2 = await runUpdate({ cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.5.7', loadBaselineOpts: offlineLoadBaseline });
    assert.ok(!r2.changed.some((c) => c.label === 'review workflow'), 'second run should not refresh workflow');
    const after2 = await readFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'utf8');
    assert.equal(after1, after2, 'byte-stable across consecutive update runs');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: no-ops when files already match latest', async () => {
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    '.claude/skills/.clud-bug.json': JSON.stringify({ version: 1, installed: [] }),
    // Stale-marker so first run refreshes (not skipped); second run no-ops.
    '.github/workflows/clud-bug-review.yml': '# clud-bug-template-version: v0\n# placeholder\n',
  });
  try {
    // First run — writes everything.
    await runUpdate({ cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.3.0', loadBaselineOpts: offlineLoadBaseline });
    // Second run — should detect everything is current.
    const r = await runUpdate({ cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.3.0', loadBaselineOpts: offlineLoadBaseline });
    assert.equal(r.changed.length, 0, 'second run should be a no-op');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: excludedBaselines skips writing the listed slug', async () => {
  // A consumer repo can opt out of any bundled baseline by listing its
  // slug in `excludedBaselines`. Without this, every `clud-bug update`
  // regenerates the baseline file from the bundled copy regardless of
  // local manifest state — the original symptom this field exists to fix.
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    '.github/workflows/clud-bug-review.yml': '# clud-bug-template-version: v0\n# stale\n',
    '.claude/skills/.clud-bug.json': JSON.stringify({
      version: 1,
      installed: [{ slug: 'critical-issues-only', kind: 'baseline' }],
      excludedBaselines: ['clud-bug-collaboration'],
    }),
  });
  try {
    await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.6.0',
      loadBaselineOpts: offlineLoadBaseline,
    });
    // Excluded baseline is NOT written.
    await assert.rejects(
      readFile(join(dir, '.claude/skills/clud-bug-collaboration/SKILL.md'), 'utf8'),
      { code: 'ENOENT' },
    );
    // Non-excluded baseline is still written.
    const kept = await readFile(join(dir, '.claude/skills/critical-issues-only/SKILL.md'), 'utf8');
    assert.match(kept, /critical-issues-only/);
    // Manifest's excludedBaselines survives the write (passthrough).
    const manifest = JSON.parse(await readFile(join(dir, '.claude/skills/.clud-bug.json'), 'utf8'));
    assert.deepEqual(manifest.excludedBaselines, ['clud-bug-collaboration']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: excludedBaselines removes a pre-existing skill dir + reports in changed', async () => {
  // Migration path: a repo that previously had the baseline installed,
  // then added the slug to excludedBaselines, should have the dir cleaned
  // up on the next update — not left behind for the user to rm by hand.
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    '.github/workflows/clud-bug-review.yml': '# clud-bug-template-version: v0\n# stale\n',
    '.claude/skills/.clud-bug.json': JSON.stringify({
      version: 1,
      installed: [],
      excludedBaselines: ['clud-bug-collaboration'],
    }),
    // Pre-existing stale baseline dir that the exclusion should sweep.
    '.claude/skills/clud-bug-collaboration/SKILL.md': '# stale content from a prior install\n',
  });
  try {
    const r = await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.6.0',
      loadBaselineOpts: offlineLoadBaseline,
    });
    await assert.rejects(
      readFile(join(dir, '.claude/skills/clud-bug-collaboration/SKILL.md'), 'utf8'),
      { code: 'ENOENT' },
    );
    const removal = r.changed.find((c) => c.label === 'excluded baseline clud-bug-collaboration: removed');
    assert.ok(removal, 'expected the removal to surface in changed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: re-renders audit + self-update workflows when installed (stale marker)', async () => {
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    '.github/workflows/clud-bug-review.yml': '# clud-bug-template-version: v0\n# stale review\n',
    '.github/workflows/clud-bug-audit.yml': '# clud-bug-template-version: v0\n# stale audit\n',
    '.github/workflows/clud-bug-self-update.yml': '# clud-bug-template-version: v0\n# stale self-update\n',
    '.claude/skills/.clud-bug.json': JSON.stringify({ version: 1, installed: [] }),
  });
  try {
    const r = await runUpdate({ cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.3.0', loadBaselineOpts: offlineLoadBaseline });
    const audit = await readFile(join(dir, '.github/workflows/clud-bug-audit.yml'), 'utf8');
    assert.match(audit, /Clud Bug 🐛 Audit/);
    assert.ok(r.changed.some((c) => c.label === 'audit workflow'));
    // v0.5.11 regression guard: audit must flow through renderFile so
    // {{CCA_VERSION}} substitution lands. The pre-v0.5.11 readFile path
    // would leak the literal placeholder into installed workflows. Both
    // bots on PR #60 caught the test gap — pin the wiring at this layer.
    const ccaPin = DEFAULTS.CCA_VERSION.replace(/\./g, '\\.');
    assert.match(audit, new RegExp(`claude-code-action@${ccaPin}`));
    assert.doesNotMatch(audit, /\{\{CCA_VERSION\}\}/);
    const selfUpd = await readFile(join(dir, '.github/workflows/clud-bug-self-update.yml'), 'utf8');
    assert.match(selfUpd, /Self-Update/);
    assert.ok(r.changed.some((c) => c.label === 'self-update workflow'));
    // Same regression guard for self-update — no CCA ref today but the
    // file must not contain ANY unsubstituted {{X}} placeholders, which
    // would indicate renderFile silently regressed back to readFile.
    assert.doesNotMatch(selfUpd, /\{\{[A-Z_]+\}\}/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runUpdate: a --local-only repo (manifest, no workflow) does NOT get a review workflow created', async () => {
  // Max-mode install: installed skills + a hook, but NO clud-bug-review.yml.
  // update must REFRESH what is installed, never ADD the API-key Action.
  const dir = await makeRepo({
    'package.json': JSON.stringify({ name: 'demo' }),
    '.claude/skills/.clud-bug.json': JSON.stringify({
      version: 1,
      installed: [{ slug: 'critical-issues-only', kind: 'baseline' }],
    }),
    '.claude/skills/critical-issues-only/SKILL.md': '# baseline\n',
  });
  try {
    await runUpdate({
      cwd: dir, templatesDir: TEMPLATES, baselineDir: BASELINE, ourVersion: '0.3.0',
      loadBaselineOpts: offlineLoadBaseline,
    });
    let created = true;
    try {
      await readFile(join(dir, '.github/workflows/clud-bug-review.yml'), 'utf8');
    } catch {
      created = false;
    }
    assert.equal(created, false, 'update must not create the review workflow in a workflow-less (local-only) repo');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
