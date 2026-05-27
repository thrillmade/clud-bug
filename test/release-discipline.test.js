import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// --- v0.5.15: lock-step contract between package.json and composite pin ---
//
// The composite strict-mode-gate action calls into lib/skills.js via:
//   SKILLS_LIB="${{ github.action_path }}/../../../lib/skills.js"
// `github.action_path` resolves to the composite's OWN checkout at the
// pinned tag — NOT the consumer's repo, NOT the latest from main.
//
// So a workflow with `uses: thrillmade/clud-bug/.github/actions/strict-mode-gate@vX`
// loads `lib/skills.js` from the `vX` git tag. If we ship a fix to
// `selectReviewHeader` / `selectReviewBody` / `extractFirstReviewHeaderLine` /
// `isCriticalReviewHeader` / `extractPerSkillLine` / `classifyPerSkillOutcome`
// in v0.5.Y but templates still pin `@v0.5.(Y-1)`, the deployed workflows
// keep loading the OLD lib/skills.js — the fix is on npm but unreachable.
//
// Got bitten twice this session:
//   - v0.5.13 shipped lib/skills.js sort fix without bumping the composite
//     pin in templates. Required v0.5.14 hotfix solely to bump the pin.
//   - v0.5.10 → v0.5.12 had the same gap but was caught and bundled into
//     the v0.5.12 PR.
//
// This test makes the lock-step rule enforceable in CI: every release that
// bumps package.json MUST also bump the composite pin in all 3 review
// templates to the same version. Any drift fails the test.
//
// Cost: a no-op composite pin bump on releases where lib/skills.js didn't
// change. Acceptable — it's one-line-per-template and prevents the silent-
// fix-not-reachable class of bug entirely.

test('release discipline: composite pin in templates matches package.json version', async () => {
  const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  const expectedRef = `strict-mode-gate@v${pkg.version}`;

  const templates = [
    'workflow.yml.tmpl',
    'workflow-ts.yml.tmpl',
    'workflow-py.yml.tmpl',
  ];

  for (const tmpl of templates) {
    const content = await readFile(join(REPO_ROOT, 'templates', tmpl), 'utf8');
    const m = content.match(/strict-mode-gate@(v[0-9]+\.[0-9]+\.[0-9]+)/);
    assert.ok(m, `${tmpl}: no strict-mode-gate composite ref found`);
    const actualRef = `strict-mode-gate@${m[1]}`;
    assert.equal(
      actualRef,
      expectedRef,
      `${tmpl} composite ref out of sync with package.json.
       Expected: ${expectedRef}
       Found:    ${actualRef}
       Fix: bump the composite pin in all 3 review templates to match
       package.json version. The composite resolves lib/skills.js from
       its own pinned-tag checkout, so any lib/skills.js fix shipped
       without the matching pin bump is unreachable from deployed workflows.`,
    );
  }
});

test('release discipline: action.yml header docstring example matches package.json version', async () => {
  // The composite action's header has a usage-example comment block:
  //   #   - uses: thrillmade/clud-bug/.github/actions/strict-mode-gate@vX.Y.Z
  // Readers copy-paste this when wiring the composite into their own
  // workflows. If the example drifts behind the actual shipped pin,
  // anyone following the docs lands on a stale (potentially broken)
  // ref — exactly what bit on v0.5.10 → v0.5.12 (the @v0.5.10 ref had
  // the strict-mode-gate body-start matching bug).
  //
  // clud-bug-review flagged this on PR #65 as a pre-existing drift
  // (header still said @v0.5.12 while templates were on @v0.5.13).
  // v0.5.15 fixes the header manually AND extends this test so the
  // next release that bumps the templates without bumping the header
  // fails CI immediately — making the lock-step rule self-policing
  // for the most paste-able surface.
  const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  const expectedRef = `strict-mode-gate@v${pkg.version}`;
  const actionYml = await readFile(
    join(REPO_ROOT, '.github', 'actions', 'strict-mode-gate', 'action.yml'),
    'utf8',
  );
  const m = actionYml.match(/strict-mode-gate@(v[0-9]+\.[0-9]+\.[0-9]+)/);
  assert.ok(m, 'action.yml has no strict-mode-gate ref in its header');
  assert.equal(
    `strict-mode-gate@${m[1]}`,
    expectedRef,
    `action.yml header usage-example ref out of sync with package.json.
     Expected: ${expectedRef}
     Found:    strict-mode-gate@${m[1]}
     Fix: bump the @vX.Y.Z reference in the header comment block of
     .github/actions/strict-mode-gate/action.yml to match the current
     package.json version. The header is what readers paste; stale
     examples lead users onto deprecated/buggy refs.`,
  );
});

test('release discipline: composite pin matches across all 3 review templates', async () => {
  // Stronger property — even ignoring package.json, the three templates
  // must agree on the pin. Catches the case where someone edits one
  // template and forgets the other two.
  const templates = [
    'workflow.yml.tmpl',
    'workflow-ts.yml.tmpl',
    'workflow-py.yml.tmpl',
  ];
  const refs = await Promise.all(
    templates.map(async (tmpl) => {
      const content = await readFile(join(REPO_ROOT, 'templates', tmpl), 'utf8');
      const m = content.match(/strict-mode-gate@(v[0-9]+\.[0-9]+\.[0-9]+)/);
      return [tmpl, m ? m[1] : null];
    }),
  );
  const unique = new Set(refs.map(([, ref]) => ref));
  assert.equal(
    unique.size,
    1,
    `All 3 review templates must pin the same composite version. Found:\n${refs.map(([t, r]) => `  ${t} → ${r}`).join('\n')}`,
  );
});
