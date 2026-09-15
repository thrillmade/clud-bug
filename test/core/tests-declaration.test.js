// Tests for src/core/tests-declaration.ts — one resolver for the §6.7
// declaration, which two files can carry (clud-bug#271).
//
// SPEC §1.6's table puts `tests` in `.logmind/config.yml`; clud-bug ships it
// in `.claude/skills/.clud-bug.json` (#319/#321) because §6.7's ownership
// table allows a clud-bug-only install where the logmind file does not exist.
// Both are read; the SPEC's file wins where it says anything.

import { describe, expect, it } from 'vitest';

import {
  readTestsDeclaration,
  parseLogmindTests,
} from '../../src/core/tests-declaration.js';

describe('parseLogmindTests', () => {
  it('reads a top-level tests: scalar', () => {
    expect(parseLogmindTests('tests: npm test\n')).toBe('npm test');
    expect(parseLogmindTests('version: 1\ntests: pytest -q\nother: x\n')).toBe('pytest -q');
  });

  it('unquotes and strips a trailing comment', () => {
    expect(parseLogmindTests('tests: "npm test"\n')).toBe('npm test');
    expect(parseLogmindTests("tests: 'pytest'\n")).toBe('pytest');
    expect(parseLogmindTests('tests: npm test   # the suite\n')).toBe('npm test');
    // A `#` inside quotes is part of the command, not a comment.
    expect(parseLogmindTests('tests: "npm run test -- --grep #1"\n')).toBe('npm run test -- --grep #1');
  });

  it('reads the literal none', () => {
    expect(parseLogmindTests('tests: none\n')).toBe('none');
  });

  it('ignores a nested tests: key — only the top level declares', () => {
    expect(parseLogmindTests('git:\n  tests: npm test\n')).toBeNull();
  });

  it('ignores a commented-out declaration', () => {
    expect(parseLogmindTests('# tests: npm test\n')).toBeNull();
  });

  it('treats an empty value, an absent key and junk as unset', () => {
    expect(parseLogmindTests('tests:\n')).toBeNull();
    expect(parseLogmindTests('tests: ""\n')).toBeNull();
    expect(parseLogmindTests('other: 1\n')).toBeNull();
    expect(parseLogmindTests('')).toBeNull();
    expect(parseLogmindTests(null)).toBeNull();
  });
});

describe('readTestsDeclaration', () => {
  it('is unset when neither file says anything', () => {
    expect(readTestsDeclaration({})).toEqual({ value: null, source: 'unset' });
    expect(readTestsDeclaration({ manifest: {}, logmindConfig: '' })).toEqual({
      value: null,
      source: 'unset',
    });
  });

  it('reads the clud-bug manifest when only it declares', () => {
    expect(readTestsDeclaration({ manifest: { tests: 'npm test' } })).toEqual({
      value: 'npm test',
      source: 'clud-bug',
    });
  });

  it('reads .logmind/config.yml when only it declares', () => {
    expect(readTestsDeclaration({ logmindConfig: 'tests: pytest -q\n' })).toEqual({
      value: 'pytest -q',
      source: 'logmind',
    });
  });

  // SPEC §1.6's table names `.logmind/config.yml` as the file this setting
  // lives in, so where both speak, that one is the declaration.
  it('lets .logmind/config.yml win where both declare', () => {
    expect(
      readTestsDeclaration({
        manifest: { tests: 'npm test' },
        logmindConfig: 'tests: pytest -q\n',
      }),
    ).toEqual({ value: 'pytest -q', source: 'logmind' });
  });

  it('falls through to the manifest when the logmind file exists but declares nothing', () => {
    expect(
      readTestsDeclaration({
        manifest: { tests: 'npm test' },
        logmindConfig: 'git:\n  enforce_commits: true\n',
      }),
    ).toEqual({ value: 'npm test', source: 'clud-bug' });
  });

  it('ignores a manifest value that is not a non-empty string', () => {
    expect(readTestsDeclaration({ manifest: { tests: '' } }).source).toBe('unset');
    expect(readTestsDeclaration({ manifest: { tests: 42 } }).source).toBe('unset');
    expect(readTestsDeclaration({ manifest: null }).source).toBe('unset');
  });

  it('carries "none" through as a declaration, not as absence', () => {
    expect(readTestsDeclaration({ manifest: { tests: 'none' } })).toEqual({
      value: 'none',
      source: 'clud-bug',
    });
  });
});
