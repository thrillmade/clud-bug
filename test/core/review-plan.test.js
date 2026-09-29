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

// ---------------------------------------------------------------------------
// clud-bug#268 — a pass is a dispatched role from the roster (SPEC §2.4), not
// a mode of the reviewer. `resolveReviewPasses` matches a role's `name`
// against the roster by exact string; a match's `model` overrides the tier
// fallback (`BUILTIN_ROLES` / config `roles`), which stays as a fallback only.
// ---------------------------------------------------------------------------

describe('resolveReviewPasses — roster resolution (#268)', () => {
  it('a roster entry matching a role by exact name overrides that role\'s model', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: null,
      roster: [
        { name: 'Beetle', description: 'x', model: 'anthropic/claude-haiku-9', file: '.claude/agents/Beetle.md' },
      ],
    });
    const beetle = resolved.roles.find((r) => r.name === 'Beetle');
    expect(beetle?.model).toBe('anthropic/claude-haiku-9');
    expect(beetle?.rosterFile).toBe('.claude/agents/Beetle.md');
    // Untouched roles (no matching roster entry) keep their tier-fallback model.
    const wasp = resolved.roles.find((r) => r.name === 'Wasp');
    expect(wasp?.model).toBe(BUILTIN_ROLES.find((r) => r.name === 'Wasp')?.model);
    expect(wasp?.rosterFile).toBeUndefined();
  });

  it('falls back to the tier model when no roster entry matches by exact name', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: null,
      roster: [{ name: 'beetle', description: 'x', model: 'anthropic/claude-haiku-9', file: '.claude/agents/beetle.md' }],
    });
    // BUILTIN_ROLES' display name is "Beetle" (capital B) — a roster entry
    // named "beetle" (lowercase, the kebab-case SPEC §2.4 shape) does NOT
    // match by exact name, so the tier fallback is unchanged.
    const beetle = resolved.roles.find((r) => r.name === 'Beetle');
    expect(beetle?.model).toBe(BUILTIN_ROLES.find((r) => r.name === 'Beetle')?.model);
    expect(beetle?.rosterFile).toBeUndefined();
  });

  it('a roster entry with no model does not override the tier fallback, but still surfaces as a match', () => {
    // A `model`-less entry is spec-legal (agent-skills#180: "model is
    // optional") — it must not be invisible on the surface just because it
    // has nothing to override the tier fallback with.
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: null,
      roster: [{ name: 'Beetle', description: 'x', file: '.claude/agents/Beetle.md' }],
    });
    const beetle = resolved.roles.find((r) => r.name === 'Beetle');
    expect(beetle?.model).toBe(BUILTIN_ROLES.find((r) => r.name === 'Beetle')?.model);
    expect(beetle?.rosterFile).toBe('.claude/agents/Beetle.md');
  });

  it('a matched role resolves via the roster for a custom `reviewPasses.roles` name too', () => {
    const resolved = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: {
        roles: [{ name: 'security-pass', model: 'anthropic/claude-sonnet-4.6' }],
      },
      roster: [
        {
          name: 'security-pass',
          description: 'Security-focused reviewer.',
          model: 'anthropic/claude-opus-4.7',
          file: '.claude/agents/security-pass.md',
        },
      ],
    });
    expect(resolved.roles).toEqual([
      {
        name: 'security-pass',
        model: 'anthropic/claude-opus-4.7',
        rosterFile: '.claude/agents/security-pass.md',
      },
    ]);
  });

  it('an empty/absent roster leaves the tier fallback exactly as before (#268 back-compat)', () => {
    const withoutRoster = resolveReviewPasses({ skills: [makeSkill('skill-a')], config: null });
    const withEmptyRoster = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: null,
      roster: [],
    });
    expect(withEmptyRoster.roles).toEqual(withoutRoster.roles);
  });

  // The baseline pass MUST run regardless of what the roster does — a
  // repository with no roster, an empty roster, or a fully-malformed roster
  // (readRoster reports it in `problems`, but a bad file is never passed
  // through as an `entry`) still gets at least one pass per skill.
  it('the baseline pass is never skippable — count stays >= 1 whatever the roster resolves', () => {
    const noRoster = resolveReviewPasses({ skills: [makeSkill('skill-a')], config: null });
    const withRoster = resolveReviewPasses({
      skills: [makeSkill('skill-a')],
      config: null,
      roster: [{ name: 'Beetle', description: 'x', model: 'anthropic/claude-haiku-9', file: '.claude/agents/Beetle.md' }],
    });
    // Pinned against the literal floor (1), not a re-imported MIN_PASSES — a
    // mutation that lowered MIN_PASSES itself must not drag this guard's
    // expectation down with it.
    expect(noRoster.perSkill[0]?.count).toBeGreaterThanOrEqual(1);
    expect(withRoster.perSkill[0]?.count).toBeGreaterThanOrEqual(1);
    expect(withRoster.perSkill[0]?.count).toBe(noRoster.perSkill[0]?.count);
  });
});

// ---------------------------------------------------------------------------
// #271 — `review.passes`'s blocking marker (SPEC §1.6's table: "Marking a pass
// blocking is humans-only"; §4.8: "A repository MAY opt a design critical into
// blocking, by marking that pass blocking in `review.passes`"). §6.3 puts the
// read on the base ref, so the change being judged cannot mark its own pass.
// ---------------------------------------------------------------------------

describe('readReviewPassesConfig blocking', () => {
  it('reads the blocking list when no base ref is supplied', () => {
    const config = readReviewPassesConfig({
      reviewPasses: { count: 2, blocking: ['design'] },
    });
    expect(config.blocking).toEqual(['design']);
    expect(config.count).toBe(2);
  });

  it('drops non-string and blank entries', () => {
    const config = readReviewPassesConfig({
      reviewPasses: { blocking: ['design', 42, '', null, 'security'] },
    });
    expect(config.blocking).toEqual(['design', 'security']);
  });

  it('omits blocking entirely when the key is absent or malformed', () => {
    expect(readReviewPassesConfig({ reviewPasses: { count: 2 } }).blocking).toBeUndefined();
    expect(
      readReviewPassesConfig({ reviewPasses: { blocking: 'design' } }).blocking,
    ).toBeUndefined();
  });

  it('takes blocking from the base ref when one is supplied, never from the tree', () => {
    const head = { reviewPasses: { count: 2, blocking: ['design'] } };
    const base = { reviewPasses: { blocking: ['security'] } };
    const config = readReviewPassesConfig(head, { baseRefManifest: base });
    expect(config.blocking).toEqual(['security']);
    // Everything that is not a blocking decision still reads from the tree.
    expect(config.count).toBe(2);
  });

  it('does not honour a tree-only blocking marker when a base ref is supplied', () => {
    const head = { reviewPasses: { blocking: ['design'] } };
    expect(readReviewPassesConfig(head, { baseRefManifest: {} }).blocking).toBeUndefined();
    expect(
      readReviewPassesConfig(head, { baseRefManifest: { reviewPasses: {} } }).blocking,
    ).toBeUndefined();
  });

  // The other direction of the same rule, and the one that matters for every
  // repository that never customized `review.passes`: the head cannot UNMARK a
  // pass either, whether by deleting the block, by writing a non-object over
  // it, or by simply never having had one.
  it('keeps the base-ref blocking marker when the tree has no reviewPasses at all', () => {
    const base = { reviewPasses: { blocking: ['design'] } };
    expect(
      readReviewPassesConfig({ version: 1, installed: [] }, { baseRefManifest: base }).blocking,
    ).toEqual(['design']);
    expect(
      readReviewPassesConfig({ reviewPasses: 'not an object' }, { baseRefManifest: base }).blocking,
    ).toEqual(['design']);
    expect(readReviewPassesConfig(null, { baseRefManifest: base }).blocking).toEqual(['design']);
  });

  it('still reads as unconfigured when neither ref says anything', () => {
    expect(readReviewPassesConfig({ version: 1 }, { baseRefManifest: {} })).toBeNull();
    expect(readReviewPassesConfig(null)).toBeNull();
  });
});
