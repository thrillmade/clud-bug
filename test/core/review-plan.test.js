// Tests for src/core/review-plan.ts — ported from clud-bug-app's
// test/multi-pass-config.test.ts. Behavior is pinned identically; only the
// import path + the `skills` shape (decoupled from the App `LoadedSkill`)
// differ. Test runner converted from the App's vitest setup to clud-bug's
// vitest (`.test.js` importing the `.ts` source via the `.js` extension).

import { describe, expect, it } from 'vitest';

import {
  anyMultiPass,
  BUILTIN_DEFAULT,
  BUILTIN_ROLES,
  extractSkillReviewPassesOverride,
  MAX_PASSES,
  readReviewPassesConfig,
  resolveReviewPasses,
  roleForPass,
  totalPassCount,
} from '../../src/core/review-plan.js';

// Tests focus on:
//   - precedence chain: perSkill > frontmatter > repoDefault > builtin
//   - MAX_PASSES = 3 hard cap (silently clamps)
//   - applyTo: shared-only correctly clamps dedicated skills to count = 1
//   - SKILL.md frontmatter `review_passes` block parsing
//   - .clud-bug.json's two layouts (flat vs default+perSkill)
//   - role recycling when roles.length < pass count
//   - source provenance label is honest

// `resolveReviewPasses` only reads `slug` + `frontmatter.review_mode`. Build
// the minimal `{ slug, frontmatter }` shape (core `SkillFrontmatter`) rather
// than the App's full `LoadedSkill`.
function makeSkill(slug, overrides = {}, raw) {
  return {
    slug,
    frontmatter: {
      name: slug,
      description: `Test skill ${slug}`,
      source: 'manual',
      review_mode: overrides.review_mode ?? 'shared',
      applies_to: overrides.applies_to,
      ...overrides,
    },
    body: `# ${slug}\n\nrules`,
    raw:
      raw ??
      `---\nname: ${slug}\ndescription: Test skill ${slug}\nsource: manual\nreview_mode: ${overrides.review_mode ?? 'shared'}\n---\n\n# ${slug}\n\nrules`,
  };
}

// ---------------------------------------------------------------------------
// readReviewPassesConfig
// ---------------------------------------------------------------------------

describe('readReviewPassesConfig', () => {
  it('returns null when reviewPasses is absent', () => {
    expect(readReviewPassesConfig({})).toBeNull();
    expect(readReviewPassesConfig({ version: 1, installed: [] })).toBeNull();
    expect(readReviewPassesConfig(null)).toBeNull();
    expect(readReviewPassesConfig(undefined)).toBeNull();
  });

  it('reads the flat layout: count + mode + applyTo + roles', () => {
    const config = readReviewPassesConfig({
      reviewPasses: {
        count: 2,
        mode: 'cross-check',
        applyTo: 'all',
        roles: [
          { name: 'Beetle', model: 'anthropic/claude-sonnet-4.6' },
          { name: 'Wasp', model: 'anthropic/claude-opus-4.7' },
        ],
      },
    });
    expect(config).toMatchObject({
      count: 2,
      mode: 'cross-check',
      applyTo: 'all',
      roles: [
        { name: 'Beetle', model: 'anthropic/claude-sonnet-4.6' },
        { name: 'Wasp', model: 'anthropic/claude-opus-4.7' },
      ],
    });
  });

  it('reads the split layout: default + perSkill', () => {
    const config = readReviewPassesConfig({
      reviewPasses: {
        default: { count: 1, mode: 'cross-check' },
        perSkill: {
          'security-audit': { count: 3 },
          'brand-voice-review': { count: 1 },
        },
      },
    });
    expect(config?.default).toEqual({ count: 1, mode: 'cross-check' });
    expect(config?.perSkill).toEqual({
      'security-audit': { count: 3 },
      'brand-voice-review': { count: 1 },
    });
  });

  it('silently clamps count above MAX_PASSES', () => {
    const config = readReviewPassesConfig({
      reviewPasses: {
        count: 99,
        perSkill: { 'security-audit': { count: 7 } },
      },
    });
    expect(config?.count).toBe(MAX_PASSES);
    expect(config?.perSkill?.['security-audit']?.count).toBe(MAX_PASSES);
  });

  it('rejects invalid modes (silently drops them)', () => {
    const config = readReviewPassesConfig({
      reviewPasses: { count: 2, mode: 'banana' },
    });
    expect(config?.mode).toBeUndefined();
  });

  it('rejects invalid applyTo values (defaults to absent)', () => {
    const config = readReviewPassesConfig({
      reviewPasses: { applyTo: 'sometimes' },
    });
    expect(config?.applyTo).toBeUndefined();
  });

  it('drops malformed roles (missing name or model)', () => {
    const config = readReviewPassesConfig({
      reviewPasses: {
        roles: [
          { name: 'Beetle', model: 'anthropic/claude-sonnet-4.6' },
          { name: '', model: 'x' }, // dropped
          { model: 'foo' }, // dropped — no name
          { name: 'Wasp', model: 'anthropic/claude-opus-4.7' },
        ],
      },
    });
    expect(config?.roles).toEqual([
      { name: 'Beetle', model: 'anthropic/claude-sonnet-4.6' },
      { name: 'Wasp', model: 'anthropic/claude-opus-4.7' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// extractSkillReviewPassesOverride
// ---------------------------------------------------------------------------

describe('extractSkillReviewPassesOverride', () => {
  it('returns null when the block is absent', () => {
    const raw = `---
name: security-audit
description: Audit
source: manual
review_mode: dedicated
---

# audit
`;
    expect(extractSkillReviewPassesOverride(raw)).toBeNull();
  });

  it('parses count + mode from a nested review_passes block', () => {
    const raw = `---
name: security-audit
description: Audit
source: manual
review_mode: dedicated
review_passes:
  count: 3
  mode: consensus
---

body
`;
    expect(extractSkillReviewPassesOverride(raw)).toEqual({
      count: 3,
      mode: 'consensus',
    });
  });

  it('clamps count above MAX_PASSES', () => {
    const raw = `---
name: x
review_passes:
  count: 99
---
`;
    expect(extractSkillReviewPassesOverride(raw)?.count).toBe(MAX_PASSES);
  });

  it('returns null when the block is empty (no count / no mode)', () => {
    const raw = `---
name: x
review_passes:
---
`;
    expect(extractSkillReviewPassesOverride(raw)).toBeNull();
  });

  it('ignores invalid modes', () => {
    const raw = `---
name: x
review_passes:
  mode: banana
  count: 2
---
`;
    expect(extractSkillReviewPassesOverride(raw)).toEqual({ count: 2 });
  });

  it('tolerates quoted strings on mode', () => {
    const raw = `---
name: x
review_passes:
  mode: "consensus"
  count: 2
---
`;
    expect(extractSkillReviewPassesOverride(raw)?.mode).toBe('consensus');
  });
});

// ---------------------------------------------------------------------------
// resolveReviewPasses — precedence chain
// ---------------------------------------------------------------------------

describe('resolveReviewPasses — precedence', () => {
  it('falls back to BUILTIN_DEFAULT when nothing supplies a value', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: null,
    });
    expect(resolved.perSkill[0]).toMatchObject({
      slug: 'skill-a',
      count: BUILTIN_DEFAULT.count,
      mode: BUILTIN_DEFAULT.mode,
      source: 'builtin',
    });
    expect(resolved.roles).toEqual(BUILTIN_ROLES);
    expect(resolved.applyTo).toBe('all');
  });

  it('uses .clud-bug.json default when no per-skill or frontmatter override', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: {
        default: { count: 2, mode: 'consensus' },
      },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      count: 2,
      mode: 'consensus',
      source: 'repoDefault',
    });
  });

  it('uses the flat layout (count/mode top-level) when default absent', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: { count: 2, mode: 'cross-check' },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      count: 2,
      mode: 'cross-check',
      source: 'repoDefault',
    });
  });

  it('explicit `default` wins over flat keys when both are present', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: {
        count: 1, // flat — should be overridden
        default: { count: 3, mode: 'consensus' },
      },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      count: 3,
      mode: 'consensus',
    });
  });

  it('SKILL.md frontmatter overrides repo default', () => {
    const raw = `---
name: skill-a
description: x
source: manual
review_mode: shared
review_passes:
  count: 2
  mode: consensus
---
body`;
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a', {}, raw)],
      rawSkillMd: { 'skill-a': raw },
      config: { default: { count: 1, mode: 'cross-check' } },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      count: 2,
      mode: 'consensus',
      source: 'frontmatter',
    });
  });

  it('perSkill override wins over SKILL.md frontmatter', () => {
    const raw = `---
name: skill-a
description: x
source: manual
review_mode: shared
review_passes:
  count: 2
  mode: consensus
---
body`;
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a', {}, raw)],
      rawSkillMd: { 'skill-a': raw },
      config: {
        default: { count: 1, mode: 'cross-check' },
        perSkill: { 'skill-a': { count: 3, mode: 'independent' } },
      },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      count: 3,
      mode: 'independent',
      source: 'perSkill',
    });
  });

  it('full precedence chain: perSkill > frontmatter > repoDefault > builtin', () => {
    // Skill A has only frontmatter override (count 2).
    // Skill B has perSkill override (count 3).
    // Skill C has nothing (falls back to repoDefault count 1).
    // Skill D has no config at all (builtin count 1).
    const rawA = `---
name: skill-a
description: x
source: manual
review_mode: shared
review_passes:
  count: 2
---
body`;
    const resolved = resolveReviewPasses({
      skills: [
        makeSkill('skill-a', {}, rawA),
        makeSkill('skill-b'),
        makeSkill('skill-c'),
        makeSkill('skill-d'),
      ],
      rawSkillMd: { 'skill-a': rawA },
      config: {
        default: { count: 1, mode: 'cross-check' },
        perSkill: { 'skill-b': { count: 3 } },
      },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      slug: 'skill-a',
      count: 2,
      source: 'frontmatter',
    });
    expect(resolved.perSkill[1]).toMatchObject({
      slug: 'skill-b',
      count: 3,
      source: 'perSkill',
    });
    expect(resolved.perSkill[2]).toMatchObject({
      slug: 'skill-c',
      count: 1,
      source: 'repoDefault',
    });
    expect(resolved.perSkill[3]).toMatchObject({
      slug: 'skill-d',
      count: 1,
      source: 'repoDefault',
    });
  });
});

// ---------------------------------------------------------------------------
// resolveReviewPasses — applyTo: shared-only
// ---------------------------------------------------------------------------

describe('resolveReviewPasses — applyTo: shared-only', () => {
  it('clamps dedicated skills to count = 1', () => {
    const resolved = resolveReviewPasses({
      skills: [
        makeSkill('shared-skill', { review_mode: 'shared' }),
        makeSkill('dedicated-skill', { review_mode: 'dedicated' }),
      ],
      config: {
        applyTo: 'shared-only',
        default: { count: 3, mode: 'consensus' },
      },
    });
    expect(resolved.perSkill[0]).toMatchObject({
      slug: 'shared-skill',
      count: 3,
    });
    expect(resolved.perSkill[1]).toMatchObject({
      slug: 'dedicated-skill',
      count: 1, // clamped, not 3
    });
    expect(resolved.applyTo).toBe('shared-only');
  });

  it('perSkill override cannot bypass shared-only clamp', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('dedicated-skill', { review_mode: 'dedicated' })],
      config: {
        applyTo: 'shared-only',
        default: { count: 1 },
        perSkill: { 'dedicated-skill': { count: 3 } },
      },
    });
    expect(resolved.perSkill[0]?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MAX_PASSES enforcement at resolve time
// ---------------------------------------------------------------------------

describe('resolveReviewPasses — clamping', () => {
  it('clamps perSkill > MAX_PASSES to MAX_PASSES', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: {
        perSkill: { 'skill-a': { count: 99 } },
      },
    });
    expect(resolved.perSkill[0]?.count).toBe(MAX_PASSES);
  });

  it('clamps frontmatter > MAX_PASSES to MAX_PASSES', () => {
    const raw = `---
name: skill-a
description: x
review_mode: shared
review_passes:
  count: 99
---
body`;
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a', {}, raw)],
      rawSkillMd: { 'skill-a': raw },
      config: null,
    });
    expect(resolved.perSkill[0]?.count).toBe(MAX_PASSES);
  });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe('roleForPass', () => {
  it('returns the i-th role when within range', () => {
    expect(roleForPass(BUILTIN_ROLES, 0, 'fallback')).toEqual(BUILTIN_ROLES[0]);
    expect(roleForPass(BUILTIN_ROLES, 1, 'fallback')).toEqual(BUILTIN_ROLES[1]);
    expect(roleForPass(BUILTIN_ROLES, 2, 'fallback')).toEqual(BUILTIN_ROLES[2]);
  });

  it('recycles roles when pass index exceeds array length', () => {
    const roles = [BUILTIN_ROLES[0]]; // single-role array
    expect(roleForPass(roles, 0, 'fallback')).toEqual(roles[0]);
    expect(roleForPass(roles, 1, 'fallback')).toEqual(roles[0]);
    expect(roleForPass(roles, 5, 'fallback')).toEqual(roles[0]);
  });

  it('synthesizes Pass N name when roles is empty', () => {
    const role = roleForPass([], 0, 'fallback/model');
    expect(role.name).toBe('Pass 1');
    expect(role.model).toBe('fallback/model');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('anyMultiPass / totalPassCount', () => {
  it('anyMultiPass returns true when at least one skill needs > 1', () => {
    expect(
      anyMultiPass([
        { slug: 'a', count: 1, mode: 'cross-check', roles: [], source: 'builtin' },
        { slug: 'b', count: 2, mode: 'cross-check', roles: [], source: 'perSkill' },
      ]),
    ).toBe(true);
    expect(
      anyMultiPass([
        { slug: 'a', count: 1, mode: 'cross-check', roles: [], source: 'builtin' },
      ]),
    ).toBe(false);
  });

  it('totalPassCount sums every skill', () => {
    expect(
      totalPassCount([
        { slug: 'a', count: 1, mode: 'cross-check', roles: [], source: 'builtin' },
        { slug: 'b', count: 3, mode: 'consensus', roles: [], source: 'perSkill' },
        { slug: 'c', count: 2, mode: 'cross-check', roles: [], source: 'frontmatter' },
      ]),
    ).toBe(6);
  });
});
