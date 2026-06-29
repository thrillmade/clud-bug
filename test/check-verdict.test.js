// H3 — merge-gate verdict → check conclusion + the `post-check-run` verb.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveCheck, normalizeVerdict, CLUD_BUG_CHECK_NAME } from '../src/core/index.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

describe('deriveCheck', () => {
  it('clean → success regardless of strict mode', () => {
    expect(deriveCheck({ verdict: 'clean', strictMode: true }).conclusion).toBe('success');
    expect(deriveCheck({ verdict: 'clean', strictMode: false }).conclusion).toBe('success');
  });
  it('critical + strict → failure (blocks)', () => {
    const d = deriveCheck({ verdict: 'critical', strictMode: true, criticalCount: 2 });
    expect(d.conclusion).toBe('failure');
    expect(d.title).toMatch(/2 critical \(blocking\)/);
  });
  it('critical + non-strict → neutral (advisory, does not block)', () => {
    expect(deriveCheck({ verdict: 'critical', strictMode: false }).conclusion).toBe('neutral');
  });
  it('failed → neutral (never block on our own inability to run)', () => {
    expect(deriveCheck({ verdict: 'failed', strictMode: true }).conclusion).toBe('neutral');
  });
  it('local source appends a self-attested trust note; ci does not', () => {
    expect(deriveCheck({ verdict: 'clean', source: 'local' }).summary).toMatch(/self-attested/i);
    expect(deriveCheck({ verdict: 'clean', source: 'ci' }).summary).not.toMatch(/self-attested/i);
  });
});

describe('normalizeVerdict', () => {
  it('passes known verdicts through and maps unknown → failed (never a false-green)', () => {
    expect(normalizeVerdict('clean')).toBe('clean');
    expect(normalizeVerdict('critical')).toBe('critical');
    expect(normalizeVerdict('failed')).toBe('failed');
    expect(normalizeVerdict('garbage')).toBe('failed');
    expect(normalizeVerdict(undefined)).toBe('failed');
  });
});

describe('check name', () => {
  it('is the hard-coded clud-bug-review (consumer rulesets depend on it)', () => {
    expect(CLUD_BUG_CHECK_NAME).toBe('clud-bug-review');
  });
});

describe('post-check-run --dry-run', () => {
  function dryRun(extra) {
    return spawnSync(
      process.execPath,
      [CLI, 'post-check-run', '--sha', 'abc123', '--owner', 'o', '--repo', 'r', '--dry-run', ...extra],
      { encoding: 'utf8' },
    );
  }
  it('derives + prints the conclusion without posting', () => {
    const r = dryRun(['--verdict', 'critical', '--critical-count', '3', '--strict', '--source', 'local']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/conclusion=failure/);
    expect(r.stdout).toMatch(/dry-run/);
  });
  it('clean → success in dry-run', () => {
    expect(dryRun(['--verdict', 'clean']).stdout).toMatch(/conclusion=success/);
  });
});
