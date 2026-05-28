import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewPrompt } from '../lib/prompts.js';
import { renderFile, templateLanguage } from '../lib/render.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');

// --- 0.A.1: lib/prompts.js extraction (was inline in templates) ---
// reviewPrompt() is the source of truth for the clud-bug review prompt
// across all three templates. Tests verify:
// (a) the function returns the same prompt structure for all languages
// (b) language-specific bullets render in the right place
// (c) the rendered template's prompt body matches reviewPrompt() output
// (d) v0.6.2+ downstream PRs (caching, budgets, comment format) can
//     change one function without divergence across templates.

test('reviewPrompt requires projectDescription', () => {
  assert.throws(() => reviewPrompt({}), /projectDescription is required/);
});

test('reviewPrompt rejects unknown language', () => {
  assert.throws(
    () => reviewPrompt({ projectDescription: 'p', language: 'ruby' }),
    /unknown language 'ruby'/,
  );
});

test('reviewPrompt embeds the project description at the top', () => {
  const out = reviewPrompt({ projectDescription: 'XYZ-DESCRIPTION' });
  assert.match(out, /^XYZ-DESCRIPTION\n/);
});

test('reviewPrompt for generic language uses just the test-coverage bullet', () => {
  const out = reviewPrompt({ projectDescription: 'p', language: 'generic' });
  assert.match(out, /- Broken or missing test coverage for new code/);
  assert.doesNotMatch(out, /TypeScript type safety/);
  assert.doesNotMatch(out, /Incorrect exception handling/);
});

test('reviewPrompt for ts adds 4 TypeScript-specific bullets', () => {
  const out = reviewPrompt({ projectDescription: 'p', language: 'ts' });
  assert.match(out, /- Broken or missing test coverage for new code/);
  assert.match(out, /- TypeScript type safety issues/);
  assert.match(out, /- Incorrect ESM\/CJS module usage/);
  assert.match(out, /- Improper async\/await or Promise handling/);
  assert.match(out, /- Incorrect use of common Node\.js patterns/);
});

test('reviewPrompt for py replaces test-coverage with 4 Python-specific bullets', () => {
  const out = reviewPrompt({ projectDescription: 'p', language: 'py' });
  // Python variant REPLACES the generic test-coverage line (per the
  // original templates' diff). It uses pytest-specific phrasing instead.
  assert.doesNotMatch(out, /- Broken or missing test coverage for new code/);
  assert.match(out, /- Incorrect exception handling/);
  assert.match(out, /- Missing type hints on new functions/);
  assert.match(out, /- Incorrect use of Click/);
  assert.match(out, /- Missing pytest coverage for new code/);
});

test('reviewPrompt includes the core review-discipline sections', () => {
  // Spot-check that the structural anchors from the original prompt
  // survived extraction. These markers gate clud-bug's downstream
  // parsing (lib/skills.js classifyPerSkillOutcome, strict-mode header
  // regex). Snapshot-light: prevent silent regressions during future
  // edits to reviewPrompt() without locking byte-for-byte.
  const out = reviewPrompt({ projectDescription: 'p' });
  const markers = [
    'Review this pull request for critical issues only',
    'Skill routing — shared vs dedicated',
    'Strict-mode header (opt-in)',
    '## 🐛 Clud Bug review',
    '**This round:**',
    '### Per-skill scan',
    'FIX-PUSH FLOW',
    'mcp__github_inline_comment__create_inline_comment',
  ];
  for (const marker of markers) {
    assert.match(out, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing marker: ${marker}`);
  }
});

test('templateLanguage maps template filename to reviewPrompt language', () => {
  assert.equal(templateLanguage('workflow-ts.yml.tmpl'), 'ts');
  assert.equal(templateLanguage('workflow-py.yml.tmpl'), 'py');
  assert.equal(templateLanguage('workflow.yml.tmpl'), 'generic');
  assert.equal(templateLanguage('whatever-else.yml.tmpl'), 'generic');
});

test('rendered workflow.yml.tmpl contains the prompt body indented under prompt: |', async () => {
  // The renderFile pipeline must (a) substitute REVIEW_PROMPT and
  // (b) preserve YAML indentation for the multi-line value via
  // render.js's indent-aware logic.
  const out = await renderFile(join(TEMPLATES, 'workflow.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'TEST DESCRIPTION',
      language: 'generic',
    }),
  });
  // Project description appears at the right indent under prompt: |
  assert.match(out, /          prompt: \|\n            TEST DESCRIPTION\n/);
  // Mid-prompt content is also at 12-space indent (continuation lines
  // get the placeholder's leading whitespace from render.js). Sub-block
  // markdown headers like "### Per-skill scan" sit at 14 spaces because
  // the original prompt's sub-block had 2 extra leading spaces.
  assert.match(out, /\n            Review this pull request for critical issues only/);
  assert.match(out, /\n {14}### Per-skill scan\n/);
});

test('rendered workflow-ts.yml.tmpl contains TypeScript bullets', async () => {
  const out = await renderFile(join(TEMPLATES, 'workflow-ts.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'TS PROJECT',
      language: 'ts',
    }),
  });
  assert.match(out, /\n            - TypeScript type safety issues/);
});

test('rendered workflow-py.yml.tmpl contains Python bullets (no generic test-coverage)', async () => {
  const out = await renderFile(join(TEMPLATES, 'workflow-py.yml.tmpl'), {
    REVIEW_PROMPT: reviewPrompt({
      projectDescription: 'PY PROJECT',
      language: 'py',
    }),
  });
  assert.match(out, /\n            - Incorrect exception handling/);
  // Python variant should NOT include the generic "Broken or missing test coverage" line.
  assert.doesNotMatch(out, /\n            - Broken or missing test coverage/);
});

// --- Indent-aware render.js behavior (added in v0.6.2 alongside prompts.js) ---

test('render preserves indentation for multi-line values', async () => {
  // Without indent-aware substitution, continuation lines would lose
  // their YAML indent and corrupt the `prompt: |` block. This is the
  // load-bearing test for render.js's multi-line handling.
  const { render } = await import('../lib/render.js');
  const tmpl = '          prompt: |\n            {{BODY}}\n';
  const out = render(tmpl, { BODY: 'line1\nline2\nline3' });
  assert.equal(out, '          prompt: |\n            line1\n            line2\n            line3\n');
});

test('render preserves blank lines without trailing whitespace in multi-line values', async () => {
  // Blank lines in the substituted value stay blank (no indent applied).
  // Keeps YAML output clean (no trailing whitespace on otherwise-blank
  // lines) which is also git-friendly.
  const { render } = await import('../lib/render.js');
  const tmpl = '            {{BODY}}\n';
  const out = render(tmpl, { BODY: 'line1\n\nline2' });
  assert.equal(out, '            line1\n\n            line2\n');
});
