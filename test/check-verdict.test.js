// H3 — merge-gate verdict → check conclusion + the `post-check-run` verb.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveCheck,
  normalizeVerdict,
  CLUD_BUG_CHECK_NAME,
  VERDICT_CONCLUSION_TABLE,
} from '../src/core/index.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

// ZP4 — verdict-contract parity. `VERDICT_CONCLUSION_TABLE` is the single
// source of truth for the (verdict, strictMode) → conclusion mapping that ALL
// THREE `clud-bug-review` producers (this module, the notary's
// deriveNotaryCheck, the hosted webhook) must agree on. This suite pins
// `deriveCheck` — the canonical implementation — against every row; the
// clud-bug-app repo mirrors the SAME literal cases against its two producers.
describe('VERDICT_CONCLUSION_TABLE — cross-producer parity oracle', () => {
  it.each(VERDICT_CONCLUSION_TABLE)(
    'verdict=$verdict strictMode=$strictMode → conclusion=$conclusion',
    ({ verdict, strictMode, conclusion }) => {
      expect(deriveCheck({ verdict, strictMode }).conclusion).toBe(conclusion);
    },
  );
});

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
  it('unverified → neutral (a finding we could not verify; never a false-green, never a hard block)', () => {
    // SPEC 2.0 §4.7: no "clean" without CI evidence that finished — emit unverified instead
    expect(deriveCheck({ verdict: 'unverified', strictMode: true }).conclusion).toBe('neutral');
    expect(deriveCheck({ verdict: 'unverified', strictMode: false }).conclusion).toBe('neutral');
    const d = deriveCheck({ verdict: 'unverified' });
    expect(d.conclusion).not.toBe('success'); // MUST NOT read as clean
    expect(d.title).toMatch(/unverified/i);
    expect(d.summary).toMatch(/verif/i);
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
    expect(normalizeVerdict('unverified')).toBe('unverified'); // R3 (#87)
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
  // The false-green guards, exercised through the FULL CLI wiring (normalizeVerdict
  // → deriveCheck), not just the pure functions — these inputs must never post success.
  it('failed verdict → neutral (does not block)', () => {
    expect(dryRun(['--verdict', 'failed']).stdout).toMatch(/conclusion=neutral/);
  });
  it('garbage verdict → neutral (no false-green)', () => {
    expect(dryRun(['--verdict', 'garbage']).stdout).toMatch(/conclusion=neutral/);
  });
  it('critical + --no-strict → neutral (advisory)', () => {
    expect(dryRun(['--verdict', 'critical', '--no-strict']).stdout).toMatch(/conclusion=neutral/);
  });

  // Phase ZP3 — the CI-originated notarize step passes `--source ci`. The source
  // must be honored (not hard-coded), so the self-attested fallback a CI run
  // posts is tagged `ci`, not `local`. Dry-run surfaces the resolved source.
  describe('--source is honored (ZP3)', () => {
    it('defaults to ci when --source is unset', () => {
      expect(dryRun(['--verdict', 'clean']).stdout).toMatch(/source=ci\b/);
    });
    it('--source ci → source=ci', () => {
      expect(dryRun(['--verdict', 'clean', '--source', 'ci']).stdout).toMatch(/source=ci\b/);
    });
    it('--source local → source=local (adds the self-attested note)', () => {
      const out = dryRun(['--verdict', 'clean', '--source', 'local']).stdout;
      expect(out).toMatch(/source=local\b/);
    });
  });
});
