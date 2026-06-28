// Wave 6b — `clud-bug init --with-hooks` scaffolds a native Claude Code
// `type: agent` commit-review hook into .claude/settings.json. These cover the
// pure hook-builder + the merge-into-existing-settings logic (idempotent,
// non-clobbering).

import { describe, expect, it } from 'vitest';

import {
  buildLocalReviewHook,
  mergeLocalReviewHook,
  buildCommitReviewPrompt,
} from '../src/cli/hooks.js';

// The hook prompt is now version-pinned; build one at a fixed test version so
// the merge/builder tests below read as before.
const COMMIT_REVIEW_PROMPT = buildCommitReviewPrompt('0.7.0-rc.13');

describe('buildLocalReviewHook', () => {
  it('is a backgrounded type:agent PostToolUse entry targeting git commit', () => {
    const entry = buildLocalReviewHook(COMMIT_REVIEW_PROMPT);
    expect(entry.matcher).toBe('Bash');
    const h = entry.hooks[0];
    expect(h.type).toBe('agent');
    expect(h.if).toBe('Bash(git commit *)');
    expect(h.async).toBe(true); // commit never blocks
    expect(h.asyncRewake).toBe(true); // findings surface back to the agent
    expect(h.prompt).toBe(COMMIT_REVIEW_PROMPT);
  });
});

describe('mergeLocalReviewHook', () => {
  it('adds the hook to empty / undefined settings', () => {
    const s = mergeLocalReviewHook(undefined, COMMIT_REVIEW_PROMPT);
    expect(s.hooks.PostToolUse).toHaveLength(1);
    expect(s.hooks.PostToolUse[0].hooks[0].type).toBe('agent');
  });

  it('preserves unrelated settings and other hooks', () => {
    const existing = {
      model: 'opus',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './x.sh' }] }],
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: './fmt.sh' }] }],
      },
    };
    const s = mergeLocalReviewHook(existing, COMMIT_REVIEW_PROMPT);
    expect(s.model).toBe('opus'); // unrelated top-level key preserved
    expect(s.hooks.PreToolUse).toHaveLength(1); // other event preserved
    expect(s.hooks.PostToolUse).toHaveLength(2); // the user's Edit hook + ours
    expect(s.hooks.PostToolUse.some((e) => e.matcher === 'Edit')).toBe(true);
  });

  it('is idempotent — re-running replaces ours, never duplicates', () => {
    const once = mergeLocalReviewHook(undefined, COMMIT_REVIEW_PROMPT);
    const twice = mergeLocalReviewHook(once, COMMIT_REVIEW_PROMPT);
    expect(twice.hooks.PostToolUse).toHaveLength(1);
  });

  it('preserves a user hook co-located INSIDE our entry across a re-merge', () => {
    const v1 = mergeLocalReviewHook(undefined, COMMIT_REVIEW_PROMPT);
    // user hand-appends their own hook into OUR Bash matcher entry
    v1.hooks.PostToolUse[0].hooks.push({ type: 'command', command: './notify.sh' });
    const v2 = mergeLocalReviewHook(v1, COMMIT_REVIEW_PROMPT);
    const entry = v2.hooks.PostToolUse.find((e) =>
      e.hooks.some((h) => typeof h.prompt === 'string' && h.prompt.includes('clud-bug-local-review')),
    );
    // the user's co-located hook survives, and ours is not duplicated
    expect(entry.hooks.some((h) => h.command === './notify.sh')).toBe(true);
    expect(
      entry.hooks.filter(
        (h) => typeof h.prompt === 'string' && h.prompt.includes('clud-bug-local-review'),
      ),
    ).toHaveLength(1);
  });

  it('refreshes our hook in place when the recipe changes', () => {
    const v1 = mergeLocalReviewHook(undefined, COMMIT_REVIEW_PROMPT);
    const v2recipe = COMMIT_REVIEW_PROMPT + '\n<!-- bumped -->';
    const v2 = mergeLocalReviewHook(v1, v2recipe);
    expect(v2.hooks.PostToolUse).toHaveLength(1);
    expect(v2.hooks.PostToolUse[0].hooks[0].prompt).toBe(v2recipe);
  });

  it('tolerates a non-object existing value', () => {
    const s = mergeLocalReviewHook('garbage', COMMIT_REVIEW_PROMPT);
    expect(s.hooks.PostToolUse).toHaveLength(1);
  });
});

describe('buildCommitReviewPrompt', () => {
  it('carries the marker, pins the clud-bug version, and delegates to review-prompt on the subscription', () => {
    expect(COMMIT_REVIEW_PROMPT).toMatch(/clud-bug-local-review/);
    // version-pinned so the hook never resolves to a `latest` that predates the verb
    expect(COMMIT_REVIEW_PROMPT).toMatch(/npx clud-bug@0\.7\.0-rc\.13 review-prompt --trigger commit/);
    expect(COMMIT_REVIEW_PROMPT).toMatch(/subscription/i);
  });
});
