// clud-bug#291 — everything that DEFINES the gate (SPEC 2.0 §6.3) must be
// read from the PR's base ref, never the merge/head ref: config, strict
// mode, skills (already covered by #260/#288's pin — see
// test/skills-base-ref.test.js), and the instruction files a reviewing
// session loads (CLAUDE.md, .claude/**, AGENTS.md, and whatever those
// themselves `@`-import, recursively).
//
// PREMISE, checked before writing anything here (STEP 0 of this lane's
// brief): claude-code-action's own `restoreConfigFromBase` already restores
// CLAUDE.md, CLAUDE.local.md and the whole `.claude/` tree from the PR base
// branch before its CLI reads anything — present since v1.0.133, the
// version already pinned in DEFAULTS.CCA_VERSION (verified directly against
// that tag's source: SENSITIVE_PATHS in
// anthropics/claude-code-action@v1.0.133's
// src/github/operations/restore-config.ts). AGENTS.md is NOT in that list,
// and neither is anything those files `@`-import (this repo's own CLAUDE.md
// is exactly `@AGENTS.md`) — Claude Code resolves `@`-import targets against
// whatever sits in the workspace, and only the roots were restored, not what
// they point to.
//
// ROUND 3 rewrites how the import set is DISCOVERED, because round 2's
// version was itself exploitable. Round 2 read import lines from "either the
// workspace copy or the base-ref copy" and then ran `rm -rf -- "$TARGET"`
// over the result, so every candidate past the two seeds was chosen by the
// pull request: a PR `CLAUDE.md` containing `@.git` deleted the git
// directory (which in turn makes the strict-mode gate's
// `git show origin/<base>:.claude/skills/.clud-bug.json` fail and the gate
// exit 0 — a PR disabling strict mode on itself), and a PR-committed symlink
// in a leading path segment walked the delete outside the checkout. Round 3
// makes those unrepresentable rather than patching each one:
//
//   * DISCOVERY READS $PIN AND NOTHING ELSE — no candidate path can come
//     from bytes the pull request controls.
//   * The filesystem is only ever touched through `pin_to_base`, which
//     refuses a symlinked or non-directory leading segment, refuses a leaf
//     that is a directory, uses `rm -f` (never `-r`), and restores only a
//     path that is a BLOB in the base ref.
//   * The parser follows the imports Claude Code actually follows: inline
//     `@path` anywhere on a line, and never inside a code span or fence.
//   * The launch roots are the ones Claude Code documents — `./CLAUDE.md`,
//     `./.claude/CLAUDE.md`, `./CLAUDE.local.md` — plus `AGENTS.md`, and
//     the recursion runs to Claude Code's own documented four-hop maximum.
//
// This test locks in that the three templates say all of this honestly, in
// lockstep, rather than silently drifting apart or reverting to the earlier
// "AGENTS.md is never auto-loaded, so it needs no pin" claim once believed
// true. The BEHAVIOUR block further down runs the real extracted shell
// against real git fixtures, the same way test/skills-base-ref.test.js
// proves the #260 skills pin.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  symlinkSync,
  statSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { reviewPrompt } from '../src/core/prompts.js';
import { renderFile, templateLanguage, DEFAULTS } from '../src/core/render.js';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(PKG_ROOT, 'templates');
const WORKFLOW_TEMPLATES = ['workflow.yml.tmpl', 'workflow-ts.yml.tmpl', 'workflow-py.yml.tmpl'];
const PIN_STEP_NAME = 'Pin review skills to the base ref';
const REVIEW_JOB = 'review';

async function render(tmpl) {
  return renderFile(join(TEMPLATES, tmpl), {
    REVIEW_PROMPT: reviewPrompt({ projectDescription: 'p', language: templateLanguage(tmpl) }),
  });
}

/** Parse the rendered workflow and return the pin step's `run:` shell. */
async function pinStepShell(tmpl) {
  const doc = parseYaml(await render(tmpl));
  const steps = doc.jobs[REVIEW_JOB].steps;
  const step = steps.find((s) => s && s.name === PIN_STEP_NAME);
  assert.ok(step, `${tmpl}: no '${PIN_STEP_NAME}' step`);
  return step.run;
}

test('#291: every workflow template documents that claude-code-action itself restores CLAUDE.md/.claude/** from the base branch', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    assert.match(out, /clud-bug#291/, `${tmpl}: no #291 reference`);
    assert.match(out, /restoreConfigFromBase/, `${tmpl}: does not name the upstream mechanism`);
    assert.match(out, /CLAUDE\.md/, `${tmpl}: does not mention CLAUDE.md`);
    // The claimed mechanism belongs to the exact claude-code-action version
    // this template pins — not a version-agnostic claim that could go stale
    // the next time CCA_VERSION bumps without re-verifying.
    assert.match(out, new RegExp(DEFAULTS.CCA_VERSION.replace(/\./g, '\\.')), `${tmpl}: does not tie the claim to the pinned CCA_VERSION`);
  }
});

test('#291: every workflow template documents that AGENTS.md is pinned to the base ref, with the evidence', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    assert.match(out, /AGENTS\.md/, `${tmpl}: no AGENTS.md mention in the security notes`);
    // The false "never auto-loaded, so it needs no pin" claim this replaces
    // must not come back.
    assert.doesNotMatch(out, /AGENTS\.md is deliberately NOT in that list, and does not need to/, `${tmpl}: reverted to the false "AGENTS.md needs no pin" claim`);
    assert.match(out, /`@`-imports it|@AGENTS\.md.*import/, `${tmpl}: does not explain the transitive-import hazard`);
  }
});

test('#291: the base-ref pin step seeds the import set with the documented launch roots, and restores every path in it generically', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    // Claude Code's memory docs: project instructions are "./CLAUDE.md or
    // ./.claude/CLAUDE.md", local instructions "./CLAUDE.local.md".
    // AGENTS.md rides along because this repo's own CLAUDE.md imports it and
    // the other agents AGENTS.md addresses read it directly.
    assert.match(out, /ROOTS=\(CLAUDE\.md \.claude\/CLAUDE\.md CLAUDE\.local\.md AGENTS\.md\)/, `${tmpl}: import set is not seeded with the documented launch roots`);
    assert.match(out, /IMPORT_SET=\("\$\{ROOTS\[@\]\}"\)/, `${tmpl}: the import set is not seeded from ROOTS`);
    // Every root is expanded, not just CLAUDE.md: seeding a root into
    // IMPORT_SET without also seeding the frontier would make the membership
    // check swallow it and silently drop its own imports.
    assert.match(out, /FRONTIER=\("\$\{ROOTS\[@\]\}"\)/, `${tmpl}: the frontier is not seeded from every root`);
    // ONE loop, not a second AGENTS.md-specific block: the per-path restore
    // must operate on a loop variable, never the literal name "AGENTS.md"
    // (that would be the round-1 shape round 2 replaced).
    assert.match(out, /pin_to_base "\$TARGET"/, `${tmpl}: the per-path loop does not route through the single pin primitive`);
    assert.doesNotMatch(out, /rm -f AGENTS\.md/, `${tmpl}: reverted to the round-1 AGENTS.md-specific delete`);
  }
});

test('#291: nothing in the pin step runs a recursive delete on a path the import scan produced', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const shell = await pinStepShell(tmpl);
    // `rm -rf` with a VARIABLE argument is the round-2 vulnerability: it made
    // every discovered path an argument to a recursive delete.
    assert.doesNotMatch(shell, /rm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(--\s+)?["']?\$/, `${tmpl}: a recursive delete still takes a variable path`);
    assert.match(shell, /rm -f -- "\$target"/, `${tmpl}: the pin primitive does not use a non-recursive delete`);
    // Only a blob is ever restored — a `@src` or `@.git` import must not be
    // able to name a tree and have it extracted over the workspace.
    assert.match(shell, /git cat-file -t "\$\{PIN\}:\$\{target\}"/, `${tmpl}: does not type-check the base-ref object before restoring`);
    assert.match(shell, /= *blob/, `${tmpl}: does not require the base-ref object to be a blob`);
  }
});

test('#291: the fixed-literal `rm -rf .claude/skills` unlinks a PR-committed `.claude` symlink first, so the delete cannot reach outside the checkout', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const shell = await pinStepShell(tmpl);
    // `rm -rf` resolves symlinks in INTERMEDIATE segments: with `.claude` a
    // link the PR committed, #260's fail-closed literal deletes whatever it
    // points at. The literal is only safe once the link itself is unlinked,
    // so EVERY occurrence of it has to be preceded by that guard — not just
    // the first one.
    const lines = shell.split('\n');
    const deletes = lines
      .map((line, i) => [line, i])
      .filter(([line]) => /^\s*rm -rf \.claude\/skills\s*$/.test(line));
    assert.ok(deletes.length > 0, `${tmpl}: the fail-closed skills delete is gone`);
    for (const [, i] of deletes) {
      const prev = lines.slice(0, i).reverse().find((l) => l.trim() !== '' && !/^\s*#/.test(l));
      assert.match(
        prev ?? '',
        /^\s*unlink_symlink \.claude$/,
        `${tmpl}: 'rm -rf .claude/skills' at line ${i + 1} of the step is not guarded by unlinking a '.claude' symlink first`,
      );
    }
    // Link-only removal, never a followed one: `rm -f` on a symlink unlinks
    // the link, `rm -rf` would take the tree behind it.
    assert.match(shell, /unlink_symlink\(\) \{[^}]*rm -f -- "\$1"/s, `${tmpl}: the symlink primitive does not unlink the link itself`);
    assert.doesNotMatch(shell, /unlink_symlink\(\) \{[^}]*rm -rf/s, `${tmpl}: the symlink primitive deletes recursively`);
  }
});

test('#291: the pin primitive hard-denies `.git` and everything under it, unconditionally', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const shell = await pinStepShell(tmpl);
    // Bare `.git` survives the other checks only incidentally (it happens to
    // be a directory); `.git/HEAD` is a file and reaches the delete. One
    // benign base-ref sentence naming `@.git/HEAD` is enough — and deleting
    // it makes the strict-mode gate's `git show origin/<base>:…` fail, which
    // is the fail-open this whole step exists to close.
    assert.match(shell, /\*\/\.git\/\*\)/, `${tmpl}: the pin primitive has no unconditional .git deny`);
    assert.match(shell, /the git directory is never an instruction file/, `${tmpl}: no refusal notice for a .git target`);
    // The deny is the primitive's FIRST act, ahead of every shape check, so
    // it cannot depend on `.git` happening to be a directory in a workspace
    // the pull request wrote.
    const body = shell.slice(shell.indexOf('pin_to_base() {'));
    assert.ok(
      body.indexOf('*/.git/*)') < body.indexOf('rm -f -- "$target"'),
      `${tmpl}: the .git deny does not precede the delete it protects`,
    );
  }
});

test('#291: import discovery reads the base ref only — never the PR-controlled workspace copy', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const shell = await pinStepShell(tmpl);
    assert.match(shell, /git cat-file -p "\$\{PIN\}:\$1"/, `${tmpl}: discovery does not read the base-ref copy`);
    // Round 2 read the workspace copy first (`[ -f "$1" ] && cat "$1"`),
    // which is what made every candidate past the seeds attacker-chosen.
    assert.doesNotMatch(shell, /\[ -f "\$1" \] && cat "\$1"/, `${tmpl}: discovery reads the PR's own workspace copy again`);
  }
});

test('#291: every workflow template follows `@`-imports to Claude Code\'s documented four-hop maximum and validates every candidate path', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    // Four hops, matching "a maximum depth of four hops" in Claude Code's
    // own memory docs — a chain this loop stops short of is one the CLI
    // would still have followed.
    assert.match(out, /for DEPTH in 1 2 3 4; do/, `${tmpl}: import recursion does not run to the documented four hops`);
    // Path validation: absolute and `~`-relative targets are rejected with a
    // notice. A relative target is normalised first and rejected only if the
    // normal form leaves the checkout — see the next test for why a blanket
    // ".." refusal is fail-OPEN.
    assert.match(out, /\/\*\|~\*\)/, `${tmpl}: does not reject absolute/home-relative import paths`);
    assert.match(out, /Rejected import/, `${tmpl}: no rejection notice for invalid import paths`);
    // A string test cannot see a ".." that lives inside a committed symlink,
    // so the filesystem-shape guard has to exist as well.
    assert.match(out, /\[ -L "\$probe" \]/, `${tmpl}: does not check a leading path segment for a symlink`);
    // And it UNLINKS that segment rather than giving up on the path: a
    // symlink whose target is a directory the PR itself committed resolves
    // INSIDE the checkout, so refusing leaves the reviewer loading the PR's
    // own bytes with no approval dialog — fail-open, not fail-visible.
    const shell = await pinStepShell(tmpl);
    assert.match(shell, /if \[ -L "\$probe" \]; then\n\s*unlink_symlink "\$probe"/, `${tmpl}: a symlinked leading segment aborts the pin instead of being unlinked`);
    assert.doesNotMatch(shell, /is a symlink in this workspace/, `${tmpl}: reverted to refusing the pin on a symlinked leading segment`);
  }
});

test('#291: an import path is lexically normalised, and only one whose normal form leaves the checkout is refused', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    const shell = await pinStepShell(tmpl);
    // The memory docs define the thing behind Claude Code's approval dialog
    // as an import whose "path resolves outside your working directory". A
    // `..` that resolves back INSIDE is an ordinary import the CLI loads with
    // no dialog at all, so refusing to pin it is fail-OPEN: the PR keeps
    // supplying the bytes at a path the reviewer reads as instructions.
    assert.match(shell, /normalise_path\(\) \{/, `${tmpl}: import paths are never normalised`);
    assert.doesNotMatch(shell, /\*\/\.\.\/\*\)/, `${tmpl}: reverted to refusing every ".." import by string test`);
    assert.match(shell, /RESOLVED="\$NORMALISED"/, `${tmpl}: the resolved import is not the normalised path`);
    assert.match(out, /resolves outside your working directory/, `${tmpl}: does not quote the rule it implements`);
    // Normalisation is also what keeps the delete and the restore addressing
    // the same object: `rm -f` removes `docs/./b.md`, and
    // `git cat-file -t "<sha>:docs/./b.md"` cannot address it — so the
    // un-normalised form deleted base content and then reported the base ref
    // "declares no docs/./b.md".
    assert.match(shell, /\[ -z "\$out" \] && return 1/, `${tmpl}: normalisation does not refuse a path that normalises to the checkout root`);
  }
});

test('#291: the pin step declares the shell it is written for, and no single unpinnable path can abort the loop', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const doc = parseYaml(await render(tmpl));
    const step = doc.jobs[REVIEW_JOB].steps.find((s) => s && s.name === PIN_STEP_NAME);
    // The step is bash-only (arrays, process substitution) AND depends on
    // `-e` NOT aborting it mid-loop. Both were inherited from the runner's
    // default rather than stated.
    assert.equal(step.shell, 'bash', `${tmpl}: the pin step does not declare the shell its syntax requires`);
    // Under `-e`, one failed `rm` ends the step and every target after it
    // keeps the PR's bytes. A path this step cannot delete is a path it
    // refuses, announced — not a reason to stop pinning the rest.
    assert.match(step.run, /rm -f -- "\$target" \|\| \{/, `${tmpl}: a failed delete still aborts the whole pin loop`);
  }
});

test('#291: the loop runs exactly the hop maximum the memory docs state, and quotes the sentence it derives it from', async () => {
  const WORD_TO_N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    const quoted = out.match(/with a maximum depth of ([a-z]+) hops/);
    assert.ok(quoted, `${tmpl}: the comment does not quote the memory docs' own hop maximum`);
    const documented = WORD_TO_N[quoted[1]];
    assert.ok(documented, `${tmpl}: "${quoted[1]} hops" is not a count this test can check against the loop`);
    const bound = (await pinStepShell(tmpl)).match(/for DEPTH in ([\d ]+); do/);
    assert.ok(bound, `${tmpl}: the import recursion is not a bounded for-loop`);
    // Shallower than the CLI is a chain the reviewer reads from the PR;
    // deeper is a file the CLI never loads pinned to base bytes the PR
    // legitimately changed. The two numbers have to be the same one.
    assert.deepEqual(
      bound[1].trim().split(/\s+/).map(Number),
      Array.from({ length: documented }, (_, i) => i + 1),
      `${tmpl}: the loop runs ${bound[1].trim()} while the comment quotes "${quoted[1]} hops"`,
    );
  }
});

test('#291: the import parser states its two rules and implements both (inline imports, code spans/fences skipped)', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    const shell = await pinStepShell(tmpl);
    // Rule 1 — an import is `@<path>` anywhere on a line, not only alone on
    // one. Round 2's `^@…$` grep silently dropped every inline form the docs
    // show, so a PR supplied those instruction files.
    assert.doesNotMatch(shell, /grep -E '\^@\[\^\[:space:\]\]\+\[\[:space:\]\]\*\$'/, `${tmpl}: reverted to the whole-line-only import parser`);
    assert.match(shell, /\[\[:space:\]\]@\[\^\[:space:\]\]\+/, `${tmpl}: does not match an inline "@<path>" import`);
    // Rule 2 — code spans and fenced code blocks are not parsed.
    assert.match(shell, /gsub\(\/`\[\^`\]\*`\//, `${tmpl}: does not strip Markdown code spans before scanning`);
    assert.match(shell, /fence = !fence/, `${tmpl}: does not skip fenced code blocks`);
    // Both rules quoted from the source that defines them, so a future
    // reader can check the parser against the docs rather than against us.
    assert.match(out, /anywhere in your CLAUDE\.md/, `${tmpl}: rule 1 is not quoted from the memory docs`);
    assert.match(out, /skips Markdown code spans and fenced code blocks/, `${tmpl}: rule 2 is not quoted from the memory docs`);
  }
});

test('#291: a relative import resolves against the importing file\'s directory, as Claude Code does', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    const shell = await pinStepShell(tmpl);
    assert.match(shell, /dir=\$\(dirname -- "\$from"\)/, `${tmpl}: import paths are not resolved against the importing file`);
    assert.match(out, /relative to the file containing the import/, `${tmpl}: does not state the resolution rule it implements`);
  }
});

test('#291: every workflow template honestly documents the item-1 residual (workflow file itself reads the merge ref)', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    assert.match(out, /RESIDUAL/, `${tmpl}: no residual callout`);
    assert.match(out, /merge (ref|commit)/, `${tmpl}: residual does not name the merge ref/commit`);
    assert.match(out, /§6\.3/, `${tmpl}: residual does not cite SPEC §6.3`);
  }
});

test('#291: every workflow template names the residuals this fix leaves open (nested CLAUDE.md, refused imports)', async () => {
  for (const tmpl of WORKFLOW_TEMPLATES) {
    const out = await render(tmpl);
    // Nested CLAUDE.md / CLAUDE.local.md elsewhere in the tree, loaded on
    // demand — neither the action's SENSITIVE_PATHS nor this loop covers a
    // subdirectory-scoped file of that name.
    assert.match(out, /CLAUDE\.local\.md/, `${tmpl}: does not name CLAUDE.local.md in the residual`);
    assert.match(out, /demand/i, `${tmpl}: does not explain the on-demand subdirectory load`);
    assert.match(out, /SENSITIVE_PATHS/, `${tmpl}: does not tie the residual back to the action's own restore list`);
    // A refused import (absolute / `~` / one that normalises out of the
    // checkout) is announced and then left alone — fail-visible, not
    // fail-closed. That asymmetry is a residual, not a guarantee, and the
    // comment has to say so.
    assert.match(out, /fail-visible/i, `${tmpl}: does not name the refused-import residual as fail-visible rather than fail-closed`);
    // The residual used to justify itself with a claim the memory docs
    // contradict: that Claude Code gates "exactly these" behind an approval
    // dialog. It gates an import whose path resolves OUTSIDE the working
    // directory. A `..` import resolving back inside gets no dialog, so a
    // residual naming `..` as refused is describing a hole, not a guard.
    assert.doesNotMatch(out, /or a `\.\.` segment\) is announced/, `${tmpl}: still lists every ".." import among the refusals`);
    assert.doesNotMatch(out, /`~`-relative, and any path with a `\.\.` segment are not/, `${tmpl}: still claims every ".." import is refused`);
    // Saying so positively, not just not-saying the false version: the next
    // reader of this residual is deciding whether to "harden" the step by
    // refusing `..` again, and the comment is where they find out that doing
    // so hands the PR the instruction bytes back.
    assert.match(out, /normalises back inside/, `${tmpl}: the residual does not say what happens to a ".." that normalises back inside the checkout`);
    assert.match(out, /refusing (them|to pin it) would be fail-open/, `${tmpl}: the residual does not say that refusing such an import is fail-open`);
    // Round 2's 4-hop residual is CLOSED by running to four hops — the
    // comment must not still claim a gap it no longer has.
    assert.doesNotMatch(out, /This loop\s+#?\s*stops at three/, `${tmpl}: still claims the closed 3-hop residual`);
  }
});

// ---------------------------------------------------------------------------
// BEHAVIOUR — run the real extracted shell against real git fixtures
//
// The SHAPE assertions above only prove the templates SAY the right thing.
// These ten cases prove the shell they render actually DOES it. Four of them
// (`@.git`, the symlinked parent out of the checkout, the symlinked parent
// INTO a PR-committed directory, the symlinked `.claude`) are exploits
// reproduced end-to-end against the shell before it was changed; the rest
// cover the import surface round 2 missed and the shapes the primitive
// refuses.
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

function write(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/**
 * Build a repo whose working tree is the MERGE ref of a PR — what
 * `actions/checkout@v6` with no `ref:` produces on `pull_request`, plus the
 * `refs/remotes/origin/<base>` ref `fetch-depth: 0` sets up. The repo sits
 * inside a container directory so a fixture can place a file OUTSIDE the
 * checkout and assert the pin never reaches it.
 */
function makeMergeRefCheckout({ base, pr, prSetup }) {
  const container = mkdtempSync(join(tmpdir(), 'cb291-'));
  const root = join(container, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'README-repo.md', 'repo\n');
  for (const [rel, body] of Object.entries(base)) write(root, rel, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  const baseSha = git(root, 'rev-parse', 'HEAD');

  git(root, 'checkout', '-q', '-b', 'pr');
  for (const [rel, body] of Object.entries(pr)) write(root, rel, body);
  if (prSetup) prSetup(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'pr');

  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-ff', '--no-edit', 'pr');
  const mergeSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-q', '--detach', mergeSha);

  git(root, 'update-ref', 'refs/remotes/origin/main', baseSha);
  git(root, 'update-ref', 'refs/heads/main', baseSha);

  return { container, root, baseSha };
}

let pinScriptCache = null;
async function pinScript() {
  if (pinScriptCache === null) {
    pinScriptCache = await pinStepShell('workflow.yml.tmpl');
  }
  return pinScriptCache;
}

/** Execute the pin step. `bash -e` matches the runner's default shell. */
async function runPin(root, { baseRef = 'main', baseSha }) {
  const scriptPath = join(root, '..', `pin-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(scriptPath, await pinScript());
  try {
    return execFileSync('bash', ['-e', scriptPath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BASE_REF: baseRef, BASE_SHA: baseSha },
    });
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

// ── The import surface, as the base ref declares it ────────────────────────
// Exercises every form the memory docs show: a whole-line import, two inline
// mid-sentence imports, a list-item import, a code span and a fenced block
// that must NOT be followed, a four-hop chain, and imports declared by the
// two launch roots other than CLAUDE.md.
const SURFACE_BASE = {
  'CLAUDE.md': [
    '@AGENTS.md',
    'See @README.md for project overview and @package.json for available npm commands.',
    '',
    '# Additional Instructions',
    '- git workflow @docs/git-instructions.md',
    '- chain head @docs/a.md',
    '',
    'Literal: `@code-span.md` stays text.',
    '',
    '```',
    '@fenced.md',
    '```',
    '',
  ].join('\n'),
  'AGENTS.md': 'base AGENTS\n',
  'README.md': 'base README\n',
  'package.json': '{ "name": "base" }\n',
  'docs/git-instructions.md': 'base git instructions\n',
  'code-span.md': 'base code-span target\n',
  'fenced.md': 'base fenced target\n',
  // Four-hop chain, each link relative to the file that declares it.
  'docs/a.md': 'base a\n@b.md\n',
  'docs/b.md': 'base b\n@c.md\n',
  'docs/c.md': 'base c\n@d.md\n',
  'docs/d.md': 'base d (fourth hop)\n',
  // The other two documented launch roots, each with its own import.
  '.claude/CLAUDE.md': '@extra.md\n',
  '.claude/extra.md': 'base claude-dir extra\n',
  'CLAUDE.local.md': '@local-target.md\n',
  'local-target.md': 'base local target\n',
};

const SURFACE_PR = Object.fromEntries(
  Object.keys(SURFACE_BASE).map((rel) => [rel, `PR ${rel} — must never be read as instructions\n`]),
);
// CLAUDE.md's first hop has to survive in the PR copy too, or the fixture
// stops modelling a PR that merely EDITS the instruction surface.
SURFACE_PR['CLAUDE.md'] = '@docs/a.md\n@docs/pr-only.md\nPR CLAUDE.md\n';
SURFACE_PR['docs/pr-only.md'] = 'PR-only doc\n';
// Decoy for the relative-resolution rule: `@b.md` inside docs/a.md means
// docs/b.md, NOT this root-level file. Resolving against the working
// directory instead would delete it.
SURFACE_PR['b.md'] = 'PR root-level decoy\n';

const surfaceFixture = () => makeMergeRefCheckout({ base: SURFACE_BASE, pr: SURFACE_PR });

test('#291 CONTROL: without the pin step, the merge-ref workspace DOES carry the PR-supplied instruction surface', () => {
  const { container, root } = surfaceFixture();
  try {
    // Reproduces the vulnerability: if these fail, the fixture stopped
    // modelling the bug and every green below is meaningless.
    assert.equal(read(root, 'CLAUDE.md'), SURFACE_PR['CLAUDE.md']);
    assert.equal(read(root, 'AGENTS.md'), SURFACE_PR['AGENTS.md']);
    assert.equal(read(root, 'docs/d.md'), SURFACE_PR['docs/d.md']);
    assert.ok(existsSync(join(root, 'docs/pr-only.md')), 'fixture does not reproduce the PR-added import target');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 1 — the reproduced `@.git` exploit ────────────────────────────────
test('#291 case 1: a PR-added "@.git" import does not delete the repository .git directory', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: { 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'base AGENTS\n' },
    pr: { 'CLAUDE.md': '@AGENTS.md\n@.git\n' },
  });
  try {
    const out = await runPin(root, { baseSha });
    // The exploit: round 2 discovered `.git` from the PR's own CLAUDE.md and
    // ran `rm -rf -- ".git"` on it, which makes the strict-mode gate's
    // `git show origin/<base>:.claude/skills/.clud-bug.json` fail and the
    // gate exit 0 — a pull request disabling strict mode on itself.
    assert.ok(statSync(join(root, '.git')).isDirectory(), '.git was deleted by a PR-chosen import path');
    assert.doesNotMatch(out, /\.git/, 'the PR-chosen path still reached the pin loop at all');
    assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n', 'CLAUDE.md was not restored to base-ref bytes');
    // A launch root that exists in neither the base ref nor the workspace —
    // the usual case for CLAUDE.local.md — is not worth an annotation on
    // every single review.
    assert.doesNotMatch(out, /CLAUDE\.local\.md/, 'a root absent from both the base ref and the workspace still annotated the run');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 2 — the reproduced symlinked-parent escape ────────────────────────
test('#291 case 2: a PR-committed symlinked parent directory does not let the pin delete outside the checkout', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      'CLAUDE.md': '@docs/victim.md\n',
      'docs/victim.md': 'base victim\n',
    },
    pr: {},
    prSetup: (r) => {
      // The PR replaces the `docs` directory with a link pointing out of the
      // checkout. The round-2 guard only string-tested the import text for
      // "..", and "docs/victim.md" has none — the escape lives in the link.
      rmSync(join(r, 'docs'), { recursive: true, force: true });
      symlinkSync('../outside', join(r, 'docs'));
    },
  });
  mkdirSync(join(container, 'outside'), { recursive: true });
  writeFileSync(join(container, 'outside', 'victim.md'), 'PRECIOUS\n');
  try {
    const out = await runPin(root, { baseSha });
    assert.equal(
      readFileSync(join(container, 'outside', 'victim.md'), 'utf8'),
      'PRECIOUS\n',
      'the pin deleted a file outside the checkout through a PR-committed symlink',
    );
    assert.match(out, /Removed the symlink "docs"/, 'the symlinked leading segment was not announced');
    // The link is unlinked, never followed — and the pin then completes into
    // a real directory, because giving up here would leave the reviewer with
    // whatever the link resolved to.
    assert.ok(!lstatSync(join(root, 'docs')).isSymbolicLink(), 'the PR-committed symlink is still in the leading path');
    assert.equal(read(root, 'docs/victim.md'), 'base victim\n', 'docs/victim.md was not restored to base-ref bytes');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 3 — inline imports are followed ───────────────────────────────────
test('#291 case 3: inline "@" imports (mid-sentence and in a list item) are pinned to base-ref bytes', async () => {
  const { container, root, baseSha } = surfaceFixture();
  try {
    await runPin(root, { baseSha });
    for (const rel of ['README.md', 'package.json', 'docs/git-instructions.md']) {
      assert.equal(read(root, rel), SURFACE_BASE[rel], `${rel}: inline import was not followed, so the PR's copy survived`);
    }
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 4 — code spans and fences are not imports ─────────────────────────
test('#291 case 4: an "@" mention inside a code span or a fenced code block is not treated as an import', async () => {
  const { container, root, baseSha } = surfaceFixture();
  try {
    await runPin(root, { baseSha });
    // Claude Code does not import these, so neither does the pin — touching
    // them would mean the parser is matching text the CLI ignores, and the
    // reviewer would be reading base bytes for files the PR legitimately
    // changed.
    assert.equal(read(root, 'code-span.md'), SURFACE_PR['code-span.md'], 'a backticked "@" mention was followed as an import');
    assert.equal(read(root, 'fenced.md'), SURFACE_PR['fenced.md'], 'an "@" mention inside a fenced block was followed as an import');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 5 — the other two documented launch roots ─────────────────────────
test('#291 case 5: .claude/CLAUDE.md and CLAUDE.local.md are launch roots, so their import targets are pinned too', async () => {
  const { container, root, baseSha } = surfaceFixture();
  try {
    await runPin(root, { baseSha });
    assert.equal(read(root, '.claude/extra.md'), SURFACE_BASE['.claude/extra.md'], '.claude/CLAUDE.md was not expanded as a launch root');
    assert.equal(read(root, 'local-target.md'), SURFACE_BASE['local-target.md'], 'CLAUDE.local.md was not expanded as a launch root');
    // AGENTS.md is seeded as a root AND reached as CLAUDE.md's first import;
    // seeding it must not stop the frontier from expanding it.
    assert.equal(read(root, 'AGENTS.md'), SURFACE_BASE['AGENTS.md'], 'AGENTS.md was not pinned');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 6 — relative resolution, to the documented four hops ──────────────
test('#291 case 6: a relative import resolves against the importing file\'s directory, four hops deep', async () => {
  const { container, root, baseSha } = surfaceFixture();
  try {
    await runPin(root, { baseSha });
    for (const rel of ['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md']) {
      assert.equal(read(root, rel), SURFACE_BASE[rel], `${rel}: not restored to base-ref bytes`);
    }
    // `@b.md` inside docs/a.md means docs/b.md. A loop resolving against the
    // working directory would have taken this root-level file instead —
    // missing the real target and deleting an unrelated PR file.
    assert.equal(read(root, 'b.md'), SURFACE_PR['b.md'], 'the relative import was resolved against the working directory, not the importing file');
    // A path named only by the PR's own CLAUDE.md is NOT an import of the
    // restored graph, so it is left alone. Deleting it is exactly the round-2
    // behaviour that made every discovered path a PR-chosen `rm` argument.
    assert.ok(existsSync(join(root, 'docs/pr-only.md')), 'the pin still acts on a path only the PR names');
    assert.doesNotMatch(SURFACE_BASE['CLAUDE.md'], /pr-only/, 'fixture error: the base ref must not import the PR-only file');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 7 — a base-declared import the PR replaced with a directory ───────
test('#291 case 7: an import target the PR committed as a directory is refused, and the directory is left alone', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      'CLAUDE.md': '@docs/victim.md\n',
      'docs/victim.md': 'base victim\n',
    },
    pr: {},
    prSetup: (r) => {
      rmSync(join(r, 'docs/victim.md'), { force: true });
      mkdirSync(join(r, 'docs/victim.md'), { recursive: true });
      writeFileSync(join(r, 'docs/victim.md/inner.txt'), 'PR inner\n');
    },
  });
  try {
    const out = await runPin(root, { baseSha });
    // An instruction file is never a directory, and the delete is never
    // recursive — so the pin declines rather than reaching for `rm -rf`.
    assert.match(out, /Refused to pin docs\/victim\.md — it is a directory/, 'a directory candidate was not announced as refused');
    assert.ok(statSync(join(root, 'docs/victim.md')).isDirectory(), 'the directory at the import target was removed');
    assert.equal(read(root, 'docs/victim.md/inner.txt'), 'PR inner\n', 'the refusal still deleted the directory contents');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 8 — ordinary base-ref prose naming a path under .git ──────────────
test('#291 case 8: a base-ref "@.git/<path>" mention does not delete repository metadata', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    // Benign maintainer prose, authored in the BASE ref — not an attack, and
    // not something discovery can decline to read. `.git/HEAD` is a file, so
    // the "a leaf is never a directory" rule that catches bare `.git` does
    // not fire, and the delete lands on git's own metadata: the strict-mode
    // gate's `git show origin/<base>:…` then fails, and that gate exits 0
    // when it cannot read its own config.
    base: { 'CLAUDE.md': 'Never write @.git/HEAD or @.git/index by hand.\n' },
    pr: { 'src/feature.ts': 'the change under review\n' },
  });
  try {
    const out = await runPin(root, { baseSha });
    assert.ok(existsSync(join(root, '.git/HEAD')), '.git/HEAD was deleted by an import mention');
    assert.ok(existsSync(join(root, '.git/index')), '.git/index was deleted by an import mention');
    assert.equal(git(root, 'rev-parse', '--is-inside-work-tree'), 'true', 'the repository stopped being a repository');
    assert.match(out, /Refused to pin \.git\/HEAD/, 'the .git refusal was not announced');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 9 — a symlinked parent pointing INSIDE the checkout ───────────────
test('#291 case 9: a PR-committed symlink on an import parent does not leave the PR supplying the pinned file', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      'CLAUDE.md': 'rules\n@docs/policy.md\n',
      'docs/policy.md': 'BASE POLICY\n',
    },
    pr: { 'prdir/policy.md': 'PR POLICY (attacker)\n' },
    prSetup: (r) => {
      // The link resolves INSIDE the working directory, so Claude Code does
      // not treat it as an external import and asks no approval question —
      // refusing the pin here hands the reviewer the PR's own instructions.
      rmSync(join(r, 'docs'), { recursive: true, force: true });
      symlinkSync('prdir', join(r, 'docs'));
    },
  });
  try {
    await runPin(root, { baseSha });
    assert.equal(read(root, 'docs/policy.md'), 'BASE POLICY\n', 'the PR supplied the instruction bytes the reviewer loads');
    // Link-only removal: the PR's own file is ordinary content under review,
    // not an instruction surface, so nothing follows the link to delete it.
    assert.equal(read(root, 'prdir/policy.md'), 'PR POLICY (attacker)\n', 'the pin followed the symlink and deleted the PR file behind it');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 10 — a symlinked `.claude` under the fail-closed skills delete ────
test('#291 case 10: a PR-committed `.claude` symlink does not make `rm -rf .claude/skills` delete outside the checkout', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: { '.claude/skills/x/SKILL.md': 'base skill\n' },
    pr: {},
    prSetup: (r) => {
      rmSync(join(r, '.claude'), { recursive: true, force: true });
      symlinkSync('../outside', join(r, '.claude'));
    },
  });
  mkdirSync(join(container, 'outside', 'skills', 'precious'), { recursive: true });
  writeFileSync(join(container, 'outside', 'skills', 'precious', 'file.txt'), 'PRECIOUS RUNNER STATE\n');
  try {
    await runPin(root, { baseSha });
    assert.equal(
      readFileSync(join(container, 'outside', 'skills', 'precious', 'file.txt'), 'utf8'),
      'PRECIOUS RUNNER STATE\n',
      'the fail-closed skills delete resolved a PR-committed symlink and deleted a tree outside the checkout',
    );
    // Still fail-closed: the base ref's skills are what the reviewer gets.
    assert.ok(!lstatSync(join(root, '.claude')).isSymbolicLink(), '.claude is still the PR-committed link');
    assert.equal(read(root, '.claude/skills/x/SKILL.md'), 'base skill\n', 'the base ref skills were not restored');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 11 — a ".." import that resolves back INSIDE the checkout ─────────
test('#291 case 11: a base-ref "@../<path>" import resolving inside the checkout is pinned, not refused', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      // `.claude/CLAUDE.md` is a documented launch root, and `@../docs/…`
      // from it is the ordinary way to reach a repo-root doc. It resolves to
      // docs/policy.md — inside the working directory — so Claude Code loads
      // it with no approval dialog.
      '.claude/CLAUDE.md': '@../docs/policy.md\n',
      'docs/policy.md': 'BASE POLICY\n',
    },
    pr: { 'docs/policy.md': 'PR POLICY (attacker-supplied instructions)\n' },
  });
  try {
    const out = await runPin(root, { baseSha });
    assert.equal(read(root, 'docs/policy.md'), 'BASE POLICY\n', 'a ".." import resolving inside the checkout was refused, so the PR supplied the instruction bytes');
    assert.doesNotMatch(out, /Rejected import "@\.\.\/docs\/policy\.md"/, 'the import was announced as rejected');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 12 — a ".." import that climbs OUT of the checkout ────────────────
test('#291 case 12: an import whose normal form leaves the checkout is refused, and nothing outside is touched', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: { 'CLAUDE.md': '@../outside/secret.md\n@docs/../docs/../../outside/secret.md\n' },
    pr: { 'src/feature.ts': 'the change under review\n' },
  });
  mkdirSync(join(container, 'outside'), { recursive: true });
  writeFileSync(join(container, 'outside', 'secret.md'), 'PRECIOUS\n');
  try {
    const out = await runPin(root, { baseSha });
    assert.equal(readFileSync(join(container, 'outside', 'secret.md'), 'utf8'), 'PRECIOUS\n', 'the pin reached a file outside the checkout');
    assert.match(out, /Rejected import "@\.\.\/outside\/secret\.md"/, 'the escaping import was not announced as rejected');
    // The second form only escapes AFTER normalisation — a guard that tests
    // the raw text segment-by-segment and one that tests the normal form
    // agree here, but a guard that just checks the first segment does not.
    assert.match(out, /Rejected import "@docs\/\.\.\/docs\/\.\.\/\.\.\/outside\/secret\.md"/, 'an import that escapes only after normalisation was followed');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 13 — a "." segment in the resolved path ───────────────────────────
test('#291 case 13: an import resolving through a "." segment is pinned, not deleted-and-lost', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      'CLAUDE.md': '@docs/a.md\n',
      'docs/a.md': 'base a\n@./b.md\n',
      'docs/b.md': 'BASE B\n',
    },
    pr: { 'docs/b.md': 'PR B (attacker)\n' },
  });
  try {
    const out = await runPin(root, { baseSha });
    // `rm -f docs/./b.md` succeeds; `git cat-file -t "<sha>:docs/./b.md"`
    // does not — so the un-normalised form deleted the base content and then
    // reported the base ref "declares no docs/./b.md".
    assert.ok(existsSync(join(root, 'docs/b.md')), 'the target was deleted and never restored');
    assert.equal(read(root, 'docs/b.md'), 'BASE B\n', 'docs/b.md was not restored to base-ref bytes');
    assert.doesNotMatch(out, /declares no docs\/\.\/b\.md/, 'the step reported a path the base ref cannot be asked about');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 14 — an unpinnable path must not end the loop ─────────────────────
test('#291 case 14: a target the base ref carries as a directory is refused, and every later target is still pinned', async () => {
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      // `@adocs/` names a directory — ordinary base-ref prose, and sorted
      // ahead of `zzz.md` in the import set.
      'CLAUDE.md': '@adocs/\n@zzz.md\n',
      'adocs/inner.md': 'base inner\n',
      'zzz.md': 'BASE ZZZ\n',
    },
    pr: { 'zzz.md': 'PR ZZZ (attacker)\n' },
    prSetup: (r) => {
      // The PR replaces the directory with a regular file. `adocs` is a TREE
      // in the base ref, so the base-type check refuses it before anything is
      // deleted — this case pins that a refusal, whichever guard raises it,
      // leaves the rest of the loop running. The delete guard itself is case
      // 15; no PR-committed shape reaches it, because this check and the
      // probe loop intercept them all first.
      rmSync(join(r, 'adocs'), { recursive: true, force: true });
      writeFileSync(join(r, 'adocs'), 'PR replaced the directory with a file\n');
    },
  });
  try {
    const out = await runPin(root, { baseSha });
    assert.equal(read(root, 'zzz.md'), 'BASE ZZZ\n', 'an earlier unpinnable target stopped the loop, so a later one kept the PR bytes');
    assert.match(out, /Refused to pin adocs/, 'the unpinnable target was not announced as refused');
    // An instruction file is never a directory in the base ref either, so
    // the notice must not claim the base ref "declares no adocs".
    assert.doesNotMatch(out, /declares no adocs/, 'the step called a base-ref directory an absent file');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

// ── Case 15 — a delete that FAILS must not end the loop either ─────────────
test('#291 case 15: a delete the step cannot perform refuses that one target, and every later target is still pinned', async () => {
  // The guards above intercept every shape a pull request can commit, so what
  // reaches the `rm` and fails is the workspace's own doing — an unwritable
  // parent, a read-only mount, a leaf that changed shape after the check read
  // it. Under `bash -e` an unguarded `rm` that fails ends the STEP, and every
  // later import keeps the PR's bytes: one unlucky path would disable the pin
  // for all of them. Git records no directory modes, so the fixture sets the
  // unwritable parent after checkout, the way the runner's filesystem would.
  const { container, root, baseSha } = makeMergeRefCheckout({
    base: {
      // `locked/a.md` is sorted ahead of `zzz.md` in the import set.
      'CLAUDE.md': '@locked/a.md\n@zzz.md\n',
      'locked/a.md': 'BASE A\n',
      'zzz.md': 'BASE ZZZ\n',
    },
    pr: { 'locked/a.md': 'PR A (attacker)\n', 'zzz.md': 'PR ZZZ (attacker)\n' },
  });
  const locked = join(root, 'locked');
  try {
    chmodSync(locked, 0o555);
    // Control: unlinking really is refused here, so a green result below is
    // the guard working and not the delete quietly succeeding.
    assert.throws(() => rmSync(join(locked, 'a.md'), { force: true }), /EACCES|EPERM/, 'the fixture did not make the delete fail — running as root?');
    const out = await runPin(root, { baseSha });
    assert.equal(read(root, 'zzz.md'), 'BASE ZZZ\n', 'a failed delete ended the loop, so a later target kept the PR bytes');
    assert.match(out, /could not be removed/, 'the target whose delete failed was not announced as refused');
    assert.equal(read(root, 'locked/a.md'), 'PR A (attacker)\n', 'the refused target was reported as pinned while keeping the PR bytes');
  } finally {
    chmodSync(locked, 0o755);
    rmSync(container, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// THE GATE ITSELF — .github/actions/strict-mode-gate/action.yml
//
// Same rule as everything above, one layer down: strict mode is read from the
// base ref, and a read that FAILS is not the same fact as a repository that
// never opted in. The pin step's own SECURITY comment cites this gate exiting
// 0 when it cannot read its own config as the reason `.git` is denied
// outright — so the gate has to actually not do that.
// ---------------------------------------------------------------------------

const GATE_ACTION = join(PKG_ROOT, '.github/actions/strict-mode-gate/action.yml');
const GATE_STEP_NAME = 'Strict mode — fail check on critical findings';
const PER_SKILL_STEP_NAME = 'Per-skill check-runs (BB.3)';

/** The gate step's shell, with the runner's expression substitution applied. */
function gateStepShell(stepName, { baseRef = 'main', repository = 'o/r' } = {}) {
  const doc = parseYaml(readFileSync(GATE_ACTION, 'utf8'));
  const step = doc.runs.steps.find((s) => s && s.name === stepName);
  assert.ok(step, `no '${stepName}' step in the composite`);
  return step.run
    .replace(/\$\{\{ github\.base_ref \}\}/g, baseRef)
    .replace(/\$\{\{ github\.repository \}\}/g, repository)
    .replace(/\$\{\{ github\.action_path \}\}/g, dirname(GATE_ACTION));
}

/** Run a gate step's shell under `bash -e`, returning {status, out}. */
function runGate(root, shell) {
  const scriptPath = join(root, '..', `gate-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(scriptPath, shell);
  try {
    const r = spawnSync('bash', ['-e', scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: '', PR_NUMBER: '1', BOT_LOGIN: 'clud-bug[bot]' },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

/** A repo whose base ref carries `manifest`, optionally without origin/<base>. */
function makeGateCheckout({ manifest, withOriginRef = true }) {
  const container = mkdtempSync(join(tmpdir(), 'cb291-gate-'));
  const root = join(container, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'README-repo.md', 'repo\n');
  if (manifest !== undefined) write(root, '.claude/skills/.clud-bug.json', manifest);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  if (withOriginRef) git(root, 'update-ref', 'refs/remotes/origin/main', git(root, 'rev-parse', 'HEAD'));
  return { container, root };
}

/**
 * Make the base ref's manifest DECLARED but unreadable: delete the loose
 * object backing its blob, leaving the ref and every tree intact. This is
 * the half of "unreadable" a ref-resolution check cannot see — the ref
 * resolves, the tree still names the path, and only the bytes are gone.
 */
function breakManifestBlob(root) {
  const blob = git(root, 'rev-parse', 'HEAD:.claude/skills/.clud-bug.json');
  const object = join(root, '.git/objects', blob.slice(0, 2), blob.slice(2));
  assert.ok(existsSync(object), `the manifest blob is not a loose object at ${object}`);
  rmSync(object, { force: true });
  // Control: the tree still carries the entry, so the fixture is
  // "declared and unreadable", not "never committed".
  assert.match(
    git(root, 'ls-tree', 'HEAD', '--', '.claude/skills/.clud-bug.json'),
    /blob/,
    'the fixture removed the tree entry, not just the object',
  );
}

test('#291 gate: an unreadable base ref FAILS the check — it is never reported as "strict mode disabled"', () => {
  // `fetch-depth: 0` missing, a shallow clone, a deleted `.git` — every one
  // of these makes `git show origin/<base>:…` fail on a repository whose base
  // ref says `strictMode: true`. Falling back to advisory there is a pull
  // request disabling strict mode on itself.
  const { container, root } = makeGateCheckout({ manifest: '{ "strictMode": true }\n', withOriginRef: false });
  try {
    const { status, out } = runGate(root, gateStepShell(GATE_STEP_NAME));
    assert.notEqual(status, 0, `the gate exited 0 with an unreadable base ref:\n${out}`);
    assert.match(out, /::error/, 'the unreadable base ref was not reported as an error');
    assert.doesNotMatch(out, /strict mode disabled for this run/, 'the gate still announces its own fail-open');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test('#291 gate: a base ref that simply carries no manifest is not an error — strict mode is opt-in', () => {
  const { container, root } = makeGateCheckout({ manifest: undefined });
  try {
    const { status, out } = runGate(root, gateStepShell(GATE_STEP_NAME));
    // A repository that never opted in must not have its checks fail. The
    // two cases are different facts and the gate has to tell them apart.
    assert.equal(status, 0, `a repo with no manifest failed the gate:\n${out}`);
    assert.doesNotMatch(out, /::error/, 'an absent manifest was reported as an error');
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test('#291 gate: a readable manifest with strictMode false passes without reaching the API', () => {
  const { container, root } = makeGateCheckout({ manifest: '{ "strictMode": false }\n' });
  try {
    const { status, out } = runGate(root, gateStepShell(GATE_STEP_NAME));
    assert.equal(status, 0, `strictMode:false did not pass:\n${out}`);
    assert.doesNotMatch(out, /::error/, `strictMode:false raised an error:\n${out}`);
  } finally {
    rmSync(container, { recursive: true, force: true });
  }
});

test('#291 gate: a manifest the base ref DECLARES but this gate cannot read FAILS the check — "declared" and "readable" are not one test', () => {
  // Resolving the ref is only half of "unreadable". `git cat-file -e` asks
  // whether an OBJECT is in the store, and answers the same for a path the
  // base ref never carried and a path whose blob is gone — so a repository
  // whose base ref says `strictMode: true` got the "declares no manifest"
  // opt-out notice and a green check on a PR with critical findings. Telling
  // the two apart means resolving the path through the trees, which needs no
  // blob, and letting the read itself be the thing that can fail.
  for (const stepName of [GATE_STEP_NAME, PER_SKILL_STEP_NAME]) {
    const { container, root } = makeGateCheckout({ manifest: '{ "strictMode": true, "strictSkills": ["x"] }\n' });
    try {
      breakManifestBlob(root);
      const { status, out } = runGate(root, gateStepShell(stepName));
      assert.notEqual(status, 0, `${stepName}: exited 0 with a declared-but-unreadable manifest:\n${out}`);
      assert.match(out, /::error/, `${stepName}: the unreadable manifest was not reported as an error`);
      assert.doesNotMatch(
        out,
        /declares no \.claude\/skills\/\.clud-bug\.json/,
        `${stepName}: a manifest the base ref DOES carry was reported as an opt-out`,
      );
    } finally {
      rmSync(container, { recursive: true, force: true });
    }
  }
});

test('#291 gate: the per-skill step tells an unreadable base ref apart from an absent manifest too', () => {
  const stepName = PER_SKILL_STEP_NAME;
  const unreadable = makeGateCheckout({ manifest: '{ "strictMode": true, "strictSkills": ["x"] }\n', withOriginRef: false });
  try {
    const { status, out } = runGate(unreadable.root, gateStepShell(stepName));
    assert.notEqual(status, 0, `the per-skill step exited 0 with an unreadable base ref:\n${out}`);
    assert.match(out, /::error/, 'the unreadable base ref was not reported as an error');
  } finally {
    rmSync(unreadable.container, { recursive: true, force: true });
  }
  const absent = makeGateCheckout({ manifest: undefined });
  try {
    const { status, out } = runGate(absent.root, gateStepShell(stepName));
    assert.equal(status, 0, `a repo with no manifest failed the per-skill step:\n${out}`);
  } finally {
    rmSync(absent.container, { recursive: true, force: true });
  }
});

test('#291 REVERT-PROOF: reversing the production hunks reintroduces the AGENTS.md-only special case and fails the SHAPE tests', async () => {
  // Belt-and-suspenders on the SHAPE assertions above: confirm the exact
  // literal this round's fix replaces is gone, and the generic per-path
  // markers are the ones actually present in the rendered output — so a
  // revert of the production template hunks (leaving this test file as-is)
  // would fail loudly, not silently.
  const out = await render('workflow.yml.tmpl');
  assert.doesNotMatch(out, /if git cat-file -e "\$\{PIN\}:AGENTS\.md"/, 'the round-1 AGENTS.md-specific if-block is back');
  assert.match(out, /in_import_set/, 'the generic import-set membership check is gone');
  assert.match(out, /pin_to_base\(\)/, 'the single filesystem primitive is gone');
});
