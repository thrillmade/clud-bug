// Tests for src/core/notary-config.ts — the default-on notary config resolver
// (Phase ZP2). Covers all three precedence branches: repo opt-out, env
// override, and the default-on hosted origin, plus trailing-slash
// normalization.

import { describe, expect, it, afterEach } from 'vitest';

import { readNotaryConfig, DEFAULT_NOTARY_URL } from '../../src/core/notary-config.js';

const ENV_KEY = 'CLUD_BUG_NOTARY_URL';

describe('readNotaryConfig', () => {
  const originalEnv = process.env[ENV_KEY];

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it('defaults to the hosted notary origin when no opt-out and no env override', () => {
    delete process.env[ENV_KEY];
    expect(readNotaryConfig({})).toBe(DEFAULT_NOTARY_URL);
    expect(readNotaryConfig(null)).toBe(DEFAULT_NOTARY_URL);
    expect(readNotaryConfig(undefined)).toBe(DEFAULT_NOTARY_URL);
    expect(DEFAULT_NOTARY_URL).toBe('https://app.cludbug.dev');
  });

  it('`notary: false` in the manifest opts out → null (self-attest), even with an env override set', () => {
    delete process.env[ENV_KEY];
    expect(readNotaryConfig({ notary: false })).toBeNull();

    // The hard repo opt-out wins over everything, including a stray env var —
    // a maintainer-committed "no notary" should never be silently re-enabled.
    process.env[ENV_KEY] = 'https://staging.example.com';
    expect(readNotaryConfig({ notary: false })).toBeNull();
  });

  it('a non-empty CLUD_BUG_NOTARY_URL overrides the default when the repo has not opted out', () => {
    process.env[ENV_KEY] = 'https://staging.example.com';
    expect(readNotaryConfig({})).toBe('https://staging.example.com');
    expect(readNotaryConfig(null)).toBe('https://staging.example.com');
  });

  it('trims whitespace around the env override', () => {
    process.env[ENV_KEY] = '  https://staging.example.com  ';
    expect(readNotaryConfig({})).toBe('https://staging.example.com');
  });

  it('an empty/whitespace-only env override is treated as unset (falls through to the default)', () => {
    process.env[ENV_KEY] = '   ';
    expect(readNotaryConfig({})).toBe(DEFAULT_NOTARY_URL);
    process.env[ENV_KEY] = '';
    expect(readNotaryConfig({})).toBe(DEFAULT_NOTARY_URL);
  });

  it('strips a single trailing slash from the resolved URL (env override)', () => {
    process.env[ENV_KEY] = 'https://staging.example.com/';
    expect(readNotaryConfig({})).toBe('https://staging.example.com');
  });

  it('a degenerate all-slash env override ("/", "///") is not a usable origin → default, never a silent opt-out', () => {
    // Regression (adversarial review): stripTrailingSlash('/') === '', and an
    // empty string must NOT be mistaken for the `notary:false` opt-out (only the
    // manifest opts out). A non-empty-but-degenerate env value the operator
    // never intended as "off" falls through to the default-ON hosted notary.
    process.env[ENV_KEY] = '/';
    expect(readNotaryConfig({})).toBe(DEFAULT_NOTARY_URL);
    process.env[ENV_KEY] = '///';
    expect(readNotaryConfig({})).toBe(DEFAULT_NOTARY_URL);
  });

  it('a truthy-but-non-false `notary` value (e.g. `true`, missing) does not opt out', () => {
    delete process.env[ENV_KEY];
    expect(readNotaryConfig({ notary: true })).toBe(DEFAULT_NOTARY_URL);
    expect(readNotaryConfig({ notary: undefined })).toBe(DEFAULT_NOTARY_URL);
    // Only the literal boolean `false` opts out — a falsy-but-not-`false`
    // value (0, '', null) must not silently disable the default-on notary.
    expect(readNotaryConfig({ notary: 0 })).toBe(DEFAULT_NOTARY_URL);
    expect(readNotaryConfig({ notary: null })).toBe(DEFAULT_NOTARY_URL);
  });
});
