// Tests for lib/skill-usage.js — pure-function unit tests.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  computeSkillUsageDelta,
  mergeSkillUsage,
  assessSkillHealth,
  formatHealthDashboard,
} from '../lib/skill-usage.js';


// ---------------------------------------------------------------------------
// computeSkillUsageDelta
// ---------------------------------------------------------------------------

test('computeSkillUsageDelta: empty input returns {}', () => {
  assert.deepEqual(computeSkillUsageDelta(null), {});
  assert.deepEqual(computeSkillUsageDelta(undefined), {});
  assert.deepEqual(computeSkillUsageDelta({}), {});
});

test('computeSkillUsageDelta: per_skill_scan increments loads=1 per skill', () => {
  const delta = computeSkillUsageDelta({
    per_skill_scan: [
      { skill: 'critical-issues-only', outcome: 'scanned 5 files' },
      { skill: 'evidence-based-review', outcome: '0 findings' },
    ],
  });
  assert.equal(delta['critical-issues-only'].loads, 1);
  assert.equal(delta['critical-issues-only'].citations, 0);
  assert.equal(delta['evidence-based-review'].loads, 1);
});

test('computeSkillUsageDelta: skill cited in critical_findings → citations=1', () => {
  const delta = computeSkillUsageDelta({
    per_skill_scan: [
      { skill: 'pii-and-compliance', outcome: 'scan' },
    ],
    critical_findings: [
      { skill: 'pii-and-compliance', summary: 'email in log', file: 'a.js', line: 10 },
    ],
  });
  assert.equal(delta['pii-and-compliance'].loads, 1);
  assert.equal(delta['pii-and-compliance'].citations, 1);
});

test('computeSkillUsageDelta: multiple findings from same skill = 1 citation (per-review counting)', () => {
  const delta = computeSkillUsageDelta({
    per_skill_scan: [{ skill: 'X', outcome: 'scan' }],
    critical_findings: [
      { skill: 'X', summary: 'finding 1' },
      { skill: 'X', summary: 'finding 2' },
      { skill: 'X', summary: 'finding 3' },
    ],
    minor_findings: [{ skill: 'X', summary: 'minor 1' }],
  });
  assert.equal(delta['X'].citations, 1, 'per-review citation, not per-finding');
});

test('computeSkillUsageDelta: dedicated_sections findings count as citations', () => {
  const delta = computeSkillUsageDelta({
    per_skill_scan: [{ skill: 'brand-voice-review', outcome: 'scan' }],
    dedicated_sections: [
      {
        section_name: 'Brand voice',
        skill: 'brand-voice-review',
        findings: [{ skill: 'brand-voice-review', summary: 'verb-noun violation' }],
      },
    ],
  });
  assert.equal(delta['brand-voice-review'].citations, 1);
});

test('computeSkillUsageDelta: skill cited but NOT in per_skill_scan still recorded', () => {
  // Defensive: if a finding references a skill the per_skill_scan
  // forgot to list, we still record the citation.
  const delta = computeSkillUsageDelta({
    critical_findings: [{ skill: 'orphan-skill', summary: 'x' }],
  });
  assert.equal(delta['orphan-skill'].loads, 0);
  assert.equal(delta['orphan-skill'].citations, 1);
});


// ---------------------------------------------------------------------------
// mergeSkillUsage
// ---------------------------------------------------------------------------

test('mergeSkillUsage: accumulates loads and citations across reviews', () => {
  const existing = { X: { loads: 2, citations: 1, last_cited: '2026-05-01T00:00:00Z' } };
  const delta = { X: { loads: 1, citations: 1 } };
  const result = mergeSkillUsage(existing, delta, '2026-05-15T00:00:00Z');
  assert.equal(result.X.loads, 3);
  assert.equal(result.X.citations, 2);
  assert.equal(result.X.last_cited, '2026-05-15T00:00:00Z');
});

test('mergeSkillUsage: last_cited NOT updated when delta.citations is 0', () => {
  const existing = { X: { loads: 1, citations: 1, last_cited: '2026-05-01T00:00:00Z' } };
  const delta = { X: { loads: 1, citations: 0 } };
  const result = mergeSkillUsage(existing, delta, '2026-05-15T00:00:00Z');
  assert.equal(result.X.last_cited, '2026-05-01T00:00:00Z', 'preserves prior timestamp');
  assert.equal(result.X.loads, 2);
  assert.equal(result.X.citations, 1);
});

test('mergeSkillUsage: new skill (not in existing) initializes cleanly', () => {
  const delta = { Y: { loads: 1, citations: 1 } };
  const result = mergeSkillUsage({}, delta, '2026-05-30T00:00:00Z');
  assert.equal(result.Y.loads, 1);
  assert.equal(result.Y.citations, 1);
  assert.equal(result.Y.last_cited, '2026-05-30T00:00:00Z');
});

test('mergeSkillUsage: skills in existing but NOT in delta are preserved', () => {
  const existing = { X: { loads: 5, citations: 2, last_cited: '2026-04-01T00:00:00Z' } };
  const delta = { Y: { loads: 1, citations: 0 } };
  const result = mergeSkillUsage(existing, delta, '2026-05-30T00:00:00Z');
  assert.equal(result.X.loads, 5, 'X unchanged');
  assert.equal(result.X.last_cited, '2026-04-01T00:00:00Z', 'X timestamp preserved');
  assert.equal(result.Y.loads, 1);
});

test('mergeSkillUsage: does not mutate inputs', () => {
  const existing = { X: { loads: 1, citations: 0, last_cited: null } };
  const delta = { X: { loads: 1, citations: 1 } };
  mergeSkillUsage(existing, delta, '2026-05-30T00:00:00Z');
  assert.equal(existing.X.loads, 1, 'input untouched');
  assert.equal(existing.X.citations, 0);
});


// ---------------------------------------------------------------------------
// assessSkillHealth — the deterministic thresholds
// ---------------------------------------------------------------------------

const NOW = new Date('2026-05-30T12:00:00Z');

test('assessSkillHealth: loads<5 -> status=new (do not judge yet)', () => {
  const usage = { X: { loads: 4, citations: 0, last_cited: null } };
  const [row] = assessSkillHealth(usage, NOW);
  assert.equal(row.status, 'new');
});

test('assessSkillHealth: citations=0 + loads>=5 -> archive-candidate', () => {
  const usage = { X: { loads: 10, citations: 0, last_cited: null } };
  const [row] = assessSkillHealth(usage, NOW);
  assert.equal(row.status, 'archive-candidate');
});

test('assessSkillHealth: cited within 60 days -> healthy', () => {
  const usage = {
    X: { loads: 10, citations: 3, last_cited: '2026-04-15T00:00:00Z' },  // 45d ago
  };
  const [row] = assessSkillHealth(usage, NOW);
  assert.equal(row.status, 'healthy');
  assert.equal(row.days_since_cited, 45);
});

test('assessSkillHealth: cited >60 days ago -> stale', () => {
  const usage = {
    X: { loads: 10, citations: 3, last_cited: '2026-03-01T00:00:00Z' },  // 90d ago
  };
  const [row] = assessSkillHealth(usage, NOW);
  assert.equal(row.status, 'stale');
  assert.equal(row.days_since_cited, 90);
});

test('assessSkillHealth: boundary case — exactly 60 days = healthy', () => {
  const sixtyDaysAgo = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
  const usage = {
    X: { loads: 10, citations: 3, last_cited: sixtyDaysAgo.toISOString() },
  };
  const [row] = assessSkillHealth(usage, NOW);
  assert.equal(row.status, 'healthy', '60 days exactly = still healthy (inclusive)');
});

test('assessSkillHealth: sort order is archive > stale > new > healthy', () => {
  const usage = {
    'healthy-a': { loads: 10, citations: 5, last_cited: '2026-05-29T00:00:00Z' },
    'archive-b': { loads: 15, citations: 0, last_cited: null },
    'new-c': { loads: 2, citations: 0, last_cited: null },
    'stale-d': { loads: 10, citations: 3, last_cited: '2026-01-01T00:00:00Z' },
  };
  const rows = assessSkillHealth(usage, NOW);
  assert.equal(rows[0].slug, 'archive-b', 'archive first');
  assert.equal(rows[1].slug, 'stale-d', 'stale second');
  assert.equal(rows[2].slug, 'new-c', 'new third');
  assert.equal(rows[3].slug, 'healthy-a', 'healthy last');
});

test('assessSkillHealth: within same status, sort by loads desc (loudest first)', () => {
  const usage = {
    'archive-quiet': { loads: 5, citations: 0, last_cited: null },
    'archive-loud': { loads: 20, citations: 0, last_cited: null },
  };
  const rows = assessSkillHealth(usage, NOW);
  assert.equal(rows[0].slug, 'archive-loud', 'loudest archive first');
  assert.equal(rows[1].slug, 'archive-quiet');
});

test('assessSkillHealth: empty input returns []', () => {
  assert.deepEqual(assessSkillHealth({}, NOW), []);
  assert.deepEqual(assessSkillHealth(null, NOW), []);
});


// ---------------------------------------------------------------------------
// formatHealthDashboard
// ---------------------------------------------------------------------------

test('formatHealthDashboard: empty rows shows structural placeholder', () => {
  const out = formatHealthDashboard([]);
  assert.match(out, /no usage data yet/i);
  // v0.6.32: placeholder no longer cites a specific version (v0.6.29-30
  // were stale post-ship). Now points the user at what to do next.
  assert.match(out, /substantive PR/i, 'guides reader on when artifacts arrive');
});

test('formatHealthDashboard: non-empty includes header + threshold legend', () => {
  const rows = assessSkillHealth({
    'pii-and-compliance': { loads: 10, citations: 0, last_cited: null },
  }, NOW);
  const out = formatHealthDashboard(rows);
  assert.match(out, /STATUS/);
  assert.match(out, /SLUG/);
  assert.match(out, /Thresholds:/);
  assert.match(out, /pii-and-compliance/);
  assert.match(out, /archive/);
});
