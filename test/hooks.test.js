// Wave 6b (rc.17 fix) — `clud-bug init --with-hooks` scaffolds a native Claude
// Code `type: command` commit-review hook into .claude/settings.json. (It was a
// broken `type: agent` hook before — agent hooks have no Bash, so they could
// never run the clud-bug CLI.) These cover the pure hook-builder + the
// merge-into-existing-settings logic (idempotent, non-clobbering).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildLocalReviewHook,
  mergeLocalReviewHook,
  buildCommitReviewCommand,
  HOOK_FIRED_FILE,
  REVIEW_DONE_FILE,
  PENDING_QUEUE_FILE,
} from '../src/cli/hooks.js';

// The hook command floats to the `next` dist-tag by default (rc.20).
const COMMIT_REVIEW_COMMAND = buildCommitReviewCommand();

describe('buildLocalReviewHook', () => {
  it('is a backgrounded type:command PostToolUse entry targeting git commit + logmind log', () => {
    const entry = buildLocalReviewHook(COMMIT_REVIEW_COMMAND);
    expect(entry.matcher).toBe('Bash');
    expect(entry.hooks).toHaveLength(2); // git commit + logmind log (the thrillmade commit primitive)
    expect(entry.hooks.map((h) => h.if)).toEqual(
      expect.arrayContaining(['Bash(git commit *)', 'Bash(logmind log *)']),
    );
    for (const h of entry.hooks) {
      expect(h.type).toBe('command'); // NOT 'agent' — agent hooks can't run the CLI
      expect(h.async).toBe(true); // commit never blocks
      expect(h.asyncRewake).toBe(true); // recipe surfaces back to the main agent (exit 2)
      expect(h.command).toBe(COMMIT_REVIEW_COMMAND);
      expect(h.prompt).toBeUndefined(); // no agent prompt anymore
    }
  });
});

describe('mergeLocalReviewHook', () => {
  it('adds the hook to empty / undefined settings', () => {
    const s = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    expect(s.hooks.PostToolUse).toHaveLength(1);
    expect(s.hooks.PostToolUse[0].hooks[0].type).toBe('command');
  });

  it('preserves unrelated settings and other hooks', () => {
    const existing = {
      model: 'opus',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './x.sh' }] }],
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: './fmt.sh' }] }],
      },
    };
    const s = mergeLocalReviewHook(existing, COMMIT_REVIEW_COMMAND);
    expect(s.model).toBe('opus'); // unrelated top-level key preserved
    expect(s.hooks.PreToolUse).toHaveLength(1); // other event preserved
    expect(s.hooks.PostToolUse).toHaveLength(2); // the user's Edit hook + ours
    expect(s.hooks.PostToolUse.some((e) => e.matcher === 'Edit')).toBe(true);
  });

  it('is idempotent — re-running replaces ours, never duplicates', () => {
    const once = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    const twice = mergeLocalReviewHook(once, COMMIT_REVIEW_COMMAND);
    expect(twice.hooks.PostToolUse).toHaveLength(1);
  });

  it('replaces the OLD broken type:agent hook in place (upgrade path)', () => {
    // Simulate a settings.json scaffolded by the pre-rc.17 broken version.
    const old = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'agent', if: 'Bash(git commit *)', prompt: '<!-- clud-bug-local-review v1 -->\nrun review-prompt' }],
          },
        ],
      },
    };
    const s = mergeLocalReviewHook(old, COMMIT_REVIEW_COMMAND);
    expect(s.hooks.PostToolUse).toHaveLength(1);
    const h = s.hooks.PostToolUse[0].hooks[0];
    expect(h.type).toBe('command'); // upgraded
    expect(h.prompt).toBeUndefined();
  });

  it('preserves a user hook co-located INSIDE our entry across a re-merge', () => {
    const v1 = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    // user hand-appends their own hook into OUR Bash matcher entry
    v1.hooks.PostToolUse[0].hooks.push({ type: 'command', command: './notify.sh' });
    const v2 = mergeLocalReviewHook(v1, COMMIT_REVIEW_COMMAND);
    const entry = v2.hooks.PostToolUse.find((e) =>
      e.hooks.some((h) => typeof h.command === 'string' && h.command.includes('clud-bug-local-review')),
    );
    // the user's co-located hook survives, and ours (2 triggers) is not duplicated
    expect(entry.hooks.some((h) => h.command === './notify.sh')).toBe(true);
    expect(
      entry.hooks.filter(
        (h) => typeof h.command === 'string' && h.command.includes('clud-bug-local-review'),
      ),
    ).toHaveLength(2);
  });

  it('refreshes our hook in place when the command changes', () => {
    const v1 = mergeLocalReviewHook(undefined, COMMIT_REVIEW_COMMAND);
    const v2command = COMMIT_REVIEW_COMMAND + '\n# bumped';
    const v2 = mergeLocalReviewHook(v1, v2command);
    expect(v2.hooks.PostToolUse).toHaveLength(1);
    expect(v2.hooks.PostToolUse[0].hooks[0].command).toBe(v2command);
  });

  it('tolerates a non-object existing value', () => {
    const s = mergeLocalReviewHook('garbage', COMMIT_REVIEW_COMMAND);
    expect(s.hooks.PostToolUse).toHaveLength(1);
  });
});

describe('buildCommitReviewCommand', () => {
  it('carries the marker, floats to @next, and runs review-prompt on the subscription', () => {
    expect(COMMIT_REVIEW_COMMAND).toMatch(/clud-bug-local-review/);
    // floating @next so the hook always fetches the latest recipe — no per-release re-pin
    expect(COMMIT_REVIEW_COMMAND).toMatch(/npx clud-bug@next review-prompt --trigger commit/);
    // the pin is overridable for a repo that wants a frozen exact version
    expect(buildCommitReviewCommand('0.7.0-rc.99')).toMatch(/npx clud-bug@0\.7\.0-rc\.99 review-prompt/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/subscription/i);
    // idempotency: skips re-surfacing the same HEAD; never blocks the commit
    expect(COMMIT_REVIEW_COMMAND).toMatch(/git rev-parse HEAD/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/exit 0/); // quiet degrade
    expect(COMMIT_REVIEW_COMMAND).toMatch(/exit 2/); // surface via asyncRewake
    // the event JSON is still captured (needed for the --no-verify text
    // check), but — #240 vector 3 — it NO LONGER gates firing by matching
    // 'git commit'/'logmind log' substrings against it (that matched free
    // text anywhere in the event, e.g. a Bash `description`, and spuriously
    // fired on read-only commands). Firing is now keyed on git STATE below.
    expect(COMMIT_REVIEW_COMMAND).toMatch(/cat 2>\/dev\/null/);
  });

  it('#240 vector 1: keys shared review-state (fired/done/pending) off --git-common-dir, not --git-dir', () => {
    expect(COMMIT_REVIEW_COMMAND).toMatch(/git rev-parse --git-common-dir/);
    // still resolves a worktree-LOCAL git-dir too, but only for the
    // HEAD-moved baseline (see the vector-3 test below) — never for the
    // shared fired/done/pending state.
    expect(COMMIT_REVIEW_COMMAND).toMatch(/git rev-parse --git-dir/);
  });

  it('#240 vector 3: fires on git STATE (reflog reason), never on command text alone', () => {
    expect(COMMIT_REVIEW_COMMAND).toMatch(/clud-bug-last-seen-head/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/git reflog -1/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/commit\*\|rebase\*/);
  });

  it('#240 vector 2: forwards --flag-no-verify to review-prompt when the event mentions --no-verify', () => {
    expect(COMMIT_REVIEW_COMMAND).toMatch(/--no-verify/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/--flag-no-verify/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/noverifyFlag/);
  });

  it('#239: two-phase marker + durable pending queue + review-done instruction', () => {
    expect(COMMIT_REVIEW_COMMAND).toMatch(/clud-bug-hook-fired/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/clud-bug-review-done/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/clud-bug-pending/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/review-done \$sha/);
    // the two distinct deferral messages (limit vs error) required by #239
    expect(COMMIT_REVIEW_COMMAND).toMatch(/review deferred \(usage limit\)/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/review deferred \(error: recipe fetch failed\)/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/review --pending/);
  });

  it('H4: retries once on a transient failure and leaves a diagnostic marker', () => {
    // one `sleep 1` retry before giving up on the recipe fetch
    expect(COMMIT_REVIEW_COMMAND).toMatch(/sleep 1/);
    // exactly two npx attempts (initial + retry)
    expect(COMMIT_REVIEW_COMMAND.match(/npx clud-bug@[^ ]+ review-prompt --trigger commit/g)).toHaveLength(2);
    // both attempts clear $recipe on a non-zero exit so partial/error stdout is
    // never surfaced as a valid recipe (regression guard)
    expect(COMMIT_REVIEW_COMMAND.match(/\|\| recipe=/g)).toHaveLength(2);
    // a failed fetch is recorded distinctly from a clean review
    expect(COMMIT_REVIEW_COMMAND).toMatch(/clud-bug-review-skipped/);
  });

  it('is valid POSIX sh (the retry + markers do not break the script)', () => {
    const r = spawnSync('sh', ['-n'], { input: COMMIT_REVIEW_COMMAND, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});

// #239/#240 (LAUNCH-GATE) — integration tests that actually EXECUTE the
// generated hook script against REAL git state (temp repos, real worktrees,
// a real reflog), rather than only asserting on the command string. A fake
// `npx` shim on PATH stands in for the network fetch so these stay fast and
// offline; it echoes a canned recipe (or its own argv, for the --no-verify
// flag-forwarding test) instead of calling the real `clud-bug review-prompt`.
describe('commit-review hook — integration (real git state)', () => {
  function git(cwd, args) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  }

  async function makeRepo() {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-hook-it-'));
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 'test@test']);
    git(dir, ['config', 'user.name', 'Test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
    return dir;
  }

  /** A fake `npx` on PATH so the hook's recipe fetch never hits the network.
   * `mode: 'recipe'` echoes a canned recipe (simulating success); `mode:
   * 'echo-args'` echoes its own argv space-joined (so a test can assert
   * which flags the hook forwarded); `mode: 'fail'` always exits non-zero
   * (simulating a fetch failure). */
  async function installFakeNpx(mode) {
    const binDir = await mkdtemp(join(tmpdir(), 'clud-bug-fakebin-'));
    const script =
      mode === 'fail'
        ? '#!/bin/sh\nexit 1\n'
        : mode === 'echo-args'
          ? '#!/bin/sh\necho "ARGS: $*"\n'
          : '#!/bin/sh\necho "<!-- clud-bug-local-review v1 -->\\nfake recipe\\n"\n';
    const npxPath = join(binDir, 'npx');
    await writeFile(npxPath, script);
    await chmod(npxPath, 0o755);
    return binDir;
  }

  /** Run the built hook command against `cwd`, piping `event` as the
   * PostToolUse JSON on stdin (matches how Claude Code invokes it). */
  function runHook(command, cwd, event, fakeNpxBinDir) {
    return spawnSync('sh', ['-c', command], {
      cwd,
      encoding: 'utf8',
      input: JSON.stringify(event ?? {}),
      env: { ...process.env, PATH: `${fakeNpxBinDir}:${process.env.PATH}` },
    });
  }

  it('#240 vector 3: a read-only command (no commit made) does not fire', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('recipe');
    const cmd = buildCommitReviewCommand();

    // `clud-bug init --with-hooks` seeds the HEAD-moved baseline at install
    // time (main.ts) — mirror that here, since a truly virgin checkout with
    // NO baseline can't distinguish "this HEAD's tip commit predates the
    // hook" from "was just committed" from git state alone (both look like
    // a `commit`-type reflog entry). That ambiguity is exactly why `init`
    // closes the window immediately; a fresh WORKTREE's cold start is
    // covered separately below, where reflog DOES disambiguate correctly
    // (no seeding needed, since a worktree's own first reflog entry is a
    // `checkout`, not a `commit`).
    runHook(cmd, repo, {}, npxBin);

    // Read-only commands with no intervening commit must not fire.
    const r1 = runHook(cmd, repo, { tool_input: { command: 'git log', description: 'view git commit history' } }, npxBin);
    expect(r1.status).toBe(0);
    expect(r1.stdout.trim()).toBe('');

    const r2 = runHook(cmd, repo, { tool_input: { command: 'gh issue view 1' } }, npxBin);
    expect(r2.status).toBe(0);
    expect(r2.stdout.trim()).toBe('');
  });

  it('#240 vector 3 (cold start): a brand-new worktree with NO commit yet does not fire, even unseeded', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('recipe');
    const cmd = buildCommitReviewCommand();

    // Deliberately do NOT seed anything here — a linked worktree just
    // created via `git worktree add` has no baseline file of its own, and
    // `clud-bug init` never ran again inside it. Its reflog has nothing but
    // the worktree's own checkout (not a `commit` action), so the hook must
    // still correctly decline to fire on a read-only command.
    const wtDir = join(repo, '..', `${repo.split('/').pop()}-wt-cold`);
    git(repo, ['worktree', 'add', '-q', wtDir, '-b', 'wt-cold']);

    const r = runHook(cmd, wtDir, { tool_input: { command: 'git log' } }, npxBin);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('#240 vector 3: a real commit fires; a subsequent read-only command does not re-fire', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('recipe');
    const cmd = buildCommitReviewCommand();

    // Establish baseline (mirrors `clud-bug init --with-hooks` seeding it).
    runHook(cmd, repo, {}, npxBin);

    await writeFile(join(repo, 'f.txt'), 'x');
    git(repo, ['add', 'f.txt']);
    git(repo, ['commit', '-q', '-m', 'feat: add f']);

    const rCommit = runHook(cmd, repo, { tool_input: { command: 'git commit -m feat' } }, npxBin);
    expect(rCommit.status).toBe(2); // asyncRewake surface
    expect(rCommit.stdout).toMatch(/fake recipe/);

    // HEAD unchanged — even a command whose text mentions "git commit" must not re-fire.
    const rReadOnly = runHook(cmd, repo, { tool_input: { command: 'git log', description: 'show git commit history' } }, npxBin);
    expect(rReadOnly.status).toBe(0);
    expect(rReadOnly.stdout.trim()).toBe('');
  });

  it('#240 vector 1: a commit in a LINKED WORKTREE resolves to the primary checkout\'s shared bookkeeping', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('recipe');
    const cmd = buildCommitReviewCommand();

    const wtDir = join(repo, '..', `${repo.split('/').pop()}-wt1`);
    git(repo, ['worktree', 'add', '-q', wtDir, '-b', 'wt1']);

    await writeFile(join(wtDir, 'g.txt'), 'y');
    git(wtDir, ['add', 'g.txt']);
    git(wtDir, ['commit', '-q', '-m', 'feat: add g in worktree']);
    const wtSha = git(wtDir, ['rev-parse', 'HEAD']);

    const r = runHook(cmd, wtDir, { tool_input: { command: 'git commit -m feat' } }, npxBin);
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/fake recipe/);

    // The fired marker lands in the PRIMARY checkout's .git (the shared
    // common dir) — not the worktree-private .git/worktrees/wt1/ — so a
    // `clud-bug review --pending` drain (or a re-check) run from the primary
    // checkout sees the worktree's commit.
    const fired = await readFile(join(repo, '.git', HOOK_FIRED_FILE), 'utf8');
    expect(fired.trim()).toBe(wtSha);

    // Confirm the worktree-private git-dir does NOT carry the shared marker
    // (it only carries the worktree-local HEAD-moved baseline).
    const gitDirName = git(wtDir, ['rev-parse', '--git-dir']);
    await expect(readFile(join(gitDirName, HOOK_FIRED_FILE), 'utf8')).rejects.toThrow();
  });

  it('#240 vector 2: a --no-verify commit is forwarded to review-prompt as --flag-no-verify', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('echo-args');
    const cmd = buildCommitReviewCommand();

    runHook(cmd, repo, {}, npxBin); // seed baseline

    await writeFile(join(repo, 'h.txt'), 'z');
    git(repo, ['add', 'h.txt']);
    git(repo, ['commit', '-q', '-m', 'feat: add h']);

    const withNoVerify = runHook(
      cmd,
      repo,
      { tool_input: { command: 'git commit --no-verify -m feat' } },
      npxBin,
    );
    expect(withNoVerify.status).toBe(2);
    expect(withNoVerify.stdout).toMatch(/--flag-no-verify/);
  });

  it('#240 vector 2: a plain commit (no --no-verify) never forwards the flag', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('echo-args');
    const cmd = buildCommitReviewCommand();

    runHook(cmd, repo, {}, npxBin); // seed baseline

    await writeFile(join(repo, 'h2.txt'), 'z');
    git(repo, ['add', 'h2.txt']);
    git(repo, ['commit', '-q', '-m', 'feat: add h2']);

    const plain = runHook(cmd, repo, { tool_input: { command: 'git commit -m feat' } }, npxBin);
    expect(plain.status).toBe(2);
    expect(plain.stdout).not.toMatch(/--flag-no-verify/);
  });

  it('#239: a fired-but-not-done sha is queued (not silently dropped) when a NEW commit lands', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('recipe');
    const cmd = buildCommitReviewCommand();

    runHook(cmd, repo, {}, npxBin); // seed baseline

    // Commit A fires and is handed off (pending — `review-done` never runs).
    await writeFile(join(repo, 'a.txt'), 'a');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-q', '-m', 'feat: a']);
    const shaA = git(repo, ['rev-parse', 'HEAD']);
    const rA = runHook(cmd, repo, { tool_input: { command: 'git commit -m feat' } }, npxBin);
    expect(rA.status).toBe(2);

    // Commit B lands without A ever being confirmed done.
    await writeFile(join(repo, 'b.txt'), 'b');
    git(repo, ['add', 'b.txt']);
    git(repo, ['commit', '-q', '-m', 'feat: b']);
    const shaB = git(repo, ['rev-parse', 'HEAD']);
    const rB = runHook(cmd, repo, { tool_input: { command: 'git commit -m feat' } }, npxBin);

    // #239: this must RE-SURFACE — never silently treated as already reviewed.
    expect(rB.status).toBe(2);
    expect(rB.stdout).toMatch(/review deferred \(usage limit\)/);
    expect(rB.stdout).toMatch(new RegExp(shaA));
    expect(rB.stdout).toMatch(/fake recipe/); // B's own review still ran too

    // Both A (abandoned) and B (just fired, not yet done) are enumerable —
    // an abandoned review must never be invisible to the pending drain.
    const pending = await readFile(join(repo, '.git', PENDING_QUEUE_FILE), 'utf8');
    expect(pending).toContain(shaA);
    expect(pending).toContain(shaB);
  });

  it('#239: review-done removes the sha from the pending queue', async () => {
    const repo = await makeRepo();
    const npxBin = await installFakeNpx('recipe');
    const cmd = buildCommitReviewCommand();
    runHook(cmd, repo, {}, npxBin);

    await writeFile(join(repo, 'c.txt'), 'c');
    git(repo, ['add', 'c.txt']);
    git(repo, ['commit', '-q', '-m', 'feat: c']);
    const sha = git(repo, ['rev-parse', 'HEAD']);
    runHook(cmd, repo, { tool_input: { command: 'git commit -m feat' } }, npxBin);

    let pending = await readFile(join(repo, '.git', PENDING_QUEUE_FILE), 'utf8');
    expect(pending).toContain(sha);

    await writeFile(join(repo, '.git', REVIEW_DONE_FILE), sha);
    // Simulate `review-done`'s queue-removal directly (the CLI verb itself
    // is covered end-to-end in test/review.test.js); here we assert the
    // FILE FORMAT the hook expects to read back matches what it wrote.
    const raw = await readFile(join(repo, '.git', PENDING_QUEUE_FILE), 'utf8');
    const remaining = raw.split('\n').map((s) => s.trim()).filter((s) => s && s !== sha);
    await writeFile(join(repo, '.git', PENDING_QUEUE_FILE), remaining.join('\n'));

    pending = await readFile(join(repo, '.git', PENDING_QUEUE_FILE), 'utf8');
    expect(pending).not.toContain(sha);

    // And the two-phase check now sees fired === done === sha → no re-fire.
    await writeFile(join(repo, 'd.txt'), 'd'); // no new commit; HEAD unchanged
    const rSame = runHook(cmd, repo, { tool_input: { command: 'git status' } }, npxBin);
    expect(rSame.status).toBe(0);
    expect(rSame.stdout.trim()).toBe('');
  });
});
