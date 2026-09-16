import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { renderReview } from '../src/core/render-review.js';
import { SPEC_VERSION } from '../src/core/spec-version.js';

// Minimum-shape input that matches the schema's required fields. Tests
// build off this via {...MIN, override} to keep each test focused.
const MIN = {
  status_header: 'clean',
  summary_counts: { critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0 },
  per_skill_scan: [],
  critical_findings: [],
  minor_findings: [],
  preexisting_findings: [],
  skills_referenced: [],
  last_reviewed_sha: 'abc1234',
};

test('renderReview: clean review with no skills produces minimal valid summary', () => {
  const out = renderReview(MIN);
  assert.match(out, /^## 🐛 Clud Bug review — clean/);
  assert.match(out, /\*\*This round:\*\* 0 critical · 0 minor · 0 resolved from prior · 0 still open/);
  assert.match(out, /Found: 0 🔴 \/ 0 🟡 \/ 0 🟣/);
  assert.match(out, /### Per-skill scan/);
  assert.match(out, /<!-- last-reviewed-sha: abc1234 -->/);
  // No findings sections rendered when arrays empty.
  assert.doesNotMatch(out, /### Critical findings/);
  assert.doesNotMatch(out, /### Minor findings/);
  assert.doesNotMatch(out, /### Pre-existing findings/);
  assert.doesNotMatch(out, /### Diagnostics/);
});

test('renderReview: critical-findings header → strict-mode-gate-anchored verdict line', () => {
  const out = renderReview({ ...MIN, status_header: 'critical findings' });
  // The strict-mode gate greps EXACTLY this anchor. Don't change without
  // updating the action.yml grep predicate.
  assert.match(out, /^## 🐛 Clud Bug review — critical findings/);
});

test('renderReview: bare H2 header when status_header is unknown (defensive)', () => {
  const out = renderReview({ ...MIN, status_header: 'something-else' });
  // Bare anchor — strict-mode gate sees no critical-findings verdict so
  // it falls through as non-critical. Better than throwing.
  assert.match(out, /^## 🐛 Clud Bug review\n/);
});

test('renderReview: status_header "bare" produces unsuffixed H2 (non-strict-mode default)', () => {
  // 0.0.O (v0.6.22): the schema explicitly accepts 'bare' as a
  // status_header value so non-strict-mode repos can keep the v0.6.21-
  // visible behaviour (no "— clean" / "— critical findings" suffix on
  // the H2). Without this, every non-strict install would silently
  // start seeing a suffix in the summary header after merge.
  const out = renderReview({ ...MIN, status_header: 'bare' });
  assert.match(out, /^## 🐛 Clud Bug review\n/);
  assert.doesNotMatch(out, /— clean/);
  assert.doesNotMatch(out, /— critical findings/);
});

test('renderReview: per-skill scan emits one line per entry with [skill]: outcome shape', () => {
  const out = renderReview({
    ...MIN,
    per_skill_scan: [
      { skill: 'critical-issues-only', outcome: 'scanned all paths. 0 findings.' },
      { skill: 'evidence-based-review', outcome: 'applied to 0 findings.' },
    ],
  });
  assert.match(out, /- \[critical-issues-only\]: scanned all paths\. 0 findings\./);
  assert.match(out, /- \[evidence-based-review\]: applied to 0 findings\./);
});

test('renderReview: per-skill scan with empty array notes baseline-only review', () => {
  const out = renderReview(MIN);
  assert.match(out, /### Per-skill scan/);
  assert.match(out, /no skills loaded — review proceeded against the baseline/);
});

test('renderReview: critical finding renders with 🔴 prefix + file:line anchor + reasoning block', () => {
  const out = renderReview({
    ...MIN,
    status_header: 'critical findings',
    summary_counts: { critical: 1, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0 },
    critical_findings: [{
      skill: 'critical-issues-only',
      file: 'src/auth.ts',
      line: 42,
      summary: 'session token logged in cleartext',
      reasoning: 'The token is written to debug.log on line 42, which ships to the central log aggregator. Replace with a redacted prefix (`token.slice(0, 4) + "***"`).',
    }],
  });
  assert.match(out, /🔴 \[critical-issues-only\]: session token logged in cleartext \(src\/auth\.ts:42\)\./);
  assert.match(out, /<details><summary>Reasoning<\/summary>/);
  assert.match(out, /redacted prefix/);
  assert.match(out, /<\/details>/);
  assert.match(out, /Found: 1 🔴 \/ 0 🟡 \/ 0 🟣/);
});

test('renderReview: anchor without line renders file only', () => {
  const out = renderReview({
    ...MIN,
    critical_findings: [{
      skill: 'evidence-based-review',
      file: 'src/auth.ts',
      summary: 'cross-cutting nullability gap',
    }],
  });
  assert.match(out, /🔴 \[evidence-based-review\]: cross-cutting nullability gap \(src\/auth\.ts\)\./);
});

test('renderReview: anchor without file renders without parens (cross-cutting)', () => {
  const out = renderReview({
    ...MIN,
    critical_findings: [{
      skill: 'critical-issues-only',
      summary: 'missing test coverage for new endpoint',
    }],
  });
  assert.match(out, /🔴 \[critical-issues-only\]: missing test coverage for new endpoint/);
  // No parens added when there's no file.
  assert.doesNotMatch(out, /missing test coverage for new endpoint \(\)/);
});

test('renderReview: minor + preexisting findings use 🟡 / 🟣 emoji and their own sections', () => {
  const out = renderReview({
    ...MIN,
    summary_counts: { critical: 0, minor: 1, preexisting: 1, resolved_from_prior: 0, still_open: 0 },
    minor_findings: [{ skill: 'critical-issues-only', summary: 'nit: rename helper to be self-documenting' }],
    preexisting_findings: [{ skill: 'critical-issues-only', summary: 'pre-existing nullability gap in unrelated module' }],
  });
  assert.match(out, /### Minor findings/);
  assert.match(out, /🟡 \[critical-issues-only\]: nit: rename helper to be self-documenting/);
  assert.match(out, /### Pre-existing findings/);
  assert.match(out, /🟣 \[critical-issues-only\]: pre-existing nullability gap/);
  assert.match(out, /Found: 0 🔴 \/ 1 🟡 \/ 1 🟣/);
});

test('renderReview: diagnostics block renders when array is non-empty', () => {
  const out = renderReview({
    ...MIN,
    diagnostics: [
      'diff: hit MAX_DIFF_BYTES; re-fetched at 2x — recovered.',
      'comments: still truncated at 2x cap; finding deferred.',
    ],
  });
  assert.match(out, /### Diagnostics/);
  assert.match(out, /- diff: hit MAX_DIFF_BYTES; re-fetched at 2x — recovered\./);
  assert.match(out, /- comments: still truncated at 2x cap; finding deferred\./);
});

test('renderReview: dedicated_sections emit a H3 per section in order, before standard buckets', () => {
  const out = renderReview({
    ...MIN,
    status_header: 'critical findings',
    summary_counts: { critical: 2, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0 },
    dedicated_sections: [
      {
        section_name: 'Brand voice',
        skill: 'brand-voice-review',
        findings: [{ skill: 'brand-voice-review', file: 'src/ui/Button.tsx', line: 12, summary: 'label "Click here!" violates verb-noun rule' }],
      },
    ],
    critical_findings: [
      { skill: 'critical-issues-only', file: 'src/auth.ts', line: 99, summary: 'token logged' },
    ],
  });
  // Section header includes both display name and skill in brackets.
  assert.match(out, /### Brand voice \[brand-voice-review\]/);
  assert.match(out, /label "Click here!" violates verb-noun rule/);
  // Standard critical bucket renders too.
  assert.match(out, /### Critical findings/);
  assert.match(out, /token logged/);
  // Order: Brand voice section appears BEFORE the standard Critical findings bucket.
  const brand = out.indexOf('### Brand voice');
  const crit = out.indexOf('### Critical findings');
  assert.ok(brand >= 0 && crit > brand, 'dedicated section must precede the standard critical bucket');
});

test('renderReview: skills_referenced footer single-line when present', () => {
  const out = renderReview({
    ...MIN,
    skills_referenced: ['critical-issues-only', 'evidence-based-review'],
  });
  assert.match(out, /Skills referenced: \[critical-issues-only, evidence-based-review\]/);
});

test('renderReview: skills_referenced empty array emits [none] + reason', () => {
  const out = renderReview(MIN);
  assert.match(out, /Skills referenced: \[none\] — no installed skill applied to this diff/);
});

test('renderReview: last-reviewed-sha marker always emits when present', () => {
  const out = renderReview({ ...MIN, last_reviewed_sha: 'deadbeef' });
  // Marker on its own line at the very end (after a trailing newline).
  assert.match(out, /<!-- last-reviewed-sha: deadbeef -->\n$/);
});

test('renderReview: throws TypeError on non-object input (programmer error)', () => {
  assert.throws(() => renderReview(null), /must be an object/);
  assert.throws(() => renderReview('string'), /must be an object/);
});

test('renderReview: defensively coerces negative / non-numeric counts to 0', () => {
  // Belt-and-suspenders: the schema sets minimum: 0, but the renderer should
  // not blow up if a malformed JSON somehow slipped through (e.g. someone
  // hand-tests with --json-schema absent).
  const out = renderReview({
    ...MIN,
    summary_counts: { critical: -3, minor: 'two', preexisting: NaN, resolved_from_prior: 0, still_open: 0 },
  });
  assert.match(out, /\*\*This round:\*\* 0 critical · 0 minor · 0 resolved from prior · 0 still open/);
  assert.match(out, /Found: 0 🔴 \/ 0 🟡 \/ 0 🟣/);
});

test('renderReview: strips trailing period from summary before adding (anchor) period', () => {
  // The renderer adds its own period after the (file:line) anchor. A summary
  // ending in a period would render as "claim. (file:line)." — read clean.
  const out = renderReview({
    ...MIN,
    critical_findings: [{
      skill: 'evidence-based-review',
      file: 'src/foo.ts',
      line: 1,
      summary: 'unsupported type assertion.',
    }],
  });
  assert.match(out, /🔴 \[evidence-based-review\]: unsupported type assertion \(src\/foo\.ts:1\)\./);
});

// ---------------------------------------------------------------------------
// clud-bug#256 gap B — OPTIONAL `meta` switches the header to SPEC §4.3's
// shape (SPEC.md:861-869); absent meta MUST leave every byte unchanged
// (fixtures/reviews/*, checked byte-for-byte by scripts/fixture-check.mjs,
// carries none — this is the second half of that same contract).
// ---------------------------------------------------------------------------

test('renderReview: no meta (single-arg call) is byte-identical to before #256', () => {
  const out = renderReview(MIN);
  assert.match(out, /^## 🐛 Clud Bug review — clean/);
  assert.doesNotMatch(out, /clud-bug review — PR #/);
  assert.doesNotMatch(out, /\*\*Skills cited:\*\*/);
});

test('renderReview: meta present emits the SPEC §4.3 H1 + ordered HTML-comment markers', () => {
  const out = renderReview(MIN, {
    meta: {
      prNumber: 42,
      writtenBy: 'github-actions[bot]',
      reviewSha: 'a'.repeat(40),
      verdict: 'passing',
      independence: 'single-producer',
    },
  });
  assert.match(
    out,
    new RegExp(
      '^# clud-bug review — PR #42\\n'
      + `<!-- spec-version: ${SPEC_VERSION} -->\\n`
      + '<!-- written-by: github-actions\\[bot\\] -->\\n'
      + `<!-- review-sha: ${'a'.repeat(40)} -->\\n`
      + '<!-- verdict: passing -->\\n'
      + '<!-- independence: single-producer -->\\n',
    ),
  );
});

test('renderReview: meta.specVersion defaults from SPEC_VERSION when omitted', () => {
  const out = renderReview(MIN, { meta: { prNumber: 1 } });
  assert.match(out, new RegExp(`<!-- spec-version: ${SPEC_VERSION} -->`));
});

test('renderReview: meta present but verdict/independence absent — those two markers are omitted, not invented (#256 ruling 4)', () => {
  const out = renderReview(MIN, { meta: { prNumber: 1, writtenBy: 'github-actions[bot]' } });
  assert.doesNotMatch(out, /<!-- verdict:/);
  assert.doesNotMatch(out, /<!-- independence:/);
  // The markers the caller DOES know still emit.
  assert.match(out, /<!-- written-by: github-actions\[bot\] -->/);
});

test('renderReview: meta present adds **Skills cited:** with per-skill finding counts, before the trailing last-reviewed-sha marker', () => {
  const out = renderReview(
    {
      ...MIN,
      critical_findings: [
        { skill: 'critical-issues-only', file: 'a.ts', line: 1, summary: 'one' },
        { skill: 'critical-issues-only', file: 'b.ts', line: 2, summary: 'two' },
      ],
      minor_findings: [{ skill: 'nit-picker', file: 'c.ts', line: 3, summary: 'three' }],
      skills_referenced: ['critical-issues-only', 'nit-picker'],
    },
    { meta: { prNumber: 7 } },
  );
  assert.match(
    out,
    /\*\*Skills cited:\*\*\n- critical-issues-only \(2 findings\)\n- nit-picker \(1 finding\)/,
  );
  // last-reviewed-sha stays the final line even with meta (test above pins
  // this for the no-meta case; this is the meta case).
  assert.match(out, /<!-- last-reviewed-sha: abc1234 -->\n$/);
});

test('renderReview: meta present + no skills_referenced — Skills cited falls back like Skills referenced does', () => {
  const out = renderReview(MIN, { meta: { prNumber: 1 } });
  assert.match(out, /\*\*Skills cited:\*\*\n- _\(none — see summary above\)_/);
});
