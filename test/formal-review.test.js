// Table-driven tests for SPEC §7.2.1 selectReviewEvent — the pure
// formal-review event selector.
//
// Covers:
//   - self-PR skip (D.7 migration fan-out path)
//   - external-contributor gate (NEW in v0.7.0-rc.3 — drive-by exploit fix)
//   - severity-driven event selection on org-trusted authors
//   - strict-mode escalation matrix
//
// Equivalence with clud-bug-app/lib/formal-review.ts is implicit via the
// shared rule shape; clud-bug-app's Phase 7 PR B will delete its local
// copy and import this version.

import { describe, expect, it } from 'vitest';

import { selectReviewEvent } from '../src/core/formal-review.js';
import { selectReviewEvent as barrelSelectReviewEvent } from '../src/core/index.js';

describe('selectReviewEvent: self-PR guard (priority 1)', () => {
  const base = {
    criticalCount: 0,
    minorCount: 0,
    strictMode: false,
    prAuthorLogin: 'clud-bug[bot]',
    authorAssociation: /** @type {const} */ ('OWNER'),
  };

  it('skips on clud-bug[bot] author even with a clean review', () => {
    expect(selectReviewEvent(base)).toBe('skip');
  });

  it('skips on clud-bug[bot] author even with critical + strict (self-skip wins)', () => {
    expect(
      selectReviewEvent({ ...base, criticalCount: 1, strictMode: true }),
    ).toBe('skip');
  });

  it('skips on clud-bug[bot] author regardless of authorAssociation', () => {
    expect(
      selectReviewEvent({
        ...base,
        criticalCount: 0,
        authorAssociation: 'MEMBER',
      }),
    ).toBe('skip');
  });
});

describe('selectReviewEvent: external-contributor gate (priority 2, NEW §7.2.1)', () => {
  const externalAssociations = /** @type {const} */ ([
    'NONE',
    'FIRST_TIME_CONTRIBUTOR',
    'FIRST_TIMER',
    'MANNEQUIN',
  ]);

  // The defining §7.2.1 invariant: external contributors NEVER get
  // APPROVE on a clean review (drive-by exploit of auto-merge is the
  // closed security bug).
  for (const aa of externalAssociations) {
    it(`${aa} + clean review → COMMENT (NEVER APPROVE)`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 0,
          minorCount: 0,
          strictMode: false,
          prAuthorLogin: 'drive-by-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });

    it(`${aa} + critical + strictMode=true → COMMENT (NEVER REQUEST_CHANGES — don't block external)`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 1,
          minorCount: 0,
          strictMode: true,
          prAuthorLogin: 'drive-by-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });

    it(`${aa} + critical + strictMode=false → COMMENT`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 2,
          minorCount: 1,
          strictMode: false,
          prAuthorLogin: 'drive-by-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });

    it(`${aa} + minor-only → COMMENT`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 0,
          minorCount: 3,
          strictMode: false,
          prAuthorLogin: 'drive-by-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });
  }
});

describe('selectReviewEvent: org-trusted authors (priority 3-6)', () => {
  const trustedAssociations = /** @type {const} */ ([
    'OWNER',
    'MEMBER',
    'COLLABORATOR',
    'CONTRIBUTOR',
  ]);

  // The matrix: org-trusted × clean/critical/minor × strict on/off.
  for (const aa of trustedAssociations) {
    it(`${aa} + clean review → APPROVE`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 0,
          minorCount: 0,
          strictMode: false,
          prAuthorLogin: 'trusted-user',
          authorAssociation: aa,
        }),
      ).toBe('APPROVE');
    });

    it(`${aa} + critical + strictMode=true → REQUEST_CHANGES`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 1,
          minorCount: 0,
          strictMode: true,
          prAuthorLogin: 'trusted-user',
          authorAssociation: aa,
        }),
      ).toBe('REQUEST_CHANGES');
    });

    it(`${aa} + critical + strictMode=false → COMMENT (advisory only)`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 1,
          minorCount: 0,
          strictMode: false,
          prAuthorLogin: 'trusted-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });

    it(`${aa} + critical + strictMode=undefined → COMMENT (safe default; older manifest)`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 1,
          minorCount: 0,
          strictMode: undefined,
          prAuthorLogin: 'trusted-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });

    it(`${aa} + minor-only → COMMENT`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 0,
          minorCount: 1,
          strictMode: false,
          prAuthorLogin: 'trusted-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });

    it(`${aa} + minor-only + strictMode=true → COMMENT (strict only escalates criticals)`, () => {
      expect(
        selectReviewEvent({
          criticalCount: 0,
          minorCount: 2,
          strictMode: true,
          prAuthorLogin: 'trusted-user',
          authorAssociation: aa,
        }),
      ).toBe('COMMENT');
    });
  }
});

describe('selectReviewEvent: barrel re-export equivalence', () => {
  it('clud-bug/core re-exports selectReviewEvent (same identity)', () => {
    // Sanity check: the barrel and the module both export the same
    // function. Catches "renamed to fooReviewEvent" drift early.
    expect(barrelSelectReviewEvent).toBe(selectReviewEvent);
  });
});
