// Equivalence test: src/core/skills.ts `parseFrontmatter` + `stripFrontmatter`
// must produce byte-identical results to clud-bug-app/lib/skills-loader.ts
// (lines 163 + 269) that they were ported from.
//
// Pattern mirrors test/review-schema-zod.test.js. If a future edit drifts
// the core parser from the App's, the App's swap to `clud-bug/core` would
// silently change which skills load (different field defaults, different
// failure-throw cases). This test catches the drift before merge.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import {
  appliesToAuthor,
  parseFrontmatter,
  resolveSkillKind,
  stripFrontmatter,
} from '../src/core/skills.js';

// ---------------------------------------------------------------------------
// Valid frontmatter
// ---------------------------------------------------------------------------

const MINIMAL_VALID = `---
name: critical-issues-only
description: Only correctness + security findings.
---
Body text here.
`;

test('parseFrontmatter: minimal valid → defaults applied', () => {
  const fm = parseFrontmatter(MINIMAL_VALID);
  assert.equal(fm.name, 'critical-issues-only');
  assert.equal(fm.description, 'Only correctness + security findings.');
  assert.equal(fm.source, 'manual'); // default
  assert.equal(fm.review_mode, 'shared'); // default
  assert.equal(fm.applies_to, undefined);
});

// Inline-list form for both paths and extensions — what the App's parser
// actually supports (one-level nesting, scalar OR inline-list values).
// Block-form list items (`  paths:\n    - "x"`) are NOT supported by the
// hand-rolled parser; SPEC examples use inline arrays.
const FULL_FRONTMATTER = `---
name: brand-voice
description: Audit microcopy against the brand voice guide.
source: skills-sh
review_mode: dedicated
applies_to:
  paths: ["src/ui/**", "lib/components/**"]
  extensions: [".tsx", ".jsx"]
---
Body
`;

test('parseFrontmatter: full frontmatter parses every field', () => {
  const fm = parseFrontmatter(FULL_FRONTMATTER);
  assert.equal(fm.name, 'brand-voice');
  assert.equal(fm.description, 'Audit microcopy against the brand voice guide.');
  assert.equal(fm.source, 'skills-sh');
  assert.equal(fm.review_mode, 'dedicated');
  assert.deepEqual(fm.applies_to, {
    paths: ['src/ui/**', 'lib/components/**'],
    extensions: ['.tsx', '.jsx'],
  });
});

test('parseFrontmatter: review_mode falls back to "shared" on unknown values', () => {
  const raw = `---
name: x
description: y
review_mode: maybe
---
body
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.review_mode, 'shared');
});

test('parseFrontmatter: inline list parses quoted + bare items', () => {
  const raw = `---
name: x
description: y
applies_to:
  extensions: [".ts", '.tsx', .jsx]
---
body
`;
  const fm = parseFrontmatter(raw);
  assert.deepEqual(fm.applies_to?.extensions, ['.ts', '.tsx', '.jsx']);
});

test('parseFrontmatter: tolerates leading BOM', () => {
  const raw = '﻿' + MINIMAL_VALID;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.name, 'critical-issues-only');
});

test('parseFrontmatter: tolerates CRLF line endings', () => {
  const raw = MINIMAL_VALID.replace(/\n/g, '\r\n');
  const fm = parseFrontmatter(raw);
  assert.equal(fm.name, 'critical-issues-only');
});

test('parseFrontmatter: ignores YAML comment lines', () => {
  const raw = `---
# This is a comment
name: x
# Another comment
description: y
---
body
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.name, 'x');
  assert.equal(fm.description, 'y');
});

test('parseFrontmatter: strips surrounding quotes on scalars', () => {
  const raw = `---
name: "quoted-skill"
description: 'single-quoted desc'
---
body
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.name, 'quoted-skill');
  assert.equal(fm.description, 'single-quoted desc');
});

// ---------------------------------------------------------------------------
// Throws on malformed input
// ---------------------------------------------------------------------------

test('parseFrontmatter: throws when no frontmatter present', () => {
  assert.throws(() => parseFrontmatter('no frontmatter here'), /missing YAML frontmatter/);
});

test('parseFrontmatter: throws on missing name', () => {
  assert.throws(
    () => parseFrontmatter('---\ndescription: x\n---\nbody'),
    /frontmatter.name is required/,
  );
});

test('parseFrontmatter: throws on missing description', () => {
  assert.throws(
    () => parseFrontmatter('---\nname: valid-name\n---\nbody'),
    /frontmatter.description is required/,
  );
});

test('parseFrontmatter: throws on invalid name (uppercase / leading digit / too long)', () => {
  for (const badName of ['Uppercase', '1leading', 'x'.repeat(64)]) {
    const raw = `---
name: ${badName}
description: y
---
body
`;
    assert.throws(() => parseFrontmatter(raw), /not a valid kebab-case slug/);
  }
});

test('parseFrontmatter: throws on malformed frontmatter line', () => {
  const raw = `---
name: valid
description: ok
this-has-no-colon
---
body
`;
  assert.throws(() => parseFrontmatter(raw), /malformed frontmatter line/);
});

// ---------------------------------------------------------------------------
// applies_to edge cases
// ---------------------------------------------------------------------------

test('parseFrontmatter: applies_to absent → undefined', () => {
  const fm = parseFrontmatter(MINIMAL_VALID);
  assert.equal(fm.applies_to, undefined);
});

test('parseFrontmatter: applies_to with only inline paths (no extensions)', () => {
  const raw = `---
name: x
description: y
applies_to:
  paths: ["src/**"]
---
body
`;
  const fm = parseFrontmatter(raw);
  assert.deepEqual(fm.applies_to?.paths, ['src/**']);
  assert.equal(fm.applies_to?.extensions, undefined);
});

test('parseFrontmatter: applies_to with empty inline list → empty array', () => {
  const raw = `---
name: x
description: y
applies_to:
  paths: []
---
body
`;
  const fm = parseFrontmatter(raw);
  assert.deepEqual(fm.applies_to?.paths, []);
});

// ---------------------------------------------------------------------------
// stripFrontmatter
// ---------------------------------------------------------------------------

test('stripFrontmatter: removes the leading `---\\n...\\n---\\n` block', () => {
  const body = stripFrontmatter(MINIMAL_VALID);
  assert.equal(body.trim(), 'Body text here.');
});

test('stripFrontmatter: missing frontmatter → returns input verbatim', () => {
  const text = 'No frontmatter here.\nJust body.\n';
  assert.equal(stripFrontmatter(text), text);
});

test('stripFrontmatter: strips BOM', () => {
  const raw = '﻿' + MINIMAL_VALID;
  const body = stripFrontmatter(raw);
  assert.ok(!body.includes('﻿'));
  assert.equal(body.trim(), 'Body text here.');
});

test('stripFrontmatter: handles CRLF line endings', () => {
  const raw = MINIMAL_VALID.replace(/\n/g, '\r\n');
  const body = stripFrontmatter(raw);
  assert.ok(body.includes('Body text here.'));
});

// ---------------------------------------------------------------------------
// clud-bug#263 — SPEC 2.0 §2.1/§2.2 `kind` resolution.
//
// Two rules, and the whole point is that they fail in OPPOSITE directions:
//   §2.1 "A skill with no `kind` is a `rule` skill."      → absent       → rule
//   §2.2 "An unrecognised `kind` MUST be treated as `writing`."          → writing
//
// Before this, EVERY value outside the ladder resolved to `undefined`, and
// `undefined` is indistinguishable from absent — so a typo, and the not-yet-in-
// the-ladder `writing`, inherited §2.1's `rule` default: the HIGHEST authority
// tier, able to be the sole citation for a finding about code behaviour, which
// §2.2 exists to withhold from a prose skill.
// ---------------------------------------------------------------------------

const KIND = (kind) => `---
name: kind-fixture
description: A skill with a kind.
${kind === null ? '' : `kind: ${kind}\n`}---
Body.
`;

test('parseFrontmatter: kind: rule surfaced explicitly', () => {
  assert.equal(parseFrontmatter(KIND('rule')).kind, 'rule');
});

test('parseFrontmatter: kind: writing is RECOGNISED (SPEC 2.0 renamed it from `voice`)', () => {
  // The bug in #263: `writing` was absent from the ladder, so it fell to
  // `undefined` → read as the absent-kind default → `rule`.
  assert.equal(parseFrontmatter(KIND('writing')).kind, 'writing');
});

test('parseFrontmatter: kind: design surfaced (visual-review lens)', () => {
  const raw = `---
name: visual-polish
description: A design skill.
kind: design
review_mode: dedicated
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.kind, 'design');
  assert.equal(fm.review_mode, 'dedicated');
});

test('parseFrontmatter: absent kind → rule (SPEC 2.0 §2.1 default)', () => {
  assert.equal(parseFrontmatter(MINIMAL_VALID).kind, 'rule');
  assert.equal(parseFrontmatter(KIND(null)).kind, 'rule');
});

// The regression this issue is about: every one of these MUST land on
// `writing`, and NOT ONE of them may come back `rule`.
for (const garbage of [
  'enterprise', // a value that never existed
  'writng', // a plausible typo of the real value
  'Writing', // right word, wrong case — SPEC enumerates lowercase values
  'voice', // the retired pre-2.0 name; demotes, and prose is where it belonged
  'rule ; design', // punctuation soup
  '[]', // parses as an inline list, not a scalar
  '"writing", "rule"', // two values where one is allowed
]) {
  test(`parseFrontmatter: unrecognised kind ${JSON.stringify(garbage)} → writing, never rule (SPEC 2.0 §2.2)`, () => {
    const fm = parseFrontmatter(KIND(garbage));
    assert.equal(fm.kind, 'writing');
    assert.notEqual(fm.kind, 'rule');
  });
}

test('parseFrontmatter: a bare `kind:` with no value → writing, not rule', () => {
  // The hand-rolled parser reads a valueless key as a nested block (`{}`), so
  // this arrives as a non-string. Present-but-unusable is a mistake, and a
  // mistake resolves DOWN (§2.2), not to §2.1's absent-key default.
  const raw = `---
name: bare-kind
description: A skill whose kind line has no value.
kind:
---
Body.
`;
  assert.equal(parseFrontmatter(raw).kind, 'writing');
});

test('parseFrontmatter: an unrecognised kind still LOADS the skill (degrade, never reject)', () => {
  // SPEC 2.0 §2.1: "A consumer MUST NOT refuse to load a skill because of a key
  // it does not recognise"; §2.2: "A skill loads and is applied — a typo does
  // not discard it". So this must not throw, and must keep every other field.
  const fm = parseFrontmatter(KIND('enterprise'));
  assert.equal(fm.name, 'kind-fixture');
  assert.equal(fm.description, 'A skill with a kind.');
  assert.equal(fm.source, 'manual');
  assert.equal(fm.review_mode, 'shared');
});

test('parseFrontmatter: voice_scope is gone — SPEC 2.0 dropped it from the schema', () => {
  const raw = `---
name: voice-acme
description: A skill still carrying the retired pre-2.0 fields.
kind: voice
voice_scope: org
---
Body.
`;
  const fm = parseFrontmatter(raw);
  // Unknown keys are dropped from the parsed shape, never a load failure.
  assert.equal(fm.voice_scope, undefined);
  assert.equal(fm.kind, 'writing');
});

// ---------------------------------------------------------------------------
// resolveSkillKind — the rule on its own, so a consumer that builds a
// frontmatter by hand (rather than via parseFrontmatter) routes identically.
// ---------------------------------------------------------------------------

test('resolveSkillKind: absent (undefined/null) → rule', () => {
  assert.equal(resolveSkillKind(undefined), 'rule');
  assert.equal(resolveSkillKind(null), 'rule');
});

test('resolveSkillKind: the three recognised values round-trip', () => {
  assert.equal(resolveSkillKind('rule'), 'rule');
  assert.equal(resolveSkillKind('writing'), 'writing');
  assert.equal(resolveSkillKind('design'), 'design');
});

test('resolveSkillKind: whitespace around a recognised value is tolerated', () => {
  assert.equal(resolveSkillKind('  design  '), 'design');
});

test('resolveSkillKind: non-string and unrecognised inputs → writing, never rule', () => {
  for (const bad of ['enterprise', '', '  ', 42, true, {}, [], ['writing'], () => {}]) {
    assert.equal(resolveSkillKind(bad), 'writing', `resolveSkillKind(${String(bad)})`);
  }
});

// ---------------------------------------------------------------------------
// v0.7.0-rc.6 — SPEC v0.5.1 applies_to.author field
// ---------------------------------------------------------------------------

test('parseFrontmatter: applies_to.author surfaces a single login string', () => {
  const raw = `---
name: conventions-ludlow
description: ludlow's review conventions.
kind: rule
applies_to:
  author: ludlow
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.applies_to?.author, 'ludlow');
});

test('parseFrontmatter: applies_to.author with paths + author composes both', () => {
  const raw = `---
name: conventions-ludlow-ts
description: ludlow's TS conventions.
kind: rule
applies_to:
  paths: ["src/**"]
  author: ludlow
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.deepEqual(fm.applies_to?.paths, ['src/**']);
  assert.equal(fm.applies_to?.author, 'ludlow');
});

test('parseFrontmatter: empty author string drops (treated as absent)', () => {
  const raw = `---
name: empty-author
description: Empty author.
applies_to:
  author: ""
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.applies_to?.author, undefined);
});

test('parseFrontmatter: empty applies_to block (no sub-keys) → applies_to undefined', () => {
  // Reviewer-flagged on PR #179: an `applies_to:` block with no
  // sub-keys was emitting `applies_to: {}` on the parsed
  // frontmatter, leaking into the prompt as JSON noise and
  // diverging semantically from readAppliesTo's null return for
  // the same input. The fix omits applies_to entirely when no
  // sub-field is present.
  const raw = `---
name: no-filters
description: Empty applies_to.
applies_to:
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.applies_to, undefined);
});

// ---------------------------------------------------------------------------
// v0.7.0-rc.6 — appliesToAuthor helper (SPEC §1.10.1 v0.5.1)
// ---------------------------------------------------------------------------

const AUTHOR_LUDLOW_SKILL = `---
name: conventions-ludlow
description: ludlow's review conventions.
kind: rule
applies_to:
  author: ludlow
---
Body.
`;

const QUOTED_AUTHOR_SKILL = `---
name: conventions-ludlow
description: ludlow's review conventions.
applies_to:
  author: "ludlow"
---
Body.
`;

const NO_AUTHOR_SKILL = `---
name: critical-issues-only
description: No author filter.
applies_to:
  paths: ["src/**"]
---
Body.
`;

test('appliesToAuthor: matching author → true', () => {
  assert.equal(appliesToAuthor(AUTHOR_LUDLOW_SKILL, 'ludlow'), true);
});

test('appliesToAuthor: non-matching author → false', () => {
  assert.equal(appliesToAuthor(AUTHOR_LUDLOW_SKILL, 'alice'), false);
});

test('appliesToAuthor: case-insensitive (GitHub logins route case-insensitively)', () => {
  // GitHub treats `Ludlow` and `ludlow` as the same user. Skill
  // authors may capitalize differently from what the webhook
  // delivers; matching MUST be case-insensitive so authoring style
  // doesn't silently break filtering. Reviewer-flagged Important
  // on PR #179.
  assert.equal(appliesToAuthor(AUTHOR_LUDLOW_SKILL, 'Ludlow'), true);
  assert.equal(appliesToAuthor(AUTHOR_LUDLOW_SKILL, 'LUDLOW'), true);
});

test('appliesToAuthor: quoted author value strips quotes', () => {
  assert.equal(appliesToAuthor(QUOTED_AUTHOR_SKILL, 'ludlow'), true);
});

test('appliesToAuthor: no applies_to.author → true regardless of PR author (backward-compat)', () => {
  assert.equal(appliesToAuthor(NO_AUTHOR_SKILL, 'anyone'), true);
  assert.equal(appliesToAuthor(NO_AUTHOR_SKILL, ''), true);
});

test('appliesToAuthor: no frontmatter → true (defensive, never throws)', () => {
  assert.equal(appliesToAuthor('Plain markdown.', 'ludlow'), true);
});

test('appliesToAuthor: empty PR author + author filter set → false', () => {
  assert.equal(appliesToAuthor(AUTHOR_LUDLOW_SKILL, ''), false);
});

test('appliesToAuthor: non-string skill content → true (defensive)', () => {
  assert.equal(appliesToAuthor(undefined, 'ludlow'), true);
  assert.equal(appliesToAuthor(null, 'ludlow'), true);
  assert.equal(appliesToAuthor(42, 'ludlow'), true);
});
