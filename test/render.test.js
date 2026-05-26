import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { render, pickTemplate, DEFAULTS } from '../lib/render.js';

test('render fills single placeholder', () => {
  const out = render('hello {{NAME}}', { NAME: 'world' });
  assert.equal(out, 'hello world');
});

test('render fills multiple placeholders', () => {
  const out = render('{{A}} and {{B}}', { A: 'one', B: 'two' });
  assert.equal(out, 'one and two');
});

test('render leaves text without placeholders untouched', () => {
  const out = render('plain text', {});
  assert.equal(out, 'plain text');
});

test('render throws on missing variable', () => {
  assert.throws(() => render('{{MISSING}}', {}), /Missing template variable: MISSING/);
});

test('render replaces every occurrence of the same placeholder', () => {
  const out = render('{{X}} {{X}} {{X}}', { X: 'hi' });
  assert.equal(out, 'hi hi hi');
});

test('render allows empty string substitution', () => {
  const out = render('a{{X}}b', { X: '' });
  assert.equal(out, 'ab');
});

test('pickTemplate prefers TS variant when JS/TS present', () => {
  assert.equal(pickTemplate(['typescript', 'python']), 'workflow-ts.yml.tmpl');
  assert.equal(pickTemplate(['javascript']), 'workflow-ts.yml.tmpl');
});

test('pickTemplate falls back to Python when no JS/TS', () => {
  assert.equal(pickTemplate(['python']), 'workflow-py.yml.tmpl');
});

test('pickTemplate falls back to generic for other languages', () => {
  assert.equal(pickTemplate(['go']), 'workflow.yml.tmpl');
  assert.equal(pickTemplate([]), 'workflow.yml.tmpl');
});

// --- v0.5.11: DEFAULTS map + CCA_VERSION pinning ---
// Templates use {{CCA_VERSION}} to pin anthropics/claude-code-action. The
// DEFAULTS map in render.js provides the pin, so callers don't have to
// thread it through every renderFile call. Bumping the pin is a clud-bug
// release event (visible in CHANGELOG, picked up by refresh-mode).

test('DEFAULTS exports a non-empty CCA_VERSION pin', () => {
  assert.equal(typeof DEFAULTS.CCA_VERSION, 'string');
  // Must look like a real version tag, not "v1" (the floating major we are
  // explicitly pinning away from). Format: vMAJOR.MINOR.PATCH.
  assert.match(DEFAULTS.CCA_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('render substitutes CCA_VERSION from DEFAULTS when caller omits it', () => {
  const out = render('uses: anthropics/claude-code-action@{{CCA_VERSION}}', {});
  assert.equal(out, `uses: anthropics/claude-code-action@${DEFAULTS.CCA_VERSION}`);
});

test('render lets caller override DEFAULTS via explicit vars', () => {
  // Defense in depth: a downstream caller (e.g. the v0.6 App) may need to
  // override the pin without editing render.js. Caller-supplied vars win.
  const out = render('@{{CCA_VERSION}}', { CCA_VERSION: 'v9.9.9' });
  assert.equal(out, '@v9.9.9');
});

test('render still throws on a placeholder not in DEFAULTS or vars', () => {
  // Adding DEFAULTS must not weaken the missing-var guard for tokens
  // that aren't in the defaults map.
  assert.throws(() => render('{{NOT_DEFAULTED}}', {}), /Missing template variable: NOT_DEFAULTED/);
});
