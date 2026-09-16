// .github/actions/strict-mode-gate/action.yml — HIGH: the gate's comment
// fetch used to be a single windowed page (`sort=created&direction=desc&
// per_page=100`, no `--paginate`). `upsert_review_comment` (workflow.yml.
// tmpl) edits ONE comment in place per PR, so its `created_at` never
// advances while unrelated discussion piles up around it — once a PR
// carries more than ~100 OTHER comments, a single-page fetch can stop
// returning the bot's own review comment entirely. The gate then sees no
// review comment at all ("NONE" — advisory) and fails OPEN on a PR that
// actually has critical findings.
//
// Fix: `gh api --paginate` walks every page; a `jq` filter on the merged
// result narrows to comments authored by the identity this gate was told
// to read (`$BOT_LOGIN`) — IDENTITY ALONE, never the `<!-- written-by:
// ... -->` marker `upsert_review_comment` stamps. An earlier pass here
// required the marker too, and that was a second, independent fail-open:
// this gate's documented DEFAULT `bot-login`, `claude[bot]` (third-party
// `anthropics/claude-code-action`, not this repo's code), never stamps
// that marker, so requiring it found zero comments under the gate's own
// default usage — verdict NONE, exit 0, on a PR with a critical finding.
// `classifier.mjs`'s existing `selectReviewHeader` already re-derives
// identity per comment and walks newest-first for the header line; the
// marker is that helper's own business, never a fetch-time precondition.
//
// SHAPE — the gate step's `run:` uses `--paginate`, not a bare `?sort=
// created&direction=desc&per_page=100` fetch, and filters on identity
// alone.
//
// BEHAVIOUR — the REAL gate step script (extracted from action.yml with a
// YAML parser), executed end-to-end under `bash -eo pipefail` against a
// real git repo (base ref resolution + manifest, same convention as
// test/strict-mode-gate-base-ref.test.js) and a fake `gh` that persists a
// 151-comment fixture: ONE bot comment carrying the critical-findings
// header, dated OLDEST on the PR (the shape a recency-windowed fetch drops
// first — `upsert_review_comment` edits it in place, so its `created_at`
// never advances while everything else on the PR gets newer), plus 150
// "noise" comments from another user dated after it. Run with `bot-login`
// OMITTED (i.e. defaulted to `claude[bot]`, and the fixture's bot comment
// carries NO written-by marker — `claude[bot]` is third-party code that
// never stamps one) AND with `bot-login` explicitly set to a different
// identity that DOES stamp the marker, proving identity alone is both
// necessary and sufficient either way. The REAL classifier.mjs on disk
// does the header selection — this is genuinely end-to-end, not a mock of
// the classification logic.
//
// CONTROL (single page) — the exact pre-fix line (`?sort=created&
// direction=desc&per_page=100`, no `--paginate`, no `--jq '.[]' | jq -s`
// wrapper) run against the SAME fixture reproduces the bug: verdict NONE,
// exit 0 on a PR that has a critical finding waiting for it. Without this,
// a green BEHAVIOUR test above could just mean the fixture never
// exercised the window at all.
//
// CONTROL (marker required again) — reintroducing the marker requirement
// on top of `--paginate` (a partial revert of the fix above, not the
// pagination bug) reproduces the OTHER fail-open: under the gate's own
// default identity and a fixture with no written-by marker (the shape
// `claude[bot]` actually produces), the same verdict NONE / exit 0 comes
// back even though every page was walked.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ACTION_DIR = join(PKG_ROOT, '.github/actions/strict-mode-gate');
const ACTION_YML = join(ACTION_DIR, 'action.yml');
const GATE_STEP_NAME = 'Strict mode — fail check on critical findings';

function findGateStep() {
  const doc = parseYaml(readFileSync(ACTION_YML, 'utf8'));
  const step = doc.runs.steps.find((s) => s && s.name === GATE_STEP_NAME);
  assert.ok(step, `action.yml: no step named '${GATE_STEP_NAME}'`);
  return step;
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  }).trim();
}

/** A base repo with `.claude/skills/.clud-bug.json` declaring strictMode: true. */
function makeBaseRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cb-gate-window-'));
  git(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/.clud-bug.json'), JSON.stringify({ strictMode: true }) + '\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

/**
 * A fake `gh` that emulates single-page-vs---paginate windowing over a
 * comment fixture: `--paginate` walks the WHOLE fixture; its absence
 * returns only the first `per_page` (parsed from the URL) elements —
 * modelling "one page fetched, the rest never walked". The single-page
 * branch also honours `sort=created`/`direction=asc|desc` from the URL
 * (GitHub's own default order for issue comments is `direction=asc`, i.e.
 * oldest-first) by sorting the fixture on `created_at` before slicing —
 * without this, "which per_page comments come back" is just file order,
 * and a CONTROL built on `direction=desc` would pass or fail by accident
 * of how the fixture array happens to be written, not because a
 * recency-descending window actually excludes the oldest item. Separately
 * emulates gh's own `--jq` contract: when `--jq EXPR` is given, EXPR is
 * applied (matching the real fix's `--jq '.[]'`, which flattens to
 * NDJSON); when it is absent (the pre-fix shape), stdout is the raw JSON
 * array — exactly what `gh api URL` (no `--jq`) returns, and what
 * `JSON.parse(COMMENTS_JSON)` in the classifier driver expects.
 */
function writeFakeGh(binDir, fixturePath) {
  const ghPath = join(binDir, 'gh');
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
STATE="${fixturePath}"
if [ "$1" = "api" ]; then
  shift
  PAGINATE=false
  JQ_GIVEN=false
  JQEXPR="."
  URL=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --paginate) PAGINATE=true; shift ;;
      --jq) JQ_GIVEN=true; shift; JQEXPR="$1"; shift ;;
      *) [ -z "$URL" ] && URL="$1"; shift ;;
    esac
  done
  if [ "$PAGINATE" = "true" ]; then
    DATA="$STATE"
  else
    PER_PAGE=$(printf '%s' "$URL" | grep -o 'per_page=[0-9]*' | cut -d= -f2)
    [ -z "$PER_PAGE" ] && PER_PAGE=30
    DIRECTION=$(printf '%s' "$URL" | grep -o 'direction=[a-z]*' | cut -d= -f2 || true)
    [ -z "$DIRECTION" ] && DIRECTION=asc
    DATA="$STATE.page"
    if [ "$DIRECTION" = "desc" ]; then
      jq --argjson n "$PER_PAGE" 'sort_by(.created_at) | reverse | .[0:$n]' "$STATE" > "$DATA"
    else
      jq --argjson n "$PER_PAGE" 'sort_by(.created_at) | .[0:$n]' "$STATE" > "$DATA"
    fi
  fi
  if [ "$JQ_GIVEN" = "true" ]; then
    jq -c "$JQEXPR" "$DATA"
  else
    cat "$DATA"
  fi
  exit 0
fi
echo "fake gh: unhandled: $*" >&2
exit 1
`,
  );
  chmodSync(ghPath, 0o755);
}

/**
 * ONE bot review comment carrying the critical-findings header, dated the
 * OLDEST comment on the PR, plus 150 "noise" comments from another user
 * dated after it — the shape `upsert_review_comment`'s edit-in-place
 * actually produces on a busy PR (the bot's `created_at` never advances;
 * everything else keeps getting newer). A recency-`desc`, single-page
 * fetch ranks this comment LAST and drops it; `--paginate` cannot miss it
 * regardless of rank.
 *
 * `author`/`withMarker` model the two identities this gate reads:
 * `claude[bot]` (this gate's documented DEFAULT `bot-login`) is
 * third-party `anthropics/claude-code-action` code and never stamps a
 * `<!-- written-by: ... -->` marker; an identity posting through this
 * repo's own `upsert_review_comment` (e.g. `github-actions[bot]`) does.
 */
function busyPrFixture({ author = 'claude[bot]', withMarker = false } = {}) {
  const base = Date.parse('2026-01-01T00:00:00Z');
  const reviewBody = withMarker
    ? `## 🐛 Clud Bug review — critical findings\n\n1 critical\n\n<!-- written-by: ${author} -->`
    : '## 🐛 Clud Bug review — critical findings\n\n1 critical';
  const arr = [
    { id: 1, user: { login: author }, body: reviewBody, created_at: new Date(base - 86400000).toISOString() },
  ];
  for (let i = 2; i <= 151; i += 1) {
    arr.push({ id: i, user: { login: 'someone-else' }, body: `unrelated discussion #${i}`, created_at: new Date(base + i * 1000).toISOString() });
  }
  return arr;
}

/** Run a script (already substituted for `${{ github.base_ref }}`) end-to-end. */
function runScript(script, { cwd, env }) {
  const scriptPath = join(cwd, '..', `gate-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(scriptPath, script);
  try {
    return {
      code: 0,
      out: execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      }),
    };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

function substituteGithubExprs(run, { repository, actionPath }) {
  return run
    .replaceAll('${{ github.base_ref }}', 'main')
    .replaceAll('${{ github.repository }}', repository)
    .replaceAll('${{ github.action_path }}', actionPath);
}

/**
 * The `COMMENTS_JSON=$(gh api --paginate ...)` assignment (through its
 * closing `)`), so the CONTROL test can swap in the pre-fix single-page
 * fetch without touching the rest of the script (base-ref/manifest
 * resolution, classifier invocation, verdict dispatch).
 */
function commentsFetchBlock(run) {
  const start = run.indexOf('COMMENTS_JSON=$(gh api --paginate');
  assert.notEqual(start, -1, 'guard text drifted: no COMMENTS_JSON=$(gh api --paginate ...) assignment found');
  const end = run.indexOf(")]')", start);
  assert.notEqual(end, -1, 'guard text drifted: no closing )]\')  found after COMMENTS_JSON=');
  return run.slice(start, end + ")]')".length);
}

test('HIGH: the gate step fetches comments with --paginate, not a single windowed page, and filters on identity alone', () => {
  const run = findGateStep().run;
  assert.doesNotMatch(
    run,
    /gh api "repos\/\$\{\{ github\.repository \}\}\/issues\/\$\{PR_NUMBER\}\/comments\?sort=created&direction=desc&per_page=100"/,
    'gate step still fetches a single sort=desc&per_page=100 page',
  );
  assert.match(run, /gh api --paginate "repos\/\$\{\{ github\.repository \}\}\/issues\/\$\{PR_NUMBER\}\/comments\?per_page=100" --jq '\.\[\]'/);
  assert.match(
    commentsFetchBlock(run),
    /select\(\(\.user\.login \/\/ ""\) == \$bot\)/,
    'gate step no longer filters the paginated result on identity alone',
  );
  assert.doesNotMatch(
    commentsFetchBlock(run),
    /written-by/,
    'gate step still requires the written-by marker as a fetch-time precondition — fails open under its own documented default bot-login',
  );
});

test('HIGH BEHAVIOUR: a critical review comment, OLDEST on a busy PR, still fails the check with bot-login OMITTED (defaults to claude[bot], no written-by marker)', () => {
  const root = makeBaseRepo();
  const dir = mkdtempSync(join(tmpdir(), 'cb-gate-window-run-default-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const fixturePath = join(dir, 'comments.json');
    // author defaults to 'claude[bot]', withMarker defaults to false — this
    // gate's own documented default bot-login, and the real shape that
    // identity's comments carry (third-party code, no written-by marker).
    writeFileSync(fixturePath, JSON.stringify(busyPrFixture()));
    writeFakeGh(binDir, fixturePath);

    const script = substituteGithubExprs(findGateStep().run, { repository: 'acme/widgets', actionPath: ACTION_DIR });
    const { code, out } = runScript(script, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        PR_NUMBER: '42',
        BOT_LOGIN: 'claude[bot]', // what `${{ inputs.bot-login }}` resolves to when a caller omits `with: bot-login:`
        GH_TOKEN: 'lint-only-placeholder',
      },
    });

    assert.equal(code, 1, `expected the gate to FAIL the check (critical finding present); got exit ${code}: ${out}`);
    assert.match(out, /Critical issues found/, `expected the CRITICAL branch; got: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HIGH BEHAVIOUR: a critical review comment, OLDEST on a busy PR, still fails the check with bot-login explicitly SET (a marker-stamping identity)', () => {
  const root = makeBaseRepo();
  const dir = mkdtempSync(join(tmpdir(), 'cb-gate-window-run-explicit-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const fixturePath = join(dir, 'comments.json');
    writeFileSync(fixturePath, JSON.stringify(busyPrFixture({ author: 'github-actions[bot]', withMarker: true })));
    writeFakeGh(binDir, fixturePath);

    const script = substituteGithubExprs(findGateStep().run, { repository: 'acme/widgets', actionPath: ACTION_DIR });
    const { code, out } = runScript(script, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        PR_NUMBER: '42',
        BOT_LOGIN: 'github-actions[bot]',
        GH_TOKEN: 'lint-only-placeholder',
      },
    });

    assert.equal(code, 1, `expected the gate to FAIL the check (critical finding present); got exit ${code}: ${out}`);
    assert.match(out, /Critical issues found/, `expected the CRITICAL branch; got: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HIGH CONTROL (single page): the pre-fix single-page shape loses the OLDEST comment and fails OPEN', () => {
  const root = makeBaseRepo();
  const dir = mkdtempSync(join(tmpdir(), 'cb-gate-window-control-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const fixturePath = join(dir, 'comments.json');
    // Identity matches BOT_LOGIN below so the ONLY thing this control can
    // be failing on is the recency window, not an unrelated identity
    // mismatch the fixed code would also reject.
    writeFileSync(fixturePath, JSON.stringify(busyPrFixture({ author: 'github-actions[bot]' })));
    writeFakeGh(binDir, fixturePath);

    const run = findGateStep().run;
    const preFix = run.replace(
      commentsFetchBlock(run),
      'COMMENTS_JSON=$(gh api "repos/${{ github.repository }}/issues/${PR_NUMBER}/comments?sort=created&direction=desc&per_page=100")',
    );
    assert.notEqual(preFix, run, 'pre-fix substitution did not match — the gate step text drifted from what this control targets');
    const script = substituteGithubExprs(preFix, { repository: 'acme/widgets', actionPath: ACTION_DIR });
    const { code, out } = runScript(script, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        PR_NUMBER: '42',
        BOT_LOGIN: 'github-actions[bot]',
        GH_TOKEN: 'lint-only-placeholder',
      },
    });

    // This is the bug, reproduced: the OLDEST comment ranks 151st once the
    // fake gh actually sorts by direction=desc, so it falls outside the
    // single 100-item window (no --paginate) and the gate sees no review
    // comment at all — green on a PR that actually has a critical finding.
    assert.equal(code, 0, `fixture does not reproduce the pre-fix bug (should wrongly exit 0); got ${code}: ${out}`);
    assert.match(out, /No clud-bug review comment found yet/, `expected the NONE branch; got: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HIGH CONTROL (marker required again): re-requiring the written-by marker on top of --paginate fails OPEN under the default identity', () => {
  // This is NOT the pagination bug — --paginate is intact here. It is the
  // OTHER fail-open: an earlier pass AND-ed the identity filter with a
  // `<!-- written-by: ... -->` marker requirement. `claude[bot]` (this
  // gate's own documented default bot-login) never stamps that marker, so
  // requiring it finds zero comments under the gate's own default usage —
  // reproduced against the SAME busy-PR fixture the BEHAVIOUR test above
  // proves passes with the real (identity-only) filter.
  const root = makeBaseRepo();
  const dir = mkdtempSync(join(tmpdir(), 'cb-gate-window-marker-control-'));
  try {
    const binDir = join(dir, 'bin');
    mkdirSync(binDir);
    const fixturePath = join(dir, 'comments.json');
    writeFileSync(fixturePath, JSON.stringify(busyPrFixture())); // default: claude[bot], no marker
    writeFakeGh(binDir, fixturePath);

    const run = findGateStep().run;
    const markerRequired = run.replace(
      commentsFetchBlock(run),
      `COMMENTS_JSON=$(gh api --paginate "repos/\${{ github.repository }}/issues/\${PR_NUMBER}/comments?per_page=100" --jq '.[]' \\\n          | jq -s --arg marker "<!-- written-by: \${BOT_LOGIN} -->" '[.[] | select((.body // "") | contains($marker))]')`,
    );
    assert.notEqual(markerRequired, run, 'marker-required substitution did not match — the gate step text drifted from what this control targets');
    const script = substituteGithubExprs(markerRequired, { repository: 'acme/widgets', actionPath: ACTION_DIR });
    const { code, out } = runScript(script, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        PR_NUMBER: '42',
        BOT_LOGIN: 'claude[bot]',
        GH_TOKEN: 'lint-only-placeholder',
      },
    });

    // Every page WAS walked (--paginate is untouched); the marker
    // requirement alone is what loses the comment — under the gate's own
    // documented default identity, `claude[bot]` never stamps one.
    assert.equal(code, 0, `fixture does not reproduce the marker-required bug (should wrongly exit 0); got ${code}: ${out}`);
    assert.match(out, /No clud-bug review comment found yet/, `expected the NONE branch; got: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
