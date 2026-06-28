// Tests for src/cli/review-prompt.ts — `renderReviewRecipe`, the plan-aware
// local-review recipe the `clud-bug review-prompt` verb emits (the dynamic,
// planReview-driven counterpart of the rc.11 static slash-command prompt).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { planReview } from '../src/core/plan-review.js';
import { renderReviewRecipe, CLUD_BUG_RECIPE_MARKER } from '../src/cli/review-prompt.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function makeSkill(slug, review_mode = 'shared') {
  return {
    slug,
    frontmatter: { name: slug, description: `Test ${slug}`, source: 'manual', review_mode },
  };
}

const SKILLS = [
  makeSkill('critical-issues-only'),
  makeSkill('evidence-based-review'),
  makeSkill('respect-existing-conventions'),
];
const MULTIPASS_CONFIG = { count: 3, mode: 'consensus' };

describe('renderReviewRecipe', () => {
  it('emits a commit recipe: marker, single fast pass, reviews HEAD, lists the skills, §1.8.1 format', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });
    const recipe = renderReviewRecipe({ plan, trigger: 'commit' });

    expect(recipe).toContain(CLUD_BUG_RECIPE_MARKER);
    // commit → reviews the just-made commit's diff
    expect(recipe).toMatch(/git show[^\n]*HEAD/);
    // every resolved skill is named so the agent loads it
    for (const s of SKILLS) expect(recipe).toContain(s.slug);
    // commit tiers down to ONE pass — no multi-agent fan-out language
    expect(recipe).not.toMatch(/dispatch \d+ reviewer/i);
    // the clud-bug §1.8.1 review body shape
    expect(recipe).toMatch(/Clud Bug review/i);
  });

  it('emits a multi-pass recipe on a pr trigger: fan-out to N sub-agents + the aggregation mode + the tiers', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'pr' });
    const recipe = renderReviewRecipe({ plan, trigger: 'pr' });

    // pr keeps the full 3-pass plan → instructs dispatching reviewer sub-agents
    expect(recipe).toMatch(/dispatch 3 reviewer/i);
    // names the aggregation mode resolved by the plan
    expect(recipe).toMatch(/consensus/i);
    // names the role tiers (Beetle/Wasp/Mantis) so each pass binds a model
    expect(recipe).toMatch(/beetle/i);
    expect(recipe).toMatch(/wasp/i);
    // pr reviews the branch against its base (not a single commit)
    expect(recipe).toMatch(/gh pr diff|origin\//);
  });

  it('carries the plan summary so the operator sees what was resolved', () => {
    const plan = planReview({ skills: SKILLS, config: MULTIPASS_CONFIG, trigger: 'commit' });
    const recipe = renderReviewRecipe({ plan, trigger: 'commit' });
    expect(recipe).toContain(plan.summary);
  });
});

describe('review-prompt verb (integration)', () => {
  it('loads the manifest + skill frontmatter and prints a recipe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'critical-issues-only'), { recursive: true });
    await writeFile(
      join(skillsDir, '.clud-bug.json'),
      JSON.stringify({
        version: 1,
        installed: [
          {
            slug: 'critical-issues-only',
            name: 'critical-issues-only',
            source: 'manual',
            kind: 'baseline',
            description: 'x',
          },
        ],
      }),
    );
    await writeFile(
      join(skillsDir, 'critical-issues-only', 'SKILL.md'),
      '---\nname: critical-issues-only\ndescription: x\nsource: manual\nreview_mode: shared\n---\n\nrules',
    );

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'commit'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(CLUD_BUG_RECIPE_MARKER);
    expect(r.stdout).toMatch(/git show[^\n]*HEAD/);
    expect(r.stdout).toContain('critical-issues-only');
  });

  it('honors a SKILL.md review_passes override on a pr trigger (rawSkillMd forwarded)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp2-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'deep-skill'), { recursive: true });
    await writeFile(
      join(skillsDir, '.clud-bug.json'),
      JSON.stringify({
        version: 1,
        installed: [
          { slug: 'deep-skill', name: 'deep-skill', source: 'manual', kind: 'baseline', description: 'x' },
        ],
      }),
    );
    // The skill author asks for a 3-pass consensus review via SKILL.md frontmatter
    // (precedence layer 2) — this only lands if runReviewPrompt forwards rawSkillMd.
    await writeFile(
      join(skillsDir, 'deep-skill', 'SKILL.md'),
      '---\nname: deep-skill\ndescription: x\nsource: manual\nreview_mode: shared\nreview_passes:\n  count: 3\n  mode: consensus\n---\n\nrules',
    );

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'pr'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Dispatch 3 reviewer/i);
  });

  it('warns on an unrecognized --trigger and falls back to a commit recipe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rp3-'));
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, '.clud-bug.json'), JSON.stringify({ version: 1, installed: [] }));

    const r = spawnSync(process.execPath, [CLI, 'review-prompt', '--trigger', 'bogus'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/unrecognized --trigger/i);
    expect(r.stdout).toMatch(/git show[^\n]*HEAD/);
  });
});
