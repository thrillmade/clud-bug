// Wave 6b (rc.17 fix) — `clud-bug init --with-hooks` scaffolds a native Claude
// Code `type: command` commit-review hook into .claude/settings.json. (It was a
// broken `type: agent` hook before — agent hooks have no Bash, so they could
// never run the clud-bug CLI.) These cover the pure hook-builder + the
// merge-into-existing-settings logic (idempotent, non-clobbering).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

import {
  buildLocalReviewHook,
  mergeLocalReviewHook,
  buildCommitReviewCommand,
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
    // belt-and-suspenders gate (in case CC ignores the `if` field)
    expect(COMMIT_REVIEW_COMMAND).toMatch(/cat 2>\/dev\/null/);
    expect(COMMIT_REVIEW_COMMAND).toMatch(/git commit.*logmind log/);
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
