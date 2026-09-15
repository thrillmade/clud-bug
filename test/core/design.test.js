// Tests for src/core/design.ts — the design-critic config + run-gate.

import { describe, expect, it } from 'vitest';

import {
  readDesignConfig,
  shouldRunDesign,
  BUILTIN_DESIGN_CONFIG,
} from '../../src/core/design.js';

describe('readDesignConfig', () => {
  it('defaults to off when no design block is present', () => {
    expect(readDesignConfig({})).toEqual(BUILTIN_DESIGN_CONFIG);
    expect(readDesignConfig({}).enabled).toBe(false);
    expect(readDesignConfig(null)).toEqual(BUILTIN_DESIGN_CONFIG);
    expect(readDesignConfig(undefined)).toEqual(BUILTIN_DESIGN_CONFIG);
  });

  it('a malformed design block resolves to off (a typo can never enable it)', () => {
    expect(readDesignConfig({ design: 'yes' }).enabled).toBe(false);
    expect(readDesignConfig({ design: 42 }).enabled).toBe(false);
    // enabled must be the literal boolean true — truthy strings do not count
    expect(readDesignConfig({ design: { enabled: 'true' } }).enabled).toBe(false);
    expect(readDesignConfig({ design: { enabled: 1 } }).enabled).toBe(false);
  });

  it('reads enabled + gate + themes + viewports', () => {
    const cfg = readDesignConfig({
      design: {
        enabled: true,
        gate: 'strict',
        themes: ['dark'],
        viewports: ['mobile', 'desktop'],
      },
    });
    expect(cfg).toEqual({
      enabled: true,
      gate: 'strict',
      themes: ['dark'],
      viewports: ['mobile', 'desktop'],
    });
  });

  it('defaults gate to advisory + themes/viewports to the builtin when omitted or empty', () => {
    const cfg = readDesignConfig({ design: { enabled: true, themes: [] } });
    expect(cfg.gate).toBe('advisory');
    expect(cfg.themes).toEqual(['light', 'dark']);
    expect(cfg.viewports).toEqual(['desktop']);
  });

  it('an unknown gate falls back to advisory', () => {
    expect(readDesignConfig({ design: { enabled: true, gate: 'block' } }).gate).toBe(
      'advisory',
    );
  });
});

describe('shouldRunDesign', () => {
  const on = { ...BUILTIN_DESIGN_CONFIG, enabled: true };

  it('runs only when enabled + has design skills + pr trigger', () => {
    expect(shouldRunDesign(on, 1, 'pr')).toBe(true);
  });

  it('does NOT run when disabled', () => {
    expect(shouldRunDesign(BUILTIN_DESIGN_CONFIG, 1, 'pr')).toBe(false);
  });

  it('does NOT run with zero design skills', () => {
    expect(shouldRunDesign(on, 0, 'pr')).toBe(false);
  });

  it('does NOT run on commit or push triggers (too expensive)', () => {
    expect(shouldRunDesign(on, 1, 'commit')).toBe(false);
    expect(shouldRunDesign(on, 1, 'push')).toBe(false);
  });
});

// #271 / SPEC §6.3 — "Anything that decides whether a change may merge … MUST
// be read from the pull request's base ref. Never from the head ref."
// `design.gate` is such a setting (§4.8: "because it changes whether something
// blocks, it is a person's to set, never an agent's"), so a consumer that HAS
// the base-ref manifest passes it and the head copy stops being able to say.
describe('readDesignConfig with a base-ref manifest', () => {
  it('takes gate from the base ref, never from the manifest in the tree', () => {
    const head = { design: { enabled: true, gate: 'strict' } };
    const base = { design: { enabled: true, gate: 'advisory' } };
    expect(readDesignConfig(head, { baseRefManifest: base }).gate).toBe('advisory');
  });

  it('a head-only strict gate is not honoured — the base ref is silent, so advisory', () => {
    const head = { design: { enabled: true, gate: 'strict' } };
    expect(readDesignConfig(head, { baseRefManifest: {} }).gate).toBe('advisory');
    expect(readDesignConfig(head, { baseRefManifest: null }).gate).toBe('advisory');
  });

  it('honours a base-ref strict gate even when the tree copy says advisory', () => {
    const head = { design: { enabled: true, gate: 'advisory' } };
    const base = { design: { gate: 'strict' } };
    expect(readDesignConfig(head, { baseRefManifest: base }).gate).toBe('strict');
  });

  // Only the blocking field changes source. What renders, and whether the
  // pass runs at all, is a cost decision the working tree still owns.
  it('leaves enabled / themes / viewports reading from the manifest given', () => {
    const head = { design: { enabled: true, themes: ['dark'], viewports: ['mobile'] } };
    const cfg = readDesignConfig(head, { baseRefManifest: { design: { enabled: false } } });
    expect(cfg.enabled).toBe(true);
    expect(cfg.themes).toEqual(['dark']);
    expect(cfg.viewports).toEqual(['mobile']);
  });

  it('with no base-ref manifest supplied, resolves exactly as before', () => {
    const head = { design: { enabled: true, gate: 'strict' } };
    expect(readDesignConfig(head).gate).toBe('strict');
    expect(readDesignConfig(head, {}).gate).toBe('strict');
  });

  // #271 ruling 3 — the trust-boundary hole: once the base ref has gone
  // strict, `enabled` MUST read from that same trusted source, or a head-ref
  // edit can starve the strict gate of anything to find and defeat it just as
  // effectively as flipping the gate itself would.
  it('a strict base-ref gate wins over a head-ref enabled:false — the pass still runs', () => {
    const head = { design: { enabled: false } };
    const base = { design: { gate: 'strict', enabled: true } };
    const cfg = readDesignConfig(head, { baseRefManifest: base });
    expect(cfg.gate).toBe('strict');
    expect(cfg.enabled).toBe(true);
    expect(shouldRunDesign(cfg, 1, 'pr')).toBe(true);
  });
});
