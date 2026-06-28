// Tests for src/core/auto-resolve.ts — Wave 5b D.2.6 pure rules + config.
// IO (Anthropic call + GraphQL mutations) is owned by the CLI verb in
// src/cli/main.ts; this file covers the pure logic that drives it.

import { describe, expect, it, vi } from 'vitest';

import {
  resolveAutoResolveConfig,
  readAutoResolveConfigFromCludBug,
  runAutoResolve,
  applyResolutionRules,
  renderAutoResolveMarker,
  DEFAULT_AUTO_RESOLVE_CONFIG,
} from '../../src/core/auto-resolve.js';
import {
  resolveAutoResolveConfig as barrelConfig,
  runAutoResolve as barrelRun,
} from '../../src/core/index.js';

// ---------------------------------------------------------------------------
// Barrel re-exports
// ---------------------------------------------------------------------------

describe('core barrel re-exports', () => {
  it('exposes resolveAutoResolveConfig + runAutoResolve via index.js', () => {
    expect(barrelConfig).toBe(resolveAutoResolveConfig);
    expect(barrelRun).toBe(runAutoResolve);
  });
});

// ---------------------------------------------------------------------------
// Config merge
// ---------------------------------------------------------------------------

describe('resolveAutoResolveConfig', () => {
  it('returns defaults when raw is null / undefined / non-object', () => {
    expect(resolveAutoResolveConfig(null)).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
    expect(resolveAutoResolveConfig(undefined)).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
    expect(resolveAutoResolveConfig('string-not-object')).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
    expect(resolveAutoResolveConfig(42)).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
  });

  it('returns defaults when mode is omitted', () => {
    expect(resolveAutoResolveConfig({})).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
  });

  it('accepts mode: "verified" + mode: "off"', () => {
    expect(resolveAutoResolveConfig({ mode: 'verified' }).mode).toBe('verified');
    expect(resolveAutoResolveConfig({ mode: 'off' }).mode).toBe('off');
  });

  it('falls back + warns on invalid mode', () => {
    const warns = [];
    const cfg = resolveAutoResolveConfig({ mode: 'bogus' }, (m) => warns.push(m));
    expect(cfg.mode).toBe('verified');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/autoResolve.mode/);
  });

  it('accepts uncertain_critical_action overrides', () => {
    const cfg = resolveAutoResolveConfig({
      mode: 'verified',
      uncertain_critical_action: 'leave_open',
    });
    expect(cfg.uncertain_critical_action).toBe('leave_open');
  });

  it('falls back + warns on invalid uncertain_critical_action', () => {
    const warns = [];
    const cfg = resolveAutoResolveConfig(
      { uncertain_critical_action: 'shrug' },
      (m) => warns.push(m),
    );
    expect(cfg.uncertain_critical_action).toBe('request_changes');
    expect(warns).toHaveLength(1);
  });

  it('tolerates extra fields (forward compat)', () => {
    const cfg = resolveAutoResolveConfig({
      mode: 'verified',
      futureField: 'whatever',
    });
    expect(cfg.mode).toBe('verified');
  });
});

describe('readAutoResolveConfigFromCludBug', () => {
  it('returns defaults for null/undefined config', () => {
    expect(readAutoResolveConfigFromCludBug(null)).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
    expect(readAutoResolveConfigFromCludBug(undefined)).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
  });

  it('extracts autoResolve block from a parsed .clud-bug.json', () => {
    const cfg = readAutoResolveConfigFromCludBug({ autoResolve: { mode: 'off' } });
    expect(cfg.mode).toBe('off');
  });

  it('returns defaults when autoResolve is absent', () => {
    expect(readAutoResolveConfigFromCludBug({})).toEqual(DEFAULT_AUTO_RESOLVE_CONFIG);
  });
});

// ---------------------------------------------------------------------------
// Resolution rule table
// ---------------------------------------------------------------------------

const sampleThread = (severity = 'critical') => ({
  threadId: 'PRRT_x',
  finding: {
    severity,
    body: 'NPE risk',
    skill: 'critical-issues-only',
    file: 'lib/foo.ts',
    line: 10,
  },
  codeBefore: 'old',
  codeAfter: 'new',
});

describe('applyResolutionRules', () => {
  it('ADDRESSED, critical → resolve', () => {
    const action = applyResolutionRules({
      thread: sampleThread('critical'),
      verdict: { verdict: 'ADDRESSED', source: 'model', rationale: 'null guard added' },
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
    });
    expect(action.kind).toBe('resolve');
    expect(action.markerBody).toMatch(/Auto-resolved/);
  });

  it('ADDRESSED, minor → resolve', () => {
    const action = applyResolutionRules({
      thread: sampleThread('minor'),
      verdict: { verdict: 'ADDRESSED', source: 'model', rationale: 'fixed' },
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
    });
    expect(action.kind).toBe('resolve');
  });

  it('NOT_ADDRESSED, critical → keep_open_request_changes (not escalated)', () => {
    const action = applyResolutionRules({
      thread: sampleThread('critical'),
      verdict: { verdict: 'NOT_ADDRESSED', source: 'model', rationale: 'still null' },
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
    });
    expect(action.kind).toBe('keep_open_request_changes');
    expect(action.escalated).toBe(false);
  });

  it('NOT_ADDRESSED, minor → keep_open', () => {
    const action = applyResolutionRules({
      thread: sampleThread('minor'),
      verdict: { verdict: 'NOT_ADDRESSED', source: 'model', rationale: 'still magic' },
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
    });
    expect(action.kind).toBe('keep_open');
  });

  it('UNCERTAIN, critical, request_changes → keep_open_request_changes (escalated)', () => {
    const action = applyResolutionRules({
      thread: sampleThread('critical'),
      verdict: { verdict: 'UNCERTAIN', source: 'model', rationale: 'context narrow' },
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
    });
    expect(action.kind).toBe('keep_open_request_changes');
    expect(action.escalated).toBe(true);
  });

  it('UNCERTAIN, critical, leave_open → keep_open (no escalation)', () => {
    const action = applyResolutionRules({
      thread: sampleThread('critical'),
      verdict: { verdict: 'UNCERTAIN', source: 'model', rationale: 'narrow' },
      config: { ...DEFAULT_AUTO_RESOLVE_CONFIG, uncertain_critical_action: 'leave_open' },
    });
    expect(action.kind).toBe('keep_open');
  });

  it('UNCERTAIN, minor → keep_open', () => {
    const action = applyResolutionRules({
      thread: sampleThread('minor'),
      verdict: { verdict: 'UNCERTAIN', source: 'model', rationale: 'narrow' },
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
    });
    expect(action.kind).toBe('keep_open');
  });
});

// ---------------------------------------------------------------------------
// Marker rendering
// ---------------------------------------------------------------------------

describe('renderAutoResolveMarker', () => {
  it('verified-addressed includes the rationale', () => {
    const s = renderAutoResolveMarker({
      kind: 'verified-addressed',
      rationale: 'null guard added',
    });
    expect(s).toMatch(/Auto-resolved \(verified/);
    expect(s).toMatch(/null guard added/);
  });

  it('verified-uncertain on critical escalates wording', () => {
    const s = renderAutoResolveMarker({
      kind: 'verified-uncertain',
      rationale: 'narrow',
      severity: 'critical',
    });
    expect(s).toMatch(/escalated/);
  });

  it('verified-uncertain on minor does not escalate', () => {
    const s = renderAutoResolveMarker({
      kind: 'verified-uncertain',
      rationale: 'narrow',
      severity: 'minor',
    });
    expect(s).toMatch(/human review recommended/);
    expect(s).not.toMatch(/escalated/);
  });

  it('omits trailing colon when rationale is absent', () => {
    const s = renderAutoResolveMarker({ kind: 'verified-addressed' });
    expect(s.endsWith('.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runAutoResolve — pure orchestration
// ---------------------------------------------------------------------------

describe('runAutoResolve', () => {
  it('returns skipped:off actions when config.mode === "off"', async () => {
    const verifier = vi.fn();
    const r = await runAutoResolve({
      priorThreads: [sampleThread('critical'), sampleThread('minor')],
      config: { ...DEFAULT_AUTO_RESOLVE_CONFIG, mode: 'off' },
      verifier,
    });
    expect(verifier).not.toHaveBeenCalled();
    expect(r.actions).toHaveLength(2);
    expect(r.actions[0].kind).toBe('skipped');
    expect(r.verifierCallCount).toBe(0);
    expect(r.shouldRequestChanges).toBe(false);
  });

  it('returns empty actions for empty thread list', async () => {
    const verifier = vi.fn();
    const r = await runAutoResolve({
      priorThreads: [],
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
      verifier,
    });
    expect(verifier).not.toHaveBeenCalled();
    expect(r.actions).toEqual([]);
    expect(r.verifierCallCount).toBe(0);
  });

  it('calls verifier once per thread + applies rules', async () => {
    const verifier = vi
      .fn()
      .mockResolvedValueOnce({ verdict: 'ADDRESSED', source: 'model', rationale: 'fixed' })
      .mockResolvedValueOnce({ verdict: 'NOT_ADDRESSED', source: 'model', rationale: 'still' });
    const r = await runAutoResolve({
      priorThreads: [sampleThread('critical'), sampleThread('minor')],
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
      verifier,
    });
    expect(verifier).toHaveBeenCalledTimes(2);
    expect(r.verifierCallCount).toBe(2);
    expect(r.actions[0].kind).toBe('resolve');
    expect(r.actions[1].kind).toBe('keep_open');
  });

  it('sets shouldRequestChanges when any action is keep_open_request_changes', async () => {
    const verifier = vi
      .fn()
      .mockResolvedValueOnce({ verdict: 'ADDRESSED', source: 'model', rationale: 'fixed' })
      .mockResolvedValueOnce({ verdict: 'NOT_ADDRESSED', source: 'model', rationale: 'still' });
    const r = await runAutoResolve({
      priorThreads: [sampleThread('minor'), sampleThread('critical')],
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
      verifier,
    });
    expect(r.shouldRequestChanges).toBe(true);
  });

  it('passes diffAtAnchor through to the verifier when present', async () => {
    const verifier = vi
      .fn()
      .mockResolvedValue({ verdict: 'ADDRESSED', source: 'model', rationale: 'fixed' });
    const thread = { ...sampleThread('critical'), diffAtAnchor: '@@ -1,1 +1,2 @@' };
    await runAutoResolve({
      priorThreads: [thread],
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
      verifier,
    });
    expect(verifier).toHaveBeenCalledWith(
      expect.objectContaining({ diffAtAnchor: '@@ -1,1 +1,2 @@' }),
    );
  });

  it('omits diffAtAnchor key from the verifier call when not provided (exactOptionalPropertyTypes)', async () => {
    const verifier = vi
      .fn()
      .mockResolvedValue({ verdict: 'ADDRESSED', source: 'model', rationale: 'fixed' });
    await runAutoResolve({
      priorThreads: [sampleThread('critical')],
      config: DEFAULT_AUTO_RESOLVE_CONFIG,
      verifier,
    });
    const callArg = verifier.mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty('diffAtAnchor');
  });
});
