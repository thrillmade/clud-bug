// Tests for src/core/resolve-verifier.ts — Wave 5b verifier prompt
// builder + response parser. The actual Anthropic Messages API call
// lives in the CLI verb; this file covers the pure parts.

import { describe, expect, it } from 'vitest';

import {
  VERIFIER_SYSTEM,
  buildVerifierPrompt,
  parseVerifierResponse,
} from '../../src/core/resolve-verifier.js';

// ---------------------------------------------------------------------------
// System prompt shape
// ---------------------------------------------------------------------------

describe('VERIFIER_SYSTEM', () => {
  it('declares the three-verdict enum (anti-injection)', () => {
    expect(VERIFIER_SYSTEM).toMatch(/ADDRESSED/);
    expect(VERIFIER_SYSTEM).toMatch(/NOT_ADDRESSED/);
    expect(VERIFIER_SYSTEM).toMatch(/UNCERTAIN/);
  });

  it('asks for a JSON object on one line, no markdown fence', () => {
    expect(VERIFIER_SYSTEM).toMatch(/JSON object/);
    expect(VERIFIER_SYSTEM).toMatch(/no markdown fence/);
  });

  it('caps rationale at 500 characters', () => {
    expect(VERIFIER_SYSTEM).toMatch(/500 characters/);
  });
});

// ---------------------------------------------------------------------------
// Prompt builder — pure shape stability
// ---------------------------------------------------------------------------

const sampleInput = {
  finding: {
    severity: 'critical',
    body: 'NPE risk on null user',
    skill: 'critical-issues-only',
    file: 'lib/utils.ts',
    line: 15,
  },
  codeBefore: 'function describeUser(user) { return user.name; }',
  codeAfter:
    'function describeUser(user) { if (!user) return ""; return user.name; }',
  diffAtAnchor: '@@ -15,1 +15,2 @@\n+ null guard',
};

describe('buildVerifierPrompt', () => {
  it('mentions the skill + severity + anchor', () => {
    const out = buildVerifierPrompt(sampleInput);
    expect(out).toMatch(/critical-issues-only/);
    expect(out).toMatch(/🔴 critical/);
    expect(out).toMatch(/lib\/utils\.ts:15/);
  });

  it('wraps BEFORE + AFTER + DIFF in labeled fenced blocks (anti-injection)', () => {
    const out = buildVerifierPrompt(sampleInput);
    expect(out).toMatch(/PRIOR FINDING:/);
    expect(out).toMatch(/BEFORE:/);
    expect(out).toMatch(/AFTER:/);
    expect(out).toMatch(/DIFF AT ANCHOR:/);
  });

  it('renders 🟡 minor for minor severity', () => {
    const out = buildVerifierPrompt({
      ...sampleInput,
      finding: { ...sampleInput.finding, severity: 'minor' },
    });
    expect(out).toMatch(/🟡 minor/);
    expect(out).not.toMatch(/🔴 critical/);
  });

  it('falls back to file (no :line) when finding.line is missing', () => {
    const out = buildVerifierPrompt({
      ...sampleInput,
      finding: { ...sampleInput.finding, line: undefined },
    });
    expect(out).toMatch(/`lib\/utils\.ts`/);
    expect(out).not.toMatch(/utils\.ts:15/);
  });

  it('emits empty-marker placeholder when codeBefore/codeAfter is empty', () => {
    const out = buildVerifierPrompt({
      ...sampleInput,
      codeBefore: '',
      codeAfter: '',
    });
    expect(out).toMatch(/\(empty — file did not exist or was empty\)/);
    expect(out).toMatch(/\(empty — file was deleted or emptied\)/);
  });

  it('omits the DIFF AT ANCHOR block when diffAtAnchor is undefined', () => {
    const { diffAtAnchor, ...rest } = sampleInput;
    const out = buildVerifierPrompt(rest);
    expect(out).not.toMatch(/DIFF AT ANCHOR:/);
  });

  it('is pure (same input → same output)', () => {
    expect(buildVerifierPrompt(sampleInput)).toBe(buildVerifierPrompt(sampleInput));
  });
});

// ---------------------------------------------------------------------------
// Response parser — fail-closed on every malformed path
// ---------------------------------------------------------------------------

describe('parseVerifierResponse', () => {
  it('parses a valid one-line JSON response', () => {
    const o = parseVerifierResponse(
      '{"verdict":"ADDRESSED","rationale":"null guard added"}',
    );
    expect(o.verdict).toBe('ADDRESSED');
    expect(o.source).toBe('model');
    expect(o.rationale).toBe('null guard added');
  });

  it('accepts each valid verdict value', () => {
    expect(parseVerifierResponse('{"verdict":"ADDRESSED","rationale":"x"}').verdict).toBe('ADDRESSED');
    expect(parseVerifierResponse('{"verdict":"NOT_ADDRESSED","rationale":"x"}').verdict).toBe('NOT_ADDRESSED');
    expect(parseVerifierResponse('{"verdict":"UNCERTAIN","rationale":"x"}').verdict).toBe('UNCERTAIN');
  });

  it('strips ```json fence + parses', () => {
    const o = parseVerifierResponse(
      '```json\n{"verdict":"ADDRESSED","rationale":"fixed"}\n```',
    );
    expect(o.verdict).toBe('ADDRESSED');
    expect(o.source).toBe('model');
  });

  it('strips bare ``` fence', () => {
    const o = parseVerifierResponse('```\n{"verdict":"UNCERTAIN","rationale":"narrow"}\n```');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('model');
  });

  it('tolerates leading/trailing whitespace', () => {
    const o = parseVerifierResponse(
      '   {"verdict":"ADDRESSED","rationale":"fixed"}\n\n   ',
    );
    expect(o.verdict).toBe('ADDRESSED');
  });

  it('tolerates extra fields (forward compat)', () => {
    const o = parseVerifierResponse(
      '{"verdict":"ADDRESSED","rationale":"fixed","unexpectedField":42}',
    );
    expect(o.verdict).toBe('ADDRESSED');
    expect(o.source).toBe('model');
  });

  it('routes empty input → UNCERTAIN+api-error (fail-closed)', () => {
    const o = parseVerifierResponse('');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('api-error');
    expect(o.rationale).toMatch(/empty/);
  });

  it('routes non-string input → UNCERTAIN+api-error', () => {
    expect(parseVerifierResponse(null).verdict).toBe('UNCERTAIN');
    expect(parseVerifierResponse(undefined).verdict).toBe('UNCERTAIN');
    expect(parseVerifierResponse(42).verdict).toBe('UNCERTAIN');
    expect(parseVerifierResponse({}).source).toBe('api-error');
  });

  it('routes malformed JSON → UNCERTAIN+api-error', () => {
    const o = parseVerifierResponse('not valid json {{{');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('api-error');
    expect(o.rationale).toMatch(/JSON/);
  });

  it('routes JSON array (not object) → UNCERTAIN+api-error', () => {
    const o = parseVerifierResponse('["ADDRESSED"]');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('api-error');
  });

  it('routes unknown verdict value → UNCERTAIN+api-error', () => {
    const o = parseVerifierResponse('{"verdict":"BLEH","rationale":"x"}');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('api-error');
    expect(o.rationale).toMatch(/unknown verdict/);
  });

  it('routes missing rationale → UNCERTAIN+api-error', () => {
    const o = parseVerifierResponse('{"verdict":"ADDRESSED"}');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('api-error');
    expect(o.rationale).toMatch(/missing rationale/);
  });

  it('routes empty rationale → UNCERTAIN+api-error', () => {
    const o = parseVerifierResponse('{"verdict":"ADDRESSED","rationale":"   "}');
    expect(o.verdict).toBe('UNCERTAIN');
    expect(o.source).toBe('api-error');
  });

  it('caps rationale at 500 chars', () => {
    const long = 'x'.repeat(700);
    const o = parseVerifierResponse(`{"verdict":"ADDRESSED","rationale":"${long}"}`);
    expect(o.rationale.length).toBe(500);
    expect(o.source).toBe('model');
  });
});
