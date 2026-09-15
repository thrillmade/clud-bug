// .github/actions/strict-mode-gate/action.yml — the two base-ref-resolution
// guards (#291).
//
// #291's own fix comment names the bug this action.yml already carried one
// layer down from the templates' "Pin review skills to the base ref" step:
// `git show "origin/<base>:.claude/skills/.clud-bug.json" || { warning; exit
// 0; }` treated ANY read failure as "no manifest — strict mode is an
// opt-out", so a shallow clone, a missing `fetch-depth: 0`, or a deleted
// `.git` disabled strict mode for a repository whose base ref says
// `strictMode: true` — a green check for a config the gate never read. Both
// `run:` steps in this file replaced that one-line guard with a three-way
// check: does the base ref RESOLVE, does it DECLARE the manifest path, can
// the manifest be READ. Only the middle answer is a real opt-out.
//
// A round-3 pass fixed the first question (does it resolve) but answered the
// second with `git cat-file -e <commit>:<path>` — which asks whether the
// blob object is IN THE STORE, not whether the base ref declares the path.
// A declared-but-unreadable manifest (object corrupt/missing — an unreadable
// object, a broken index) gives `cat-file -e` the same failure as a manifest
// that was never committed, so the fail-open survived one layer in. A
// round-4 pass replaced it with `git rev-parse --verify --quiet
// <commit>:<path>`, on the theory that it walks the trees and needs no blob
// at all — true for a corrupt/missing LEAF blob, but rev-parse fails the
// same way `cat-file -e` did when an INTERMEDIATE tree (here,
// `.claude/skills` itself) is the object that's corrupt/missing, so the
// fail-open survived yet another layer in. The shipped fix replaces the
// declaration check with `git ls-tree <commit> -- <path>`: empty stdout +
// exit 0 means the path genuinely isn't declared, a nonzero exit means some
// tree along the way couldn't be read — which is where an unreadable
// manifest (blob OR tree) is finally allowed to fail.
//
// SHAPE — both `run:` steps declare `shell: bash` and read the manifest via
// `ls-tree`, not `rev-parse --verify --quiet` or `cat-file -e`.
//
// BEHAVIOUR — the real shell (extracted from action.yml with a YAML parser,
// not a regex) executed under `bash -eo pipefail` — the GitHub Actions
// runner's own documented default invocation for a `run:` step whose
// `shell:` is `bash` with no override — against real git repositories, for
// EACH of the two guard steps (they duplicate the same guard; #291 fixed it
// in exactly one place per step, not once for both):
//
//   1. an unresolvable base ref fails the check (exit 1) instead of
//      reviewing/gating with no config.
//   2. a base ref that resolves and genuinely declares no manifest is an
//      opt-out (exit 0) — strict mode is opt-in, this is an ordinary repo.
//   3. a base ref that resolves and DECLARES the manifest, but whose blob is
//      unreadable, fails the check (exit 1) — the fail-open both guards
//      exist to close.
//   4. a base ref that resolves and DECLARES the manifest, but whose
//      containing tree (`.claude/skills`, not the leaf blob) is unreadable,
//      also fails the check (exit 1) — the fail-open the round-4 rev-parse
//      guard reopened one layer up.
//
// CONTROL, for case 3: the fixture (a declared path whose blob object is
// deleted from the store) is only evidence of the bug if the round-3
// `cat-file -e` guard actually mishandles it. `#291 CONTROL` proves that:
// run the `cat-file -e` line in place of the shipped guard against the same
// fixture and it wrongly reports "declares no manifest" and exits 0.
// Without this, a green case-3 test could just mean the fixture never
// reproduced the corrupt-blob shape at all.
//
// CONTROL, for case 4: same reasoning, one layer up — the fixture (a
// declared path whose CONTAINING TREE object is deleted from the store) is
// only evidence of the round-4 bug if the round-4 `rev-parse` guard actually
// mishandles it. `#291 round-4 CONTROL` proves that: run the `rev-parse`
// line in place of the shipped `ls-tree` guard against the same fixture and
// it wrongly reports "declares no manifest" and exits 0.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ACTION_YML = join(PKG_ROOT, '.github/actions/strict-mode-gate/action.yml');

const GATE_STEP_NAME = 'Strict mode — fail check on critical findings';
const PER_SKILL_STEP_NAME = 'Per-skill check-runs (BB.3)';

/** The action's two `run:` steps, parsed once. */
let stepsCache = null;
function actionSteps() {
  if (stepsCache === null) {
    const doc = parseYaml(readFileSync(ACTION_YML, 'utf8'));
    stepsCache = doc.runs.steps;
  }
  return stepsCache;
}

function findStep(name) {
  const step = actionSteps().find((s) => s && s.name === name);
  assert.ok(step, `action.yml: no step named '${name}'`);
  return step;
}

const GUARD_STEPS = [
  ['gate', GATE_STEP_NAME],
  ['per-skill', PER_SKILL_STEP_NAME],
];

// ---------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------

for (const [label, name] of GUARD_STEPS) {
  test(`#291 [${label}]: step declares shell: bash`, () => {
    assert.equal(findStep(name).shell, 'bash', `${name}: relies on the runner's bash -eo pipefail default`);
  });

  test(`#291 [${label}]: manifest declaration is checked with ls-tree, not rev-parse or cat-file -e`, () => {
    const run = findStep(name).run;
    assert.doesNotMatch(
      run,
      /git cat-file -e/,
      `${name}: 'git cat-file -e' cannot tell "no manifest" from "manifest declared but its blob is gone" — see file header`,
    );
    assert.doesNotMatch(
      run,
      /git rev-parse --verify --quiet "\$\{?BASE_COMMIT\}?:\.claude\/skills\/\.clud-bug\.json"/,
      `${name}: 'git rev-parse <commit>:<path>' cannot tell "no manifest" from "an intermediate tree is unreadable" — see file header`,
    );
    assert.match(
      run,
      /git ls-tree "\$\{?BASE_COMMIT\}?" -- \.claude\/skills\/\.clud-bug\.json/,
      `${name}: expected a ls-tree <commit> -- <path> declaration check`,
    );
  });

  test(`#291 [${label}]: base ref is resolved (rev-parse …^{commit}) before the manifest is read`, () => {
    const run = findStep(name).run;
    const resolveIdx = run.indexOf('^{commit}');
    const declareIdx = run.indexOf('.claude/skills/.clud-bug.json');
    assert.ok(resolveIdx !== -1 && declareIdx !== -1 && resolveIdx < declareIdx, `${name}: base-ref resolution must precede the manifest read`);
  });
}

// ---------------------------------------------------------------------------
// BEHAVIOUR — run the real shell against real repos
// ---------------------------------------------------------------------------

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

/**
 * A bare-ish repo shaped like an Actions checkout with `fetch-depth: 0`:
 * a `main` branch commit plus the matching `refs/remotes/origin/main`
 * both guard steps read via `origin/${{ github.base_ref }}`.
 */
function makeBaseRepo({ withManifest, manifest = { strictMode: true } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cb291-gate-'));
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'repo\n');
  if (withManifest) {
    mkdirSync(join(root, '.claude/skills'), { recursive: true });
    writeFileSync(join(root, '.claude/skills/.clud-bug.json'), JSON.stringify(manifest) + '\n');
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

/** Delete the loose object backing `<HEAD>:.claude/skills/.clud-bug.json`. */
function corruptManifestBlob(root) {
  const blob = git(root, 'rev-parse', 'HEAD:.claude/skills/.clud-bug.json');
  const objPath = join(root, '.git/objects', blob.slice(0, 2), blob.slice(2));
  rmSync(objPath);
  // Confirm the corruption actually reproduces "declared but unreadable":
  // rev-parse (tree-only) still resolves, git show (needs the blob) fails.
  const declared = execFileSync('git', ['rev-parse', '--verify', '--quiet', `HEAD:.claude/skills/.clud-bug.json`], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(declared, blob, 'fixture bug: rev-parse no longer resolves the declared path after corrupting the blob');
  let readFailed = false;
  try {
    execFileSync('git', ['show', 'HEAD:.claude/skills/.clud-bug.json'], { cwd: root, stdio: 'pipe' });
  } catch {
    readFailed = true;
  }
  assert.ok(readFailed, 'fixture bug: git show still reads the manifest after its blob object was deleted');
}

/** Delete the loose object backing the `.claude/skills` TREE itself (not the leaf blob). */
function corruptSkillsTree(root) {
  const tree = git(root, 'rev-parse', 'HEAD:.claude/skills');
  const objPath = join(root, '.git/objects', tree.slice(0, 2), tree.slice(2));
  rmSync(objPath);
  // Confirm the corruption actually reproduces "declared, but the tree above
  // it is unreadable": ls-tree can no longer walk the path at all, and
  // rev-parse — the round-4 guard this fixture targets — fails to resolve
  // the path exactly like a path that was never committed, which is the bug.
  let lsTreeFailed = false;
  try {
    execFileSync('git', ['ls-tree', 'HEAD', '--', '.claude/skills/.clud-bug.json'], { cwd: root, stdio: 'pipe' });
  } catch {
    lsTreeFailed = true;
  }
  assert.ok(lsTreeFailed, 'fixture bug: git ls-tree still walks the path after the .claude/skills tree object was deleted');
  let revParseFailed = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD:.claude/skills/.clud-bug.json'], { cwd: root, stdio: 'pipe' });
  } catch {
    revParseFailed = true;
  }
  assert.ok(revParseFailed, 'fixture bug: git rev-parse should ALSO fail to resolve the path once its containing tree is gone — that shared failure is the round-4 bug');
}

/**
 * The `ls-tree` declaration-check block (from the `MANIFEST_ENTRY=`
 * assignment through the `if [ -z "$MANIFEST_ENTRY" ]; then` that follows),
 * so CONTROL tests can swap in an earlier round's declaration-check line
 * without touching the rest of the guard (base-ref resolution, the
 * blob-read failure branch).
 */
function declarationCheckBlock(run) {
  const start = run.indexOf('MANIFEST_ENTRY=$(git ls-tree');
  assert.notEqual(start, -1, 'guard text drifted: no ls-tree declaration-check block found');
  const marker = 'if [ -z "$MANIFEST_ENTRY" ]; then';
  const markerIdx = run.indexOf(marker, start);
  assert.notEqual(markerIdx, -1, 'guard text drifted: no matching if [ -z "$MANIFEST_ENTRY" ] found after ls-tree');
  return run.slice(start, markerIdx + marker.length);
}

/** Substitute the one GitHub expression these guards need for this test. */
function withBaseRef(run, baseRef) {
  return run.replaceAll('${{ github.base_ref }}', baseRef);
}

/**
 * Run a guard step's shell under the runner's own default invocation for a
 * `shell: bash` step with no override: `bash --noprofile --norc -eo
 * pipefail {0}` (GitHub Actions docs, "Shells").
 */
function runGuard(name, { cwd, baseRef = 'main' }) {
  const script = withBaseRef(findStep(name).run, baseRef);
  const scriptPath = join(cwd, '..', `guard-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(scriptPath, script);
  try {
    return { code: 0, out: execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

for (const [label, name] of GUARD_STEPS) {
  test(`#291 [${label}]: an unresolvable base ref fails the check`, () => {
    const root = makeBaseRepo({ withManifest: true });
    try {
      const { code, out } = runGuard(name, { cwd: root, baseRef: 'does-not-exist' });
      assert.equal(code, 1, `expected the guard to fail closed; got exit ${code}: ${out}`);
      assert.match(out, /Could not resolve/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`#291 [${label}]: a base ref that resolves and declares no manifest is a real opt-out`, () => {
    const root = makeBaseRepo({ withManifest: false });
    try {
      const { code, out } = runGuard(name, { cwd: root });
      assert.equal(code, 0, `expected an opt-out exit 0; got exit ${code}: ${out}`);
      assert.match(out, /declares no \.claude\/skills\/\.clud-bug\.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`#291 [${label}]: a declared manifest whose blob is unreadable fails the check`, () => {
    const root = makeBaseRepo({ withManifest: true });
    try {
      corruptManifestBlob(root);
      const { code, out } = runGuard(name, { cwd: root });
      assert.equal(code, 1, `expected the guard to fail closed on an unreadable manifest; got exit ${code}: ${out}`);
      assert.match(out, /could not be read/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`#291 [${label}] CONTROL: the round-3 'cat-file -e' guard mishandles the same fixture`, () => {
    const root = makeBaseRepo({ withManifest: true });
    try {
      corruptManifestBlob(root);
      // The round-3 line this guard replaced (see file header). Substituted
      // in place of the shipped ls-tree declaration-check block so the REST
      // of the guard (base-ref resolution, the read-failure branch) is
      // unchanged — isolating exactly the declaration check #291's fix
      // corrected.
      const run = withBaseRef(findStep(name).run, 'main');
      const mutated = run.replace(declarationCheckBlock(run), 'if ! git cat-file -e "${BASE_COMMIT}:.claude/skills/.clud-bug.json" 2>/dev/null; then');
      assert.notEqual(mutated, run, `${name}: mutation did not match — guard text drifted from what this test targets`);
      const scriptPath = join(root, '..', `guard-mut-${Math.random().toString(36).slice(2)}.sh`);
      writeFileSync(scriptPath, mutated);
      let result;
      try {
        result = { code: 0, out: execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (e) {
        result = { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      } finally {
        rmSync(scriptPath, { force: true });
      }
      // This is the bug, reproduced: the corrupted-blob fixture is read as
      // "no manifest declared" and the check goes green.
      assert.equal(result.code, 0, `fixture does not reproduce the round-3 bug (cat-file -e should wrongly exit 0 here); got ${result.code}: ${result.out}`);
      assert.match(result.out, /declares no \.claude\/skills\/\.clud-bug\.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`#291 [${label}]: a declared manifest whose containing tree is unreadable fails the check`, () => {
    const root = makeBaseRepo({ withManifest: true });
    try {
      corruptSkillsTree(root);
      const { code, out } = runGuard(name, { cwd: root });
      assert.equal(code, 1, `expected the guard to fail closed on an unreadable tree; got exit ${code}: ${out}`);
      assert.match(out, /Could not read the base ref's tree/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`#291 [${label}] round-4 CONTROL: the round-4 'rev-parse' declaration guard mishandles a corrupt tree`, () => {
    const root = makeBaseRepo({ withManifest: true });
    try {
      corruptSkillsTree(root);
      // The round-4 line this guard replaced (see file header). Substituted
      // in place of the shipped ls-tree declaration-check block so the REST
      // of the guard is unchanged — isolating exactly the declaration check
      // this fix corrected.
      const run = withBaseRef(findStep(name).run, 'main');
      const mutated = run.replace(
        declarationCheckBlock(run),
        'if ! git rev-parse --verify --quiet "${BASE_COMMIT}:.claude/skills/.clud-bug.json" >/dev/null 2>&1; then',
      );
      assert.notEqual(mutated, run, `${name}: mutation did not match — guard text drifted from what this test targets`);
      const scriptPath = join(root, '..', `guard-mut-${Math.random().toString(36).slice(2)}.sh`);
      writeFileSync(scriptPath, mutated);
      let result;
      try {
        result = { code: 0, out: execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (e) {
        result = { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      } finally {
        rmSync(scriptPath, { force: true });
      }
      // This is the round-4 bug, reproduced: the corrupted-tree fixture is
      // read as "no manifest declared" and the check goes green.
      assert.equal(result.code, 0, `fixture does not reproduce the round-4 bug (rev-parse should wrongly exit 0 here); got ${result.code}: ${result.out}`);
      assert.match(result.out, /declares no \.claude\/skills\/\.clud-bug\.json/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`#291 [${label}]: a resolvable base ref with strictMode: false short-circuits before any network call`, () => {
    const root = makeBaseRepo({ withManifest: true, manifest: { strictMode: false } });
    try {
      const { code, out } = runGuard(name, { cwd: root });
      assert.equal(code, 0, `expected exit 0 on strictMode: false; got exit ${code}: ${out}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
