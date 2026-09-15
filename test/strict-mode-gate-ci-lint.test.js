// #291: .github/actions/strict-mode-gate/action.yml is checked into this
// repo but was reachable by NEITHER actionlint path before this fix.
//
// Passed directly, actionlint expects a workflow (`jobs:`/`on:`) and fails
// on schema before it reads the action's own content at all — confirmed
// against actionlint v1.7.12: `actionlint
// .github/actions/strict-mode-gate/action.yml` errors `"jobs" section is
// missing`. And actionlint's own docs say it reads a local action's
// metadata (required/unknown `with:` inputs, `name`/`description`/
// `runs.using`) only when a workflow reaches it through a LOCAL
// `uses: ./...` step — a REMOTE ref (what the shipped templates use:
// `thrillmade/clud-bug/...@vX`) resolves from actionlint's bundled
// popular-actions data, never this repo's own file.
//
// ci.yml's "Lint own workflows" step now closes that by generating a
// throwaway workflow with a local `uses:` of the composite and linting it
// (verified by hand against actionlint v1.7.12: exit 0 today, and exit 1
// against a deliberately broken `inputs:`/`description:` — a regression
// the old two-file loop passed straight through). This test locks the
// generating step in place so a future edit can't silently drop it.
//
// It does NOT re-run actionlint itself (that needs the actionlint binary,
// which CI downloads and this test suite does not) — it asserts the
// SHAPE of what ci.yml generates and feeds to it, the same way
// release-discipline.test.js locks other CI shell fragments in by content
// rather than by executing them.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function lintOwnWorkflowsStep() {
  const doc = parseYaml(await readFile(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const steps = doc.jobs.actionlint.steps;
  const step = steps.find((s) => s && s.name === 'Lint own workflows');
  assert.ok(step, "ci.yml actionlint job: no 'Lint own workflows' step");
  return step;
}

test("#291: 'Lint own workflows' generates a workflow with a LOCAL uses: of the strict-mode-gate composite", async () => {
  const step = await lintOwnWorkflowsStep();
  assert.match(
    step.run,
    /uses:\s*\.\/\.github\/actions\/strict-mode-gate/,
    "the generated probe must reference the composite via a LOCAL './...' path — a remote '@vX' ref resolves from actionlint's bundled data and never reads this repo's own action.yml",
  );
});

test("#291: the generated probe supplies the composite's required github-token input", async () => {
  const step = await lintOwnWorkflowsStep();
  // Without this, actionlint's own "missing input" finding would fire on
  // every run for a reason that has nothing to do with a real regression,
  // training the job to be ignored.
  assert.match(step.run, /github-token:\s*\S+/, 'probe workflow must set github-token: under with:');
});

test('#291: the generated probe is written under .ci-rendered (gitignored — this is a lint fixture, not a real workflow)', async () => {
  const step = await lintOwnWorkflowsStep();
  assert.match(
    step.run,
    /\.ci-rendered\/strict-mode-gate-probe\.yml/,
    'probe must be written under .ci-rendered, matching the templates-render fixture convention earlier in this same job',
  );
});

test('#291: the actionlint loop actually lints the generated probe file', async () => {
  const step = await lintOwnWorkflowsStep();
  const forLoopMatch = step.run.match(/for wf in([\s\S]*?)do/);
  assert.ok(forLoopMatch, "'Lint own workflows' must still loop over a wf list — the probe has to be an entry in it, not just generated and ignored");
  assert.match(
    forLoopMatch[1],
    /\.ci-rendered\/strict-mode-gate-probe\.yml/,
    'the generated probe path must be one of the for-loop entries actionlint is actually invoked on',
  );
});

test('#291: the actionlint loop does not reference a nonexistent workflow file', async () => {
  const step = await lintOwnWorkflowsStep();
  const forLoopMatch = step.run.match(/for wf in([\s\S]*?)do/);
  assert.ok(forLoopMatch, "'Lint own workflows' must still loop over a wf list");
  // The loop's own `if [ -f "$wf" ]; then ... fi` guard hides a stale entry
  // rather than catching one — it was written so a workflow this repo
  // hasn't rendered yet doesn't fail CI, not to excuse listing a file that
  // no longer exists at all. Every entry that isn't the probe this same
  // step generates must be a real, tracked path.
  const entries = forLoopMatch[1]
    .replace(/\\\n/g, ' ')
    .split(/\s+/)
    .map((s) => s.replace(/;$/, ''))
    .filter(Boolean);
  assert.ok(entries.length > 0, 'expected at least one wf entry in the for loop');
  for (const entry of entries) {
    if (entry === '.ci-rendered/strict-mode-gate-probe.yml') continue; // generated by this same step, not tracked
    assert.ok(existsSync(join(REPO_ROOT, entry)), `'Lint own workflows' loop references '${entry}', which does not exist in this repo`);
  }
});
