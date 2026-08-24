// Tests for src/core/ci-checks.ts — the CI-evidence config + in-scope gate
// (SPEC 2.0 §4.7), replacing test/core/invariants.test.js (deleted alongside
// the executable-probe surface it covered — clud-bug#264 / clud-bug#260).

import { describe, expect, it } from 'vitest';

import {
  readCiChecksConfig,
  shouldReadCiChecks,
  BUILTIN_CI_CHECKS_CONFIG,
} from '../../src/core/ci-checks.js';

describe('readCiChecksConfig', () => {
  it('defaults to on, unnarrowed when no ciChecks key is present', () => {
    expect(readCiChecksConfig({})).toEqual(BUILTIN_CI_CHECKS_CONFIG);
    expect(readCiChecksConfig({}).enabled).toBe(true);
    expect(readCiChecksConfig({}).names).toBeNull();
    expect(readCiChecksConfig(null)).toEqual(BUILTIN_CI_CHECKS_CONFIG);
    expect(readCiChecksConfig(undefined)).toEqual(BUILTIN_CI_CHECKS_CONFIG);
  });

  it('a malformed (non-array) ciChecks value falls back to on, unnarrowed', () => {
    expect(readCiChecksConfig({ ciChecks: 'build' })).toEqual(BUILTIN_CI_CHECKS_CONFIG);
    expect(readCiChecksConfig({ ciChecks: 42 })).toEqual(BUILTIN_CI_CHECKS_CONFIG);
    expect(readCiChecksConfig({ ciChecks: { build: true } })).toEqual(BUILTIN_CI_CHECKS_CONFIG);
  });

  it('an explicit empty array is the deliberate full opt-out (SPEC §4.7)', () => {
    const cfg = readCiChecksConfig({ ciChecks: [] });
    expect(cfg.enabled).toBe(false);
    expect(cfg.names).toEqual([]);
  });

  it('a non-empty array of names narrows to exactly those checks', () => {
    const cfg = readCiChecksConfig({ ciChecks: ['build', 'test'] });
    expect(cfg.enabled).toBe(true);
    expect(cfg.names).toEqual(['build', 'test']);
  });

  it('drops non-string entries but keeps valid names', () => {
    const cfg = readCiChecksConfig({ ciChecks: ['build', 42, null, 'test', ''] });
    expect(cfg.names).toEqual(['build', 'test']);
  });

  it('a non-empty array whose entries are ALL malformed falls back to on, unnarrowed (a typo must not silently disable evidence-reading)', () => {
    const cfg = readCiChecksConfig({ ciChecks: [42, null, ''] });
    expect(cfg).toEqual(BUILTIN_CI_CHECKS_CONFIG);
    expect(cfg.enabled).toBe(true);
    expect(cfg.names).toBeNull();
  });
});

describe('shouldReadCiChecks', () => {
  it('reads on a pr trigger when enabled', () => {
    expect(shouldReadCiChecks(BUILTIN_CI_CHECKS_CONFIG, 'pr')).toBe(true);
  });

  it('does NOT read when the repo explicitly disabled it', () => {
    expect(shouldReadCiChecks({ enabled: false, names: [] }, 'pr')).toBe(false);
  });

  it('does NOT read on commit or push triggers (no CI has run yet)', () => {
    expect(shouldReadCiChecks(BUILTIN_CI_CHECKS_CONFIG, 'commit')).toBe(false);
    expect(shouldReadCiChecks(BUILTIN_CI_CHECKS_CONFIG, 'push')).toBe(false);
  });

  it('still respects narrowing while enabled on a pr trigger', () => {
    expect(shouldReadCiChecks({ enabled: true, names: ['build'] }, 'pr')).toBe(true);
  });
});
