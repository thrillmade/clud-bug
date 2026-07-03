// Tests for src/core/invariants.ts — the executable-probe invariants config + run-gate.
// Phase R (clud-bug-app #87): an invariant is a repo-declared behavioral property with an
// executable PROBE (a command that exits non-zero = RED when the property is violated).

import { describe, expect, it } from 'vitest';

import {
  readInvariantsConfig,
  shouldRunProbes,
  BUILTIN_INVARIANTS_CONFIG,
} from '../../src/core/invariants.js';

describe('readInvariantsConfig', () => {
  it('defaults to off when no invariants block is present', () => {
    expect(readInvariantsConfig({})).toEqual(BUILTIN_INVARIANTS_CONFIG);
    expect(readInvariantsConfig({}).enabled).toBe(false);
    expect(readInvariantsConfig(null)).toEqual(BUILTIN_INVARIANTS_CONFIG);
    expect(readInvariantsConfig(undefined)).toEqual(BUILTIN_INVARIANTS_CONFIG);
  });

  it('a malformed invariants block resolves to off (a typo can never enable a cost-bearing probe)', () => {
    expect(readInvariantsConfig({ invariants: 'yes' }).enabled).toBe(false);
    expect(readInvariantsConfig({ invariants: 42 }).enabled).toBe(false);
    expect(readInvariantsConfig({ invariants: 'yes' }).invariants).toEqual([]);
  });

  it('reads a bare array of valid invariants and enables when at least one is valid', () => {
    const cfg = readInvariantsConfig({
      invariants: [
        { name: 'byte-parity', appliesTo: ['docs/**'], probe: 'npm run render:check', expect: 'no diff vs golden' },
      ],
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.invariants).toEqual([
      { name: 'byte-parity', appliesTo: ['docs/**'], probe: 'npm run render:check', expect: 'no diff vs golden' },
    ]);
  });

  it('coerces a single-string appliesTo to an array and omits an absent expect', () => {
    const cfg = readInvariantsConfig({
      invariants: [{ name: 'no-token-push', appliesTo: '.github/**', probe: 'grep -rq X' }],
    });
    expect(cfg.invariants).toHaveLength(1);
    expect(cfg.invariants[0].appliesTo).toEqual(['.github/**']);
    expect(cfg.invariants[0].expect).toBeUndefined();
  });

  it('drops malformed entries (missing name, probe, or appliesTo) but keeps valid ones', () => {
    const cfg = readInvariantsConfig({
      invariants: [
        { name: 'ok', appliesTo: ['a/**'], probe: 'run-a' },
        { appliesTo: ['b/**'], probe: 'run-b' }, // no name → drop
        { name: 'no-probe', appliesTo: ['c/**'] }, // no probe → drop
        { name: 'no-globs', probe: 'run-d' }, // no appliesTo → drop
        'garbage', // not an object → drop
      ],
    });
    expect(cfg.invariants.map((i) => i.name)).toEqual(['ok']);
    expect(cfg.enabled).toBe(true);
  });

  it('an array with zero VALID invariants is disabled', () => {
    const cfg = readInvariantsConfig({ invariants: [{ probe: 'x' }, 'garbage'] });
    expect(cfg.enabled).toBe(false);
    expect(cfg.invariants).toEqual([]);
  });

  it('supports a wrapper form { enabled, list } as a kill-switch that retains the invariants', () => {
    const off = readInvariantsConfig({
      invariants: { enabled: false, list: [{ name: 'x', appliesTo: ['a/**'], probe: 'run-x' }] },
    });
    expect(off.enabled).toBe(false); // explicitly disabled...
    expect(off.invariants).toHaveLength(1); // ...but the config is retained

    const on = readInvariantsConfig({
      invariants: { enabled: true, list: [{ name: 'x', appliesTo: ['a/**'], probe: 'run-x' }] },
    });
    expect(on.enabled).toBe(true);
  });
});

describe('shouldRunProbes', () => {
  const on = { enabled: true, invariants: [{ name: 'x', appliesTo: ['a/**'], probe: 'run-x' }] };

  it('runs only when enabled + at least one invariant applies + pr trigger', () => {
    expect(shouldRunProbes(on, 1, 'pr')).toBe(true);
  });

  it('does NOT run when disabled', () => {
    expect(shouldRunProbes(BUILTIN_INVARIANTS_CONFIG, 1, 'pr')).toBe(false);
  });

  it('does NOT run when no invariant applies to the changed paths', () => {
    expect(shouldRunProbes(on, 0, 'pr')).toBe(false);
  });

  it('does NOT run on commit or push triggers (build+run is too expensive)', () => {
    expect(shouldRunProbes(on, 1, 'commit')).toBe(false);
    expect(shouldRunProbes(on, 1, 'push')).toBe(false);
  });
});
