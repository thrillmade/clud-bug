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
