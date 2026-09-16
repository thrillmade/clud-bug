// clud-bug#256 ruling 4 — the CLI/Action wiring half of the meta contract:
// `clud-bug render` builds `renderReview`'s OPTIONAL meta from the flags the
// caller actually knows at render time (PR number, head sha, posting
// identity). `verdict`/`independence` are deliberately never passed here —
// the gate that computes the verdict runs AFTER this step posts the
// comment (see the #256 PR description for the sequencing follow-up).

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderMetaFromArgs } from '../src/cli/main.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input });
}

const MIN_PAYLOAD = JSON.stringify({
  status_header: 'clean',
  summary_counts: { critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0 },
  per_skill_scan: [],
  critical_findings: [],
  minor_findings: [],
  preexisting_findings: [],
  skills_referenced: [],
  last_reviewed_sha: 'abc1234',
});

describe('renderMetaFromArgs (pure)', () => {
  it('returns undefined when --pr is absent (preserves the pre-#256 header)', () => {
    expect(renderMetaFromArgs({})).toBeUndefined();
    expect(renderMetaFromArgs({ sha: 'x', writtenBy: 'y' })).toBeUndefined();
  });

  it('returns undefined when --pr does not parse to a finite number', () => {
    expect(renderMetaFromArgs({ pr: NaN })).toBeUndefined();
  });

  it('builds meta with only the fields the caller supplied — never invents verdict/independence', () => {
    const meta = renderMetaFromArgs({ pr: 256, sha: 'a'.repeat(40), writtenBy: 'github-actions[bot]' });
    expect(meta).toEqual({
      prNumber: 256,
      reviewSha: 'a'.repeat(40),
      writtenBy: 'github-actions[bot]',
    });
    expect(meta.verdict).toBeUndefined();
    expect(meta.independence).toBeUndefined();
  });

  it('omits sha/writtenBy when not passed, keeping only prNumber', () => {
    expect(renderMetaFromArgs({ pr: 1 })).toEqual({ prNumber: 1 });
  });
});

describe('clud-bug render --stdin (CLI, end-to-end)', () => {
  it('no --pr → unchanged H2 header (byte-identical to pre-#256 render)', () => {
    const r = run(['render', '--stdin'], MIN_PAYLOAD);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^## 🐛 Clud Bug review — clean/);
    expect(r.stdout).not.toMatch(/clud-bug review — PR #/);
  });

  it('--pr + --sha + --written-by → SPEC §4.3 header, verdict/independence absent', () => {
    const r = run(
      ['render', '--stdin', '--pr', '256', '--sha', 'b'.repeat(40), '--written-by', 'github-actions[bot]'],
      MIN_PAYLOAD,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^# clud-bug review — PR #256\n/);
    expect(r.stdout).toMatch(/<!-- written-by: github-actions\[bot\] -->/);
    expect(r.stdout).toMatch(new RegExp(`<!-- review-sha: ${'b'.repeat(40)} -->`));
    expect(r.stdout).not.toMatch(/<!-- verdict:/);
    expect(r.stdout).not.toMatch(/<!-- independence:/);
  });
});
