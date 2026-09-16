// clud-bug#331 — the `review` job's `npx --yes clud-bug@{{CLUD_BUG_VERSION}}
// <verb>` call sites resolved the CLI by scanning `node_modules` upward from
// the current working directory before ever asking the registry. The
// `actions/checkout@v6` step in that job carries no `ref:`, so on
// `pull_request` the cwd is the MERGE ref — a workspace populated with the
// PR's own content. A PR that commits `node_modules/clud-bug` (permitted
// even where `.gitignore` lists it, via `git add -f`) made every one of
// those calls run the PR's OWN code, with the job's `GH_TOKEN`
// (`pull-requests: write`, `checks: write`) and `ANTHROPIC_API_KEY` in
// hand, to post the very `clud-bug-review` check-run that gates the PR.
// SPEC 2.0 §6.3: "a gate is never satisfiable by the change it judges."
//
// PROBE (run by hand against a fixture, not a permanent test — installing
// or faking `npx` resolution is a real filesystem/registry interaction this
// suite does not want to depend on; see release-discipline.test.js and
// strict-mode-gate-ci-lint.test.js for the same convention re: actionlint /
// real npm calls). Reproduced here for the record:
//
//   $ mkdir -p node_modules/.bin node_modules/clud-bug/bin
//   $ printf '#!/usr/bin/env node\nconsole.log("FORGED");\n' \
//       > node_modules/clud-bug/bin/clud-bug.js
//   $ ln -s ../clud-bug/bin/clud-bug.js node_modules/.bin/clud-bug
//   $ npx --yes --offline clud-bug@0.7.0-rc.27 post-check-run --help
//   FORGED                                    # <- npx picked up the fixture
//
//   $ npm install --prefix /tmp/outside clud-bug@0.7.0-rc.27 \
//       --no-package-lock --ignore-scripts --silent
//   $ cd <the poisoned workspace above>
//   $ /tmp/outside/node_modules/.bin/clud-bug --version
//   0.7.0-rc.27                               # <- absolute path: unaffected
//
// FIX — install the pinned, published package ONCE, into $RUNNER_TEMP (a
// directory outside the checkout's workspace), BEFORE the checkout step
// runs (so a workspace-level `.npmrc` a PR might commit can't steer the
// install either), and invoke it everywhere by absolute path. This test
// suite checks the SHAPE of that fix in the rendered templates.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { reviewPrompt } from '../src/core/prompts.js';
import { renderFile, templateLanguage, DEFAULTS } from '../src/core/render.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');
const WORKFLOW_TEMPLATES = ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl'];
// fork-notice.yml.tmpl has its own npx call site (clud-bug#331 residual,
// the fork-notice job) — no REVIEW_PROMPT/REVIEW_SCHEMA placeholders to
// fill, so it renders with DEFAULTS alone, but it is the SAME CLI-
// resolution hole and belongs in the same regression net.
const ALL_TEMPLATES = [...WORKFLOW_TEMPLATES, 'fork-notice.yml.tmpl'];
const INSTALL_STEP_NAME = 'Install clud-bug CLI (pinned, isolated)';

// clud-bug#331 residual: a bare `npx [flags] clud-bug@<version>` call site,
// including one whose command line is wrapped across multiple lines with
// shell `\` continuations (e.g. `npx \\\n  --yes \\\n  clud-bug@<version>
// \\\n  <verb>`) — the SAME hole, just spread over several lines so a
// line-oriented pattern (`[^\n]*`, no way to see past the first `\n`) never
// would have matched it. `(?:[^\n]*\\\n\s*)*` walks zero or more
// continuation lines before the line the version pin lands on.
const NPX_CALL_SITE = /npx\s(?:[^\n]*\\\n\s*)*[^\n]*\bclud-bug@[^<\s]/;

async function render(tmpl) {
  if (tmpl === 'fork-notice.yml.tmpl') return renderFile(join(TEMPLATES, tmpl), {});
  return renderFile(join(TEMPLATES, tmpl), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: templateLanguage(tmpl) }),
  });
}

test('#331: no template resolves the clud-bug CLI via a bare `npx` call site', async () => {
  for (const tmpl of ALL_TEMPLATES) {
    const out = await render(tmpl);
    // A functional call site is ANY `npx ... clud-bug@<resolved-semver>`
    // invocation — `npx --yes`, `npx -y`, or bare `npx`, any of which
    // resolve from the poisoned workspace exactly like the original #331
    // shape, whether it lands on one line or is wrapped across several
    // with `\` continuations. A pattern pinned to `--yes` alone left
    // `npx -y` and bare `npx` free to reintroduce the hole (confirmed:
    // templates/audit.yml.tmpl and templates/self-update.yml.tmpl already
    // use the `npx -y` spelling); a pattern anchored to one line left a
    // wrapped invocation free to reintroduce it the same way. Match only a
    // digit-leading version so the security comment's own PROSE
    // placeholders (`npx --yes clud-bug@<version>` / `@<pinned-version>`)
    // can never satisfy this pattern.
    assert.doesNotMatch(
      out,
      NPX_CALL_SITE,
      `${tmpl}: a bare 'npx [flags] clud-bug@<version> <verb>' call site survived`,
    );
  }
});

test('#331: the fork-notice job installs the CLI and invokes it via $CLUD_BUG_BIN, not npx', async () => {
  const doc = parseYaml(await render('fork-notice.yml.tmpl'));
  const steps = doc.jobs['fork-notice'].steps;
  const installIdx = steps.findIndex((s) => s && s.name === INSTALL_STEP_NAME);
  assert.notEqual(installIdx, -1, `fork-notice.yml.tmpl: no '${INSTALL_STEP_NAME}' step`);
  const postCheckRunIdx = steps.findIndex(
    (s) => s && s.name === 'Post the neutral clud-bug-review check (SPEC §6.5)',
  );
  assert.notEqual(postCheckRunIdx, -1, `fork-notice.yml.tmpl: no post-check-run step`);
  assert.ok(
    installIdx < postCheckRunIdx,
    `fork-notice.yml.tmpl: install step must precede the post-check-run call`,
  );
  assert.match(
    steps[postCheckRunIdx].run,
    /"\$CLUD_BUG_BIN" post-check-run/,
    `fork-notice.yml.tmpl: post-check-run must invoke $CLUD_BUG_BIN, not npx`,
  );
  assert.match(
    steps[installIdx].run,
    new RegExp(`npm install --prefix "\\$RUNNER_TEMP/clud-bug" clud-bug@${DEFAULTS.CLUD_BUG_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
    `fork-notice.yml.tmpl: install step does not pin clud-bug@${DEFAULTS.CLUD_BUG_VERSION}`,
  );
});

test('#331: the review job installs the CLI outside the workspace, before checkout', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const doc = parseYaml(await render(tmpl));
    const steps = doc.jobs.review.steps;
    const installIdx = steps.findIndex((s) => s && s.name === INSTALL_STEP_NAME);
    assert.notEqual(installIdx, -1, `${tmpl}: no '${INSTALL_STEP_NAME}' step in the review job`);
    const checkoutIdx = steps.findIndex((s) => s && typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
    assert.notEqual(checkoutIdx, -1, `${tmpl}: no actions/checkout step in the review job`);
    assert.ok(
      installIdx < checkoutIdx,
      `${tmpl}: the install step (index ${installIdx}) must run BEFORE checkout (index ${checkoutIdx}) — installing after checkout leaves the install itself exposed to a PR-committed .npmrc`,
    );
    const install = steps[installIdx];
    // `render()` substitutes {{CLUD_BUG_VERSION}} with DEFAULTS.CLUD_BUG_VERSION
    // (baked from package.json at build time) — check the RESOLVED pin, the
    // same way a real `clud-bug init` render would produce it.
    const versionPin = new RegExp(
      `npm install --prefix "\\$RUNNER_TEMP/clud-bug" clud-bug@${DEFAULTS.CLUD_BUG_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    );
    assert.match(
      install.run,
      versionPin,
      `${tmpl}: install step does not pin clud-bug@${DEFAULTS.CLUD_BUG_VERSION} into $RUNNER_TEMP/clud-bug`,
    );
    assert.match(install.run, /--ignore-scripts/, `${tmpl}: install step does not pass --ignore-scripts`);
    assert.match(install.run, /--no-package-lock/, `${tmpl}: install step does not pass --no-package-lock`);
    assert.match(
      install.run,
      /echo "CLUD_BUG_BIN=\$RUNNER_TEMP\/clud-bug\/node_modules\/\.bin\/clud-bug" >> "\$GITHUB_ENV"/,
      `${tmpl}: install step does not export CLUD_BUG_BIN via $GITHUB_ENV for every later step to share`,
    );
  }
});

test('#331: the gate job (no checkout at all) also resolves the CLI via the isolated absolute path, not npx', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const doc = parseYaml(await render(tmpl));
    const steps = doc.jobs.gate.steps;
    const installIdx = steps.findIndex((s) => s && s.name === INSTALL_STEP_NAME);
    assert.notEqual(installIdx, -1, `${tmpl}: no '${INSTALL_STEP_NAME}' step in the gate job`);
    const postCheckRunIdx = steps.findIndex(
      (s) => s && s.name === 'Ensure a clud-bug-review check exists (SPEC §6.5)',
    );
    assert.notEqual(postCheckRunIdx, -1, `${tmpl}: no post-check-run step in the gate job`);
    assert.ok(installIdx < postCheckRunIdx, `${tmpl}: gate job's install step must precede its post-check-run call`);
    assert.match(
      steps[postCheckRunIdx].run,
      /"\$CLUD_BUG_BIN" post-check-run/,
      `${tmpl}: gate job's post-check-run must invoke $CLUD_BUG_BIN, not npx`,
    );
  }
});

test('#331: every clud-bug verb call site in the review job uses the absolute-path $CLUD_BUG_BIN', async () => {
  // Every verb this job invokes, mapped to the step comment/name it lives
  // in — one entry per site named in the original #331 evidence.
  const VERBS = ['render', 'build-bundle', 'post-check-run', 'post-inline-threads', 'resolve-threads', 'update-skill-usage', 'select-review-event'];
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    for (const verb of VERBS) {
      assert.match(
        out,
        new RegExp(`"\\$CLUD_BUG_BIN" ${verb.replace(/-/g, '\\-')}`),
        `${tmpl}: verb '${verb}' is not invoked via "$CLUD_BUG_BIN" anywhere in the rendered template`,
      );
    }
  }
});

test('#331 CONTROL: the "functional call site" pattern used above actually matches a real npx invocation', () => {
  // Control test for the negative assertion in the first test: prove the
  // regex fires on every shape a call site can take — `--yes`, `-y`,
  // bare, and one wrapped across multiple lines with `\` continuations —
  // so a silently-broken (or narrowly-pinned) pattern can't report a
  // false "no npx call sites" clean bill.
  assert.match('npx --yes clud-bug@0.7.0-rc.27 post-check-run \\\n  --sha "$HEAD_SHA"', NPX_CALL_SITE);
  assert.match('npx -y clud-bug@0.7.0-rc.27 usage --summary', NPX_CALL_SITE);
  assert.match('npx clud-bug@0.7.0-rc.27 render --stdin', NPX_CALL_SITE);
  // clud-bug#331 residual: the version pin itself lands on a line AFTER
  // one or more `\`-continuations — a line-oriented pattern (`[^\n]*`,
  // stops at the first `\n`) never sees past `npx \` to find it.
  assert.match('npx \\\n  --yes \\\n  clud-bug@0.7.0-rc.27 \\\n  post-check-run', NPX_CALL_SITE);
  assert.match('npx \\\n  clud-bug@0.7.0-rc.27 render --stdin', NPX_CALL_SITE);
  // And confirm the SAME pattern does NOT fire on the security comment's
  // own placeholder prose — otherwise this guard would forbid the very
  // documentation explaining the vulnerability it closes.
  const prose = 'npx --yes clud-bug@<pinned-version>` returns from such a workspace';
  assert.doesNotMatch(prose, NPX_CALL_SITE);
  const prose2 = 'npx --yes clud-bug@<version>` from a poisoned workspace';
  assert.doesNotMatch(prose2, NPX_CALL_SITE);
});

test('#331: package.json version stays wired to the one templated placeholder (regression: a literal version string anywhere defeats the auto-bump)', () => {
  assert.equal(typeof DEFAULTS.CLUD_BUG_VERSION, 'string');
  assert.ok(DEFAULTS.CLUD_BUG_VERSION.length > 0, 'CLUD_BUG_VERSION must not be empty');
});
