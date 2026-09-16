// clud-bug#259 item 1 (SPEC 2.0 §4.3 / §2.6) — the Action posted a NEW `gh
// pr comment` on every push instead of editing the existing one, so a PR
// with N pushes accumulated N review-status comments. §4.3: "One comment
// per pull request, rewritten in place. A reviewer MUST edit that comment
// on every later pass and MUST NOT post a second one." §2.6 names the tool:
// `upsert_review_comment` "MUST create the comment on first call and edit
// that same comment in place on every later one".
//
// SHAPE       — the "Write review-comment helper" step exists in the review
//               job of all 3 templates, runs before every post site, and
//               every post site calls `upsert_review_comment` instead of a
//               bare `gh pr comment`.
//
// BEHAVIOUR   — the helper's ACTUAL shell (extracted from the rendered YAML
//               with a real YAML parser) is written to disk by executing
//               the "Write review-comment helper" step for real under
//               `bash -e`, then sourced and called TWICE against a fake
//               `gh` that persists state to a JSON file — the same
//               convention test/skills-base-ref.test.js uses for the pin
//               step. This is the proof: two calls produce exactly ONE
//               comment, and the second call PATCHes it rather than
//               creating a second one.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { reviewPrompt } from '../src/core/prompts.js';
import { renderFile, templateLanguage } from '../src/core/render.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');
const WORKFLOW_TEMPLATES = ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl'];
const HELPER_STEP_NAME = 'Write review-comment helper';
const REVIEW_JOB = 'review';
const FORK_NOTICE_TEMPLATE = 'fork-notice.yml.tmpl';
const FORK_NOTICE_JOB = 'fork-notice';
const ANNOUNCE_STEP_NAME = 'Announce the skip on the pull request (SPEC §6.5)';

async function render(tmpl) {
  return renderFile(join(TEMPLATES, tmpl), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: templateLanguage(tmpl) }),
  });
}

async function reviewSteps(tmpl) {
  const doc = parseYaml(await render(tmpl));
  return doc.jobs[REVIEW_JOB].steps;
}

async function forkNoticeSteps() {
  const doc = parseYaml(await renderFile(join(TEMPLATES, FORK_NOTICE_TEMPLATE), {}));
  return doc.jobs[FORK_NOTICE_JOB].steps;
}

// ---------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------

test('#259/1: every workflow template writes the upsert_review_comment helper before any post site, in the review job', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const steps = await reviewSteps(tmpl);
    const helperIdx = steps.findIndex((s) => s && s.name === HELPER_STEP_NAME);
    assert.notEqual(helperIdx, -1, `${tmpl}: no '${HELPER_STEP_NAME}' step`);
    assert.match(
      steps[helperIdx].run,
      /upsert_review_comment\(\) \{/,
      `${tmpl}: helper step does not define the upsert_review_comment function`,
    );

    const postSiteNames = [
      'Guard — require ANTHROPIC_API_KEY',
      'Render + post structured review',
      'Fallback summary (structured_output empty)',
    ];
    for (const name of postSiteNames) {
      const idx = steps.findIndex((s) => s && s.name === name);
      assert.notEqual(idx, -1, `${tmpl}: no '${name}' step`);
      assert.ok(helperIdx < idx, `${tmpl}: '${name}' (index ${idx}) runs before the helper is written (index ${helperIdx})`);
      assert.match(
        steps[idx].run,
        /source "\$RUNNER_TEMP\/upsert-review-comment\.sh"/,
        `${tmpl}: '${name}' does not source the shared helper`,
      );
      assert.match(
        steps[idx].run,
        /upsert_review_comment /,
        `${tmpl}: '${name}' does not call upsert_review_comment`,
      );
    }
  }
});

test('#259/1: no post site in the review job calls `gh pr comment` directly (other than inside the helper itself)', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const steps = await reviewSteps(tmpl);
    for (const step of steps) {
      if (!step || step.name === HELPER_STEP_NAME || typeof step.run !== 'string') continue;
      assert.doesNotMatch(
        step.run,
        /gh pr comment "\$PR_NUMBER" --body/,
        `${tmpl}: step '${step.name}' still calls 'gh pr comment' directly instead of upsert_review_comment`,
      );
    }
  }
});

test('#259/1: the helper searches by the SAME written-by marker key the shared renderer defines, not a second anchor', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const steps = await reviewSteps(tmpl);
    const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);
    assert.match(
      helper.run,
      /<!-- written-by: \$\{identity\} -->/,
      `${tmpl}: helper does not use the '<!-- written-by: ... -->' marker`,
    );
    assert.match(
      helper.run,
      /local identity='github-actions\[bot\]'/,
      `${tmpl}: helper does not stamp the actual GITHUB_TOKEN posting identity`,
    );
  }
});

// ---------------------------------------------------------------------------
// BEHAVIOUR — real bash, real fake-gh, real file state
// ---------------------------------------------------------------------------

/**
 * Writes a fake `gh` binary that persists comment state to STATE as JSON.
 *
 * `emulatePagination`: clud-bug#259 item 1 (the residual) is specifically
 * about a fetch that returns only the FIRST `per_page` comments (the
 * "oldest 100" window) unless `--paginate` is passed. The default fake
 * `gh` above (used by the small-corpus BEHAVIOUR test) always returns the
 * WHOLE state regardless of flags — fine when there are only 1-2
 * comments, but it would never be able to reproduce (or prove the fix
 * for) a bug that only bites once a PR has >100 comments in front of the
 * bot's own. When true: a bare `gh api URL --jq EXPR` (no `--paginate`)
 * is answered from `state[0:per_page]` only (per_page parsed out of the
 * URL query string, default 30 — GitHub's own REST default); `gh api
 * --paginate URL --jq EXPR` is answered from the WHOLE state, modelling
 * "walk every page".
 */
function writeFakeGh(binDir, { emulatePagination = false } = {}) {
  const ghPath = join(binDir, 'gh');
  const pageSlice = emulatePagination
    ? `      if [ "$PAGINATE" != "true" ]; then
        PER_PAGE=$(printf '%s' "$URL" | grep -o 'per_page=[0-9]*' | cut -d= -f2)
        [ -z "$PER_PAGE" ] && PER_PAGE=30
        jq --argjson n "$PER_PAGE" '.[0:$n]' "$STATE" > "$STATE.page"
        DATA="$STATE.page"
      else
        DATA="$STATE"
      fi
      jq -r "$JQEXPR" "$DATA"`
    : `      jq -r "$JQEXPR" "$STATE"`;
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
STATE="\${FAKE_GH_STATE:?}"
[ -f "$STATE" ] || echo '[]' > "$STATE"
case "$1" in
  api)
    shift
    if [ "$1" = "--method" ]; then
      shift; shift; ENDPOINT="$1"; shift
      BODY=""
      while [ $# -gt 0 ]; do
        case "$1" in
          -f) shift; KV="$1"; shift; case "$KV" in body=*) BODY="\${KV#body=}";; esac ;;
          *) shift ;;
        esac
      done
      ID="\${ENDPOINT##*/}"
      jq --arg id "$ID" --arg body "$BODY" 'map(if (.id|tostring) == $id then .body = $body else . end)' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
      exit 0
    else
      PAGINATE=false
      URL=""
      JQEXPR=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --paginate) PAGINATE=true; shift ;;
          --jq) shift; JQEXPR="$1"; shift ;;
          *) [ -z "$URL" ] && URL="$1"; shift ;;
        esac
      done
${pageSlice}
      exit 0
    fi
    ;;
  pr)
    shift
    if [ "$1" = "comment" ]; then
      shift; shift
      BODY=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --body) shift; BODY="$1"; shift ;;
          *) shift ;;
        esac
      done
      NEWID=$(jq 'map(.id) | max' "$STATE" 2>/dev/null)
      [ "$NEWID" = "null" ] || [ -z "$NEWID" ] && NEWID=0
      NEWID=$((NEWID + 1))
      jq --argjson id "$NEWID" --arg body "$BODY" '. + [{"id": $id, "user": {"login": "github-actions[bot]"}, "body": $body}]' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
      exit 0
    fi
    ;;
esac
echo "fake gh: unhandled: $*" >&2
exit 1
`,
  );
  chmodSync(ghPath, 0o755);
}

test('#259/1 BEHAVIOUR: two calls to upsert_review_comment against the same PR produce exactly ONE comment, edited in place', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const steps = await reviewSteps(tmpl);
    const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);

    const dir = mkdtempSync(join(tmpdir(), 'clud-bug-upsert-'));
    try {
      const binDir = join(dir, 'bin');
      mkdirSync(binDir);
      writeFakeGh(binDir);

      const runnerTemp = join(dir, 'runnertemp');
      mkdirSync(runnerTemp);

      // Execute the ACTUAL "Write review-comment helper" step script —
      // proves the heredoc/YAML-dedent shape really writes a valid file,
      // not just that the source text looks right.
      writeFileSync(join(dir, 'write-helper.sh'), helper.run);
      execFileSync('bash', ['-e', join(dir, 'write-helper.sh')], {
        env: { ...process.env, RUNNER_TEMP: runnerTemp, PATH: `${binDir}:${process.env.PATH}` },
      });

      const stateFile = join(dir, 'state.json');
      writeFileSync(stateFile, '[]');
      const env = {
        ...process.env,
        RUNNER_TEMP: runnerTemp,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_GH_STATE: stateFile,
      };

      const driver1 = join(dir, 'driver1.sh');
      writeFileSync(
        driver1,
        `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment 42 "acme/widgets" "## Clud Bug review — run 1"\n`,
      );
      execFileSync('bash', ['-e', driver1], { env });

      let state = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.equal(state.length, 1, `${tmpl}: expected exactly 1 comment after the FIRST call, got ${state.length}`);
      assert.match(state[0].body, /run 1/, `${tmpl}: first comment does not carry the posted body`);
      assert.match(state[0].body, /<!-- written-by: github-actions\[bot\] -->/, `${tmpl}: first comment is missing the written-by marker`);
      const firstId = state[0].id;

      const driver2 = join(dir, 'driver2.sh');
      writeFileSync(
        driver2,
        `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment 42 "acme/widgets" "## Clud Bug review — run 2 (updated)"\n`,
      );
      execFileSync('bash', ['-e', driver2], { env });

      state = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.equal(state.length, 1, `${tmpl}: expected STILL exactly 1 comment after the SECOND call (edit-in-place), got ${state.length}`);
      assert.equal(state[0].id, firstId, `${tmpl}: the second call created a NEW comment (id ${state[0].id}) instead of editing the first (id ${firstId})`);
      assert.match(state[0].body, /run 2 \(updated\)/, `${tmpl}: the comment body was not updated on the second call`);
      assert.doesNotMatch(state[0].body, /run 1/, `${tmpl}: the comment still carries the FIRST run's stale body`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Builds a fixture state of `count` pre-existing "noise" comments from other users. */
function noiseComments(count) {
  const arr = [];
  for (let i = 1; i <= count; i += 1) {
    arr.push({ id: i, user: { login: 'someone-else' }, body: `unrelated discussion #${i}` });
  }
  return arr;
}

test('#259/1 BEHAVIOUR (busy PR): 150 pre-existing comments + a prior review comment → the second run EDITS it, not a fresh one', async () => {
  // clud-bug#259 item 1 (the residual): the pre-fix helper fetched a
  // single page of the OLDEST 100 comments (`?per_page=100`, no
  // `--paginate`). A PR busy enough to already carry 150 OTHER comments
  // before the bot's own ever posts means the bot's comment (created
  // 151st) can NEVER be found by that windowed fetch — `existing` comes
  // back empty forever, and every later run creates a fresh comment
  // instead of editing it.
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const steps = await reviewSteps(tmpl);
    const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);

    const dir = mkdtempSync(join(tmpdir(), 'clud-bug-upsert-busy-'));
    try {
      const binDir = join(dir, 'bin');
      mkdirSync(binDir);
      writeFakeGh(binDir, { emulatePagination: true });

      const runnerTemp = join(dir, 'runnertemp');
      mkdirSync(runnerTemp);
      writeFileSync(join(dir, 'write-helper.sh'), helper.run);
      execFileSync('bash', ['-e', join(dir, 'write-helper.sh')], {
        env: { ...process.env, RUNNER_TEMP: runnerTemp, PATH: `${binDir}:${process.env.PATH}` },
      });

      const stateFile = join(dir, 'state.json');
      writeFileSync(stateFile, JSON.stringify(noiseComments(150)));
      const env = {
        ...process.env,
        RUNNER_TEMP: runnerTemp,
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_GH_STATE: stateFile,
      };

      const driver1 = join(dir, 'driver1.sh');
      writeFileSync(
        driver1,
        `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment 42 "acme/widgets" "## Clud Bug review — run 1"\n`,
      );
      execFileSync('bash', ['-e', driver1], { env });

      let state = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.equal(state.length, 151, `${tmpl}: expected 150 noise + 1 bot comment after the FIRST call, got ${state.length}`);
      const botComment = state.find((c) => c.user.login === 'github-actions[bot]');
      assert.ok(botComment, `${tmpl}: bot comment not created`);
      const firstId = botComment.id;

      const driver2 = join(dir, 'driver2.sh');
      writeFileSync(
        driver2,
        `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment 42 "acme/widgets" "## Clud Bug review — run 2 (updated)"\n`,
      );
      execFileSync('bash', ['-e', driver2], { env });

      state = JSON.parse(readFileSync(stateFile, 'utf8'));
      const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
      assert.equal(
        state.length,
        151,
        `${tmpl}: expected STILL 151 total comments after the SECOND call on a busy PR (edit-in-place), got ${state.length}`,
      );
      assert.equal(
        botComments.length,
        1,
        `${tmpl}: expected exactly 1 bot comment on a busy PR, found ${botComments.length} — the second run created a fresh one instead of finding the first past the 150-comment window`,
      );
      assert.equal(botComments[0].id, firstId, `${tmpl}: the second call created a NEW bot comment instead of editing the first`);
      assert.match(botComments[0].body, /run 2 \(updated\)/, `${tmpl}: the comment body was not updated on the second call`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('#259/1 CONTROL (busy PR): the PRE-FIX shape (no --paginate) loses the bot comment past the 150-comment window and creates a duplicate', async () => {
  // Control for the busy-PR behaviour test above: reconstructs the exact
  // pre-fix `existing=` line (bare `per_page=100`, no `--paginate`) against
  // the SAME 150-noise-comment fixture and the SAME fake-gh pagination
  // emulation, and shows it reproduces clud-bug#259 item 1's residual
  // exactly — proving the busy-PR test above is pinned to something the
  // harness actually reproduces, not an artifact of a harness that can
  // never lose a comment.
  const tmpl = WORKFLOW_TEMPLATES[0];
  const steps = await reviewSteps(tmpl);
  const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);
  const preFixRun = helper.run.replace(
    'gh api --paginate "repos/${repo}/issues/${pr}/comments?per_page=100"',
    'gh api "repos/${repo}/issues/${pr}/comments?per_page=100"',
  );
  assert.notEqual(preFixRun, helper.run, 'pre-fix substitution did not match the current helper text — control is stale');

  const dir = mkdtempSync(join(tmpdir(), 'clud-bug-upsert-busy-control-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeFakeGh(binDir, { emulatePagination: true });

    const runnerTemp = join(dir, 'runnertemp');
    mkdirSync(runnerTemp);
    writeFileSync(join(dir, 'write-helper.sh'), preFixRun);
    execFileSync('bash', ['-e', join(dir, 'write-helper.sh')], {
      env: { ...process.env, RUNNER_TEMP: runnerTemp, PATH: `${binDir}:${process.env.PATH}` },
    });

    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify(noiseComments(150)));
    const env = {
      ...process.env,
      RUNNER_TEMP: runnerTemp,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_GH_STATE: stateFile,
    };

    execFileSync('bash', ['-e', '-c', 'source "$RUNNER_TEMP/upsert-review-comment.sh"; upsert_review_comment 42 "acme/widgets" "run 1"'], { env });
    execFileSync('bash', ['-e', '-c', 'source "$RUNNER_TEMP/upsert-review-comment.sh"; upsert_review_comment 42 "acme/widgets" "run 2 (updated)"'], { env });

    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
    assert.equal(
      botComments.length,
      2,
      `control: pre-fix (no --paginate) shape must create a SECOND bot comment on a busy PR (found ${botComments.length}) — otherwise this control does not reproduce the bug`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#259/1 CONTROL: without routing through upsert_review_comment, two bare `gh pr comment` calls DO produce two comments', () => {
  // Control for the behaviour test above: proves the fake `gh` + driver
  // harness is capable of showing duplication at all, so the "exactly one
  // comment" result above isn't just an artifact of a harness that can
  // never produce two.
  const dir = mkdtempSync(join(tmpdir(), 'clud-bug-upsert-control-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeFakeGh(binDir);
    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, '[]');
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, FAKE_GH_STATE: stateFile };
    execFileSync('gh', ['pr', 'comment', '42', '--body', 'first'], { env });
    execFileSync('gh', ['pr', 'comment', '42', '--body', 'second'], { env });
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.length, 2, 'control: the harness did not reproduce the pre-fix duplicate-comment behaviour');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// fork-notice.yml.tmpl — same #259 item 1 shape, isolated in its own job
// (SPEC 2.0 §4.3 / §2.6, clud-bug#259 item 1 residual). The fork-notice job
// had its own ad hoc dedup query — a single OLDEST-100 page, no
// `--paginate`, matched on the comment PREFIX rather than the shared
// `<!-- written-by: ... -->` marker — so it never routed through
// `upsert_review_comment` at all. It now writes and sources the SAME
// helper the review job's three templates ship.
// ---------------------------------------------------------------------------

test('#259 fork-notice: writes the upsert_review_comment helper before announcing the skip, and calls it', async () => {
  const steps = await forkNoticeSteps();
  const helperIdx = steps.findIndex((s) => s && s.name === HELPER_STEP_NAME);
  assert.notEqual(helperIdx, -1, `fork-notice.yml.tmpl: no '${HELPER_STEP_NAME}' step`);
  assert.match(
    steps[helperIdx].run,
    /upsert_review_comment\(\) \{/,
    'fork-notice.yml.tmpl: helper step does not define the upsert_review_comment function',
  );

  const announceIdx = steps.findIndex((s) => s && s.name === ANNOUNCE_STEP_NAME);
  assert.notEqual(announceIdx, -1, `fork-notice.yml.tmpl: no '${ANNOUNCE_STEP_NAME}' step`);
  assert.ok(helperIdx < announceIdx, "fork-notice.yml.tmpl: 'Announce the skip' runs before the helper is written");
  assert.match(
    steps[announceIdx].run,
    /source "\$RUNNER_TEMP\/upsert-review-comment\.sh"/,
    'fork-notice.yml.tmpl: the announce step does not source the shared helper',
  );
  assert.match(
    steps[announceIdx].run,
    /upsert_review_comment /,
    'fork-notice.yml.tmpl: the announce step does not call upsert_review_comment',
  );
});

test('#259 fork-notice: no step calls `gh pr comment` directly, other than inside the helper itself', async () => {
  const steps = await forkNoticeSteps();
  for (const step of steps) {
    if (!step || step.name === HELPER_STEP_NAME || typeof step.run !== 'string') continue;
    assert.doesNotMatch(
      step.run,
      /gh pr comment "\$PR_NUMBER"/,
      `fork-notice.yml.tmpl: step '${step.name}' still calls 'gh pr comment' directly instead of upsert_review_comment`,
    );
  }
});

test('#259 fork-notice: the helper fetch paginates and searches by identity + the written-by marker', async () => {
  const steps = await forkNoticeSteps();
  const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);
  assert.match(helper.run, /gh api --paginate "repos\/\$\{repo\}\/issues\/\$\{pr\}\/comments/, 'fork-notice.yml.tmpl: helper fetch is not paginated');
  assert.match(helper.run, /<!-- written-by: \$\{identity\} -->/, 'fork-notice.yml.tmpl: helper does not use the written-by marker');
  // This job never runs actions/checkout (see the file's own SECURITY note),
  // so the fallback create call needs --repo explicitly — there is no local
  // git remote for `gh pr comment` to infer one from, unlike the review job's
  // copy of this same function.
  assert.match(
    helper.run,
    /gh pr comment "\$pr" --repo "\$repo" --body/,
    'fork-notice.yml.tmpl: helper fallback create is missing --repo (no checkout exists in this job)',
  );
});

test('#259 fork-notice BEHAVIOUR (busy fork PR): 150 pre-existing comments + a prior notice → the second run EDITS it, not a fresh one', async () => {
  const steps = await forkNoticeSteps();
  const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);

  const dir = mkdtempSync(join(tmpdir(), 'clud-bug-fork-notice-upsert-busy-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeFakeGh(binDir, { emulatePagination: true });

    const runnerTemp = join(dir, 'runnertemp');
    mkdirSync(runnerTemp);
    writeFileSync(join(dir, 'write-helper.sh'), helper.run);
    execFileSync('bash', ['-e', join(dir, 'write-helper.sh')], {
      env: { ...process.env, RUNNER_TEMP: runnerTemp, PATH: `${binDir}:${process.env.PATH}` },
    });

    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify(noiseComments(150)));
    const env = {
      ...process.env,
      RUNNER_TEMP: runnerTemp,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_GH_STATE: stateFile,
    };

    const driver1 = join(dir, 'driver1.sh');
    writeFileSync(
      driver1,
      `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment 42 "acme/widgets" "## 🐛 Clud Bug skipped — run 1"\n`,
    );
    execFileSync('bash', ['-e', driver1], { env });

    let state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.length, 151, `expected 150 noise + 1 notice after the FIRST call, got ${state.length}`);
    const botComment = state.find((c) => c.user.login === 'github-actions[bot]');
    assert.ok(botComment, 'notice comment not created');
    const firstId = botComment.id;

    const driver2 = join(dir, 'driver2.sh');
    writeFileSync(
      driver2,
      `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment 42 "acme/widgets" "## 🐛 Clud Bug skipped — run 2 (updated)"\n`,
    );
    execFileSync('bash', ['-e', driver2], { env });

    state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
    assert.equal(state.length, 151, `expected STILL 151 total comments after the SECOND call on a busy fork PR, got ${state.length}`);
    assert.equal(botComments.length, 1, `expected exactly 1 notice comment, found ${botComments.length} — the second run stacked a fresh one instead of finding the first past the 150-comment window`);
    assert.equal(botComments[0].id, firstId, 'the second call created a NEW notice comment instead of editing the first');
    assert.match(botComments[0].body, /run 2 \(updated\)/, 'the notice body was not updated on the second call');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#259 fork-notice CONTROL: the PRE-FIX ad hoc dedup (oldest-100, prefix match, no marker) loses the notice past the 100-comment window and duplicates it', async () => {
  // Reconstructs the exact pre-fix "Announce the skip" body — the ad hoc
  // `EXISTING=$(gh api ".../comments?per_page=100" --jq '... startswith("## 🐛 Clud Bug skipped") ...')`
  // dedup query fork-notice.yml.tmpl carried before this fix — against the
  // SAME 150-noise-comment fixture and the SAME fake-gh pagination
  // emulation, proving the busy-PR test above is pinned to something this
  // harness actually reproduces.
  const preFixRun = `
    EXISTING=$(gh api "repos/\${BASE_REPO}/issues/\${PR_NUMBER}/comments?per_page=100" \\
      --jq '[.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("## 🐛 Clud Bug skipped")))] | length' \\
      2>/dev/null || echo 0)
    if [ "\${EXISTING:-0}" != "0" ]; then
      exit 0
    fi
    BODY="$1"
    gh pr comment "$PR_NUMBER" --repo "$BASE_REPO" --body "$BODY"
  `;

  const dir = mkdtempSync(join(tmpdir(), 'clud-bug-fork-notice-upsert-busy-control-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    writeFakeGh(binDir, { emulatePagination: true });

    const stateFile = join(dir, 'state.json');
    writeFileSync(stateFile, JSON.stringify(noiseComments(150)));
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_GH_STATE: stateFile,
      BASE_REPO: 'acme/widgets',
      PR_NUMBER: '42',
    };

    const script = join(dir, 'pre-fix.sh');
    writeFileSync(script, preFixRun);
    execFileSync('bash', ['-e', script, '## 🐛 Clud Bug skipped — run 1'], { env });
    execFileSync('bash', ['-e', script, '## 🐛 Clud Bug skipped — run 2'], { env });

    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
    assert.equal(
      botComments.length,
      2,
      `control: pre-fix ad hoc dedup must create a SECOND notice comment on a busy fork PR (found ${botComments.length}) — otherwise this control does not reproduce the bug`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// LOOKUP FAILURE — a non-zero `gh api --paginate` exit (502, secondary rate
// limit, a dropped page) is a THIRD outcome, distinct from both "found" and
// "genuinely not found". The pre-fix line, `existing=$(gh api ... | tail
// -n1) || existing=""`, landed a lookup FAILURE in the exact same
// `existing=""` a real "not found" produces (the `||` only fires on
// `tail`'s own exit, which succeeds on empty input regardless of whether
// `gh api` upstream of it ever ran) — so a lookup failure fell through to
// CREATE, the second review comment SPEC §4.3's MUST forbids. Identical
// fix, identical test, across all four templates.
// ---------------------------------------------------------------------------

/**
 * A fake `gh` whose LOOKUP call (`gh api --paginate URL --jq EXPR`, no
 * `--method`) always fails after emitting page 1 — modelling a real `gh
 * api --paginate --jq` invocation that streams NDJSON as it walks pages
 * and then hits an HTTP error on the NEXT one (a 502, a secondary rate
 * limit): some output already reached stdout, but the overall command
 * exits non-zero. `--method PATCH` (edit) and `pr comment` (create) stay
 * fully functional, so a REGRESSION here (the status check dropped) is
 * observed as an actual extra comment in the state file, not merely a
 * different kind of harness error.
 */
function writeFakeGhFailingLookup(binDir) {
  const ghPath = join(binDir, 'gh');
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
STATE="\${FAKE_GH_STATE:?}"
[ -f "$STATE" ] || echo '[]' > "$STATE"
case "$1" in
  api)
    shift
    if [ "$1" = "--method" ]; then
      shift; shift; ENDPOINT="$1"; shift
      BODY=""
      while [ $# -gt 0 ]; do
        case "$1" in
          -f) shift; KV="$1"; shift; case "$KV" in body=*) BODY="\${KV#body=}";; esac ;;
          *) shift ;;
        esac
      done
      ID="\${ENDPOINT##*/}"
      jq --arg id "$ID" --arg body "$BODY" 'map(if (.id|tostring) == $id then .body = $body else . end)' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
      exit 0
    else
      PAGINATE=false
      JQEXPR=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --paginate) PAGINATE=true; shift ;;
          --jq) shift; JQEXPR="$1"; shift ;;
          *) shift ;;
        esac
      done
      if [ "$PAGINATE" = "true" ]; then
        # Page 1 (first 100) prints normally — a real gh has already
        # streamed this much to stdout — then the walk fails as if the
        # request for page 2 502'd.
        jq --argjson n 100 '.[0:$n]' "$STATE" | jq -r "$JQEXPR"
        echo "gh: HTTP 502 (Bad Gateway) fetching the next page" >&2
        exit 1
      fi
      jq -r "$JQEXPR" "$STATE"
      exit 0
    fi
    ;;
  pr)
    shift
    if [ "$1" = "comment" ]; then
      shift
      REPO=""
      BODY=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --repo) shift; REPO="$1"; shift ;;
          --body) shift; BODY="$1"; shift ;;
          *) shift ;;
        esac
      done
      NEWID=$(jq 'map(.id) | max' "$STATE" 2>/dev/null)
      [ "$NEWID" = "null" ] || [ -z "$NEWID" ] && NEWID=0
      NEWID=$((NEWID + 1))
      jq --argjson id "$NEWID" --arg body "$BODY" '. + [{"id": $id, "user": {"login": "github-actions[bot]"}, "body": $body}]' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
      exit 0
    fi
    ;;
esac
echo "fake gh: unhandled: $*" >&2
exit 1
`,
  );
  chmodSync(ghPath, 0o755);
}

/** 101 noise comments — enough that a real `gh api --paginate` walk has a genuine second page to fail on. */
function noise101() {
  const arr = [];
  for (let i = 1; i <= 101; i += 1) {
    arr.push({ id: i, user: { login: 'someone-else' }, body: `unrelated discussion #${i}` });
  }
  return arr;
}

/** Runs the given helper's `run:` script, sources it, and calls upsert_review_comment once. Returns { threw, status, stderr }. */
function runUpsertOnce(dir, helperRun, { pr = 42, repo = 'acme/widgets', body = '## Clud Bug review — run 1' } = {}) {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFakeGhFailingLookup(binDir);

  const runnerTemp = join(dir, 'runnertemp');
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(join(dir, 'write-helper.sh'), helperRun);
  execFileSync('bash', ['-e', join(dir, 'write-helper.sh')], {
    env: { ...process.env, RUNNER_TEMP: runnerTemp, PATH: `${binDir}:${process.env.PATH}` },
  });

  const stateFile = join(dir, 'state.json');
  writeFileSync(stateFile, JSON.stringify(noise101()));
  const env = { ...process.env, RUNNER_TEMP: runnerTemp, PATH: `${binDir}:${process.env.PATH}`, FAKE_GH_STATE: stateFile };

  const driver = join(dir, 'driver.sh');
  writeFileSync(
    driver,
    `set -euo pipefail\nsource "$RUNNER_TEMP/upsert-review-comment.sh"\nupsert_review_comment ${pr} "${repo}" "${body}"\n`,
  );
  let result = { threw: false, status: 0, stderr: '' };
  try {
    execFileSync('bash', ['-e', driver], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    result = { threw: true, status: e.status, stderr: `${e.stderr ?? ''}` };
  }
  return { ...result, stateFile };
}

for (const tmpl of WORKFLOW_TEMPLATES) {
  test(`#259/1 LOOKUP FAILURE (${tmpl}): a non-zero gh api exit does not fall through to CREATE`, async () => {
    const steps = await reviewSteps(tmpl);
    const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);
    const dir = mkdtempSync(join(tmpdir(), 'clud-bug-upsert-lookupfail-'));
    try {
      const { threw, status, stderr, stateFile } = runUpsertOnce(dir, helper.run);
      assert.ok(threw, `${tmpl}: upsert_review_comment did not fail the script on a lookup failure (exit ${status})`);
      assert.notEqual(status, 0, `${tmpl}: expected a non-zero exit on lookup failure`);
      assert.match(stderr, /::warning/, `${tmpl}: expected a ::warning:: on lookup failure, got: ${stderr}`);
      assert.match(stderr, /gh api exited/, `${tmpl}: warning does not name the failed lookup, got: ${stderr}`);

      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
      assert.equal(
        botComments.length,
        0,
        `${tmpl}: a lookup failure must not fall through to CREATE — found ${botComments.length} bot comment(s)`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('#259/1 LOOKUP FAILURE fork-notice: a non-zero gh api exit does not fall through to CREATE', async () => {
  const steps = await forkNoticeSteps();
  const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);
  const dir = mkdtempSync(join(tmpdir(), 'clud-bug-fork-notice-upsert-lookupfail-'));
  try {
    const { threw, status, stderr, stateFile } = runUpsertOnce(dir, helper.run, { body: '## 🐛 Clud Bug skipped — run 1' });
    assert.ok(threw, `fork-notice.yml.tmpl: upsert_review_comment did not fail the script on a lookup failure (exit ${status})`);
    assert.notEqual(status, 0, 'fork-notice.yml.tmpl: expected a non-zero exit on lookup failure');
    assert.match(stderr, /::warning/, `fork-notice.yml.tmpl: expected a ::warning:: on lookup failure, got: ${stderr}`);

    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
    assert.equal(
      botComments.length,
      0,
      `fork-notice.yml.tmpl: a lookup failure must not fall through to CREATE — found ${botComments.length} bot comment(s)`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#259/1 LOOKUP FAILURE CONTROL: the pre-fix shape (status swallowed by tail) DOES fall through to CREATE on a lookup failure', async () => {
  // Reconstructs the exact pre-fix `existing=` line — the status check
  // (and the `lookup_status` variable) dropped, `tail -n1` back in the
  // same pipeline as `gh api` — against the SAME failing-lookup fake gh.
  // This is the named mutation ruling 3 exists to catch: proves the
  // BEHAVIOUR tests above are pinned to something this harness actually
  // reproduces, not an artifact of a harness that can never create a
  // duplicate.
  const tmpl = WORKFLOW_TEMPLATES[0];
  const steps = await reviewSteps(tmpl);
  const helper = steps.find((s) => s && s.name === HELPER_STEP_NAME);

  // Slice out the whole fixed block (declaration through the post-guard
  // `tail -n1` re-extraction) by two small, unique anchors, rather than
  // hand-typing the full multi-line jq expression as a literal match —
  // less to keep byte-exact as the surrounding comments evolve.
  const startAnchor = 'local existing="" lookup_status=0';
  const endAnchor = "existing=$(printf '%s\\n' \"$existing\" | tail -n1)";
  const startIdx = helper.run.indexOf(startAnchor);
  assert.notEqual(startIdx, -1, 'guard text drifted: no `local existing="" lookup_status=0` found');
  const endIdx = helper.run.indexOf(endAnchor, startIdx);
  assert.notEqual(endIdx, -1, 'guard text drifted: no post-guard `tail -n1` re-extraction found');
  const blockEnd = endIdx + endAnchor.length;

  const preFixBlock =
    'local existing=""\n' +
    '            existing=$(gh api --paginate "repos/${repo}/issues/${pr}/comments?per_page=100" \\\n' +
    '              --jq ".[] | select(.user.login == \\"${identity}\\" and (.body | contains(\\"${marker}\\"))) | .id" \\\n' +
    '              2>/dev/null | tail -n1) || existing=""';
  const preFixRun = helper.run.slice(0, startIdx) + preFixBlock + helper.run.slice(blockEnd);
  assert.notEqual(preFixRun, helper.run, 'pre-fix substitution produced no change');

  const dir = mkdtempSync(join(tmpdir(), 'clud-bug-upsert-lookupfail-control-'));
  try {
    const { stateFile } = runUpsertOnce(dir, preFixRun);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const botComments = state.filter((c) => c.user.login === 'github-actions[bot]');
    assert.equal(
      botComments.length,
      1,
      `control: the pre-fix shape must fall through to CREATE on a lookup failure (found ${botComments.length} bot comment(s)) — otherwise this control does not reproduce the bug`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
