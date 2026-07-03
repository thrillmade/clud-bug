// SPEC §3.23.1 — configure-github idempotency status-payload conformance.
// The pure output formatter must surface `alreadyCanonical` + `rulesetVersion`
// as named fields (JSON for machines, key-colon-value for humans).

import { describe, expect, it } from 'vitest';

import { formatConfigureSummary } from '../src/cli/configure-github.js';

describe('formatConfigureSummary — §3.23.1 status payload', () => {
  it('no-op human output surfaces alreadyCanonical: true + rulesetVersion: v1', () => {
    const s = formatConfigureSummary(
      { owner: 'thrillmade', repo: 'protocol', alreadyCanonical: true, dryRun: false, changes: 0 },
      false,
    );
    expect(s).toMatch(/alreadyCanonical: true/);
    expect(s).toMatch(/rulesetVersion: v2/);
    expect(s).toMatch(/thrillmade/);
    expect(s).toMatch(/protocol/);
    expect(s.endsWith('\n')).toBe(true);
  });

  it('no-op JSON output is a parseable single line with the named fields', () => {
    const s = formatConfigureSummary(
      { owner: 'thrillmade', repo: 'protocol', alreadyCanonical: true, dryRun: false, changes: 0 },
      true,
    );
    const obj = JSON.parse(s);
    expect(obj).toMatchObject({
      owner: 'thrillmade',
      repo: 'protocol',
      alreadyCanonical: true,
      rulesetVersion: 'v2',
    });
  });

  it('applied JSON reports alreadyCanonical: false + the change count', () => {
    const obj = JSON.parse(
      formatConfigureSummary(
        { owner: 'o', repo: 'r', alreadyCanonical: false, dryRun: false, changes: 2 },
        true,
      ),
    );
    expect(obj.alreadyCanonical).toBe(false);
    expect(obj.changes).toBe(2);
    expect(obj.rulesetVersion).toBe('v2');
  });

  it('dry-run human output keeps the existing pending-changes prose', () => {
    const s = formatConfigureSummary(
      { owner: 'o', repo: 'r', alreadyCanonical: false, dryRun: true, changes: 3 },
      false,
    );
    expect(s).toMatch(/dry-run/);
    expect(s).toMatch(/3 changes pending/);
  });
});
