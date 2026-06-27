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

import { appliesToAuthor, parseFrontmatter, stripFrontmatter } from '../src/core/skills.js';

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
// v0.7.0-rc.6 — SPEC v0.5.0+ kind + voice_scope surfaced on frontmatter
// (Wave 4d reviewer-flagged silent-drop, now formalized in v0.5.1)
// ---------------------------------------------------------------------------

test('parseFrontmatter: kind: voice + voice_scope: org surfaced on parsed frontmatter', () => {
  const raw = `---
name: voice-acme
description: Acme org voice for the bot.
kind: voice
voice_scope: org
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.kind, 'voice');
  assert.equal(fm.voice_scope, 'org');
});

test('parseFrontmatter: kind: rule surfaced explicitly', () => {
  const raw = `---
name: my-rule
description: A rule skill.
kind: rule
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.kind, 'rule');
});

test('parseFrontmatter: unknown kind silently drops (defensive)', () => {
  const raw = `---
name: weird
description: Weird kind.
kind: enterprise
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.kind, undefined);
});

test('parseFrontmatter: unknown voice_scope silently drops', () => {
  const raw = `---
name: weird-voice
description: Weird scope.
kind: voice
voice_scope: galaxy
---
Body.
`;
  const fm = parseFrontmatter(raw);
  assert.equal(fm.kind, 'voice');
  assert.equal(fm.voice_scope, undefined);
});

test('parseFrontmatter: absent kind + voice_scope → both undefined (v0.5.0 default)', () => {
  const fm = parseFrontmatter(MINIMAL_VALID);
  assert.equal(fm.kind, undefined);
  assert.equal(fm.voice_scope, undefined);
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
