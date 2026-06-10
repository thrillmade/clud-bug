// Equivalence test: src/core/review-writeback.ts must produce byte-
// identical doc-file output to clud-bug-app/lib/review-writeback.ts that
// it was ported from.
//
// Mirrors test/review-schema-zod.test.js pattern. We pin known-good
// fixtures here so a future drift between core's renderer and the App's
// (which the App keeps until Phase 4 deletes its copy) is caught by CI
// before it lands in production.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';

import {
  renderReviewFile,
  renderMultiPassMarkdown,
  reviewFilePath,
  reviewCommitMessage,
  PROTOCOL_VERSION,
  WRITTEN_BY,
  SEVERITY_EMOJI,
} from '../src/core/review-writeback.js';
// Also confirm the barrel re-exports under the disambiguated name.
import { REVIEW_FILE_SEVERITY_EMOJI } from '../src/core/index.js';

const EMPTY_REVIEW = {
  status_header: 'clean',
  summary_counts: {
    critical: 0, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0,
  },
  per_skill_scan: [],
  critical_findings: [],
  minor_findings: [],
  preexisting_findings: [],
  skills_referenced: [],
  last_reviewed_sha: '0000000000000000000000000000000000000000',
};

const HEAD_SHA = '1234567890abcdef1234567890abcdef12345678';
const PR_URL = 'https://github.com/thrillmade/clud-bug/pull/158';

// ---------------------------------------------------------------------------
// renderReviewFile: shape
// ---------------------------------------------------------------------------

test('renderReviewFile: H1 header carries PR number', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.startsWith('# clud-bug review — PR #158\n'));
});

test('renderReviewFile: HTML metadata comments are in spec order', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  const protoIdx = md.indexOf('<!-- protocol-version:');
  const writtenIdx = md.indexOf('<!-- written-by:');
  const shaIdx = md.indexOf('<!-- review-sha:');
  assert.ok(protoIdx < writtenIdx);
  assert.ok(writtenIdx < shaIdx);
  assert.ok(md.includes(`<!-- protocol-version: ${PROTOCOL_VERSION} -->`));
  assert.ok(md.includes(`<!-- written-by: ${WRITTEN_BY} -->`));
  assert.ok(md.includes(`<!-- review-sha: ${HEAD_SHA} -->`));
});

test('renderReviewFile: Skills cited shows (none) marker on empty', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('**Skills cited:**'));
  assert.ok(md.includes('_(none — see summary above)_'));
});

test('renderReviewFile: trailing Link to PR is preserved verbatim', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.endsWith(`---\n\n[Link to PR](${PR_URL})\n`));
});

test('renderReviewFile: empty-review file ends with single trailing newline', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.endsWith('\n'));
  assert.ok(!md.endsWith('\n\n'));
});

test('renderReviewFile: empty buckets omit their section headers', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  // Per SPEC §1.8.1 — empty buckets MUST be omitted entirely.
  assert.ok(!md.includes('### 🔴'));
  assert.ok(!md.includes('### 🟡'));
  assert.ok(!md.includes('### 🟣'));
});

// ---------------------------------------------------------------------------
// renderReviewFile: findings rendering
// ---------------------------------------------------------------------------

const REVIEW_WITH_CRITICAL = {
  status_header: 'critical findings',
  summary_counts: {
    critical: 1, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0,
  },
  per_skill_scan: [],
  critical_findings: [
    {
      skill: 'race-conditions', file: 'src/auth.ts', line: 42,
      summary: 'Race condition on token refresh',
      reasoning: 'Two async calls can interleave.',
    },
  ],
  minor_findings: [],
  preexisting_findings: [],
  skills_referenced: ['race-conditions'],
  last_reviewed_sha: HEAD_SHA,
};

test('renderReviewFile: critical bucket shows red emoji header', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_CRITICAL, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  // U+1F534 is the red circle.
  assert.ok(md.includes(`### ${SEVERITY_EMOJI.critical} Critical`));
});

test('renderReviewFile: critical findings include Reasoning line', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_CRITICAL, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('**src/auth.ts:42** — race-conditions: Race condition on token refresh'));
  assert.ok(md.includes('Reasoning: Two async calls can interleave.'));
});

test('renderReviewFile: Skills cited shows count', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_CRITICAL, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('- race-conditions (1 finding)'));
});

const REVIEW_WITH_MULTI = {
  status_header: 'critical findings',
  summary_counts: {
    critical: 2, minor: 1, preexisting: 1, resolved_from_prior: 0, still_open: 0,
  },
  per_skill_scan: [],
  critical_findings: [
    { skill: 'race-conditions', file: 'a.ts', line: 1, summary: 'A' },
    { skill: 'race-conditions', file: 'b.ts', line: 2, summary: 'B' },
  ],
  minor_findings: [
    { skill: 'critical-issues-only', file: 'c.ts', line: 3, summary: 'C' },
  ],
  preexisting_findings: [
    { skill: 'evidence-based-review', file: 'd.ts', line: 4, summary: 'D' },
  ],
  skills_referenced: ['race-conditions', 'critical-issues-only', 'evidence-based-review'],
  last_reviewed_sha: HEAD_SHA,
};

test('renderReviewFile: bucket order is critical → minor → preexisting', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_MULTI, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  const critIdx = md.indexOf('### 🔴 Critical');
  const minorIdx = md.indexOf('### 🟡 Minor');
  const preIdx = md.indexOf('### 🟣 Preexisting');
  assert.ok(critIdx >= 0);
  assert.ok(minorIdx >= 0);
  assert.ok(preIdx >= 0);
  assert.ok(critIdx < minorIdx);
  assert.ok(minorIdx < preIdx);
});

test('renderReviewFile: pluralization — "1 finding" vs "2 findings"', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_MULTI, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('- race-conditions (2 findings)'));
  assert.ok(md.includes('- critical-issues-only (1 finding)'));
});

test('renderReviewFile: summary line lists all 5 counts in spec order', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_MULTI, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(
    md.includes('**Summary:** 2 critical · 1 minor · 1 preexisting · 0 resolved-from-prior · 0 still-open'),
  );
});

// ---------------------------------------------------------------------------
// renderReviewFile: NFC normalization of emoji codepoints
// ---------------------------------------------------------------------------

test('renderReviewFile: output is NFC-normalized (emoji safe)', () => {
  const md = renderReviewFile({
    review: REVIEW_WITH_CRITICAL, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.equal(md, md.normalize('NFC'));
});

test('SEVERITY_EMOJI codepoints match SPEC §1.8.1', () => {
  assert.equal(SEVERITY_EMOJI.critical, '\u{1F534}');
  assert.equal(SEVERITY_EMOJI.minor, '\u{1F7E1}');
  assert.equal(SEVERITY_EMOJI.preexisting, '\u{1F7E3}');
});

test('barrel re-exports SEVERITY_EMOJI as REVIEW_FILE_SEVERITY_EMOJI (disambig)', () => {
  // The CLI's render-review.ts also has SEVERITY_EMOJI; the barrel
  // aliases this one to REVIEW_FILE_SEVERITY_EMOJI to disambiguate.
  assert.equal(REVIEW_FILE_SEVERITY_EMOJI.critical, '\u{1F534}');
  assert.equal(REVIEW_FILE_SEVERITY_EMOJI.minor, '\u{1F7E1}');
  assert.equal(REVIEW_FILE_SEVERITY_EMOJI.preexisting, '\u{1F7E3}');
});

// ---------------------------------------------------------------------------
// reviewFilePath / reviewCommitMessage — App's Octokit writeback uses these
// ---------------------------------------------------------------------------

test('reviewFilePath: SPEC §6.1 path shape', () => {
  assert.equal(reviewFilePath(158), 'docs/reviews/PR-158.md');
  assert.equal(reviewFilePath(1), 'docs/reviews/PR-1.md');
});

test('reviewCommitMessage: SPEC §6.1 exact wording', () => {
  assert.equal(reviewCommitMessage(158), '[skip-logmind] clud-bug review: PR #158');
});

// ---------------------------------------------------------------------------
// renderMultiPassMarkdown — D.2.5 with attribution
// ---------------------------------------------------------------------------

const MULTI_PASS_REVIEW = {
  status_header: 'critical findings',
  summary_counts: {
    critical: 1, minor: 0, preexisting: 0, resolved_from_prior: 0, still_open: 0,
  },
  skills_referenced: ['race-conditions'],
  findings: [
    {
      skill: 'race-conditions',
      file: 'src/auth.ts',
      line: 42,
      summary: 'Race condition',
      reasoning: 'A overwrites B.',
      severity: 'critical',
      attributions: [
        {
          passNumber: 1, roleName: 'Beetle', model: 'anthropic/claude-sonnet-4.6',
          source: 'first',
        },
        {
          passNumber: 2, roleName: 'Wasp', model: 'anthropic/claude-opus-4.7',
          source: 'agreed', note: 'confirmed by independent review',
        },
      ],
    },
  ],
  mode: 'cross-check',
  passCount: 2,
  roles: [
    { passNumber: 1, roleName: 'Beetle', model: 'anthropic/claude-sonnet-4.6' },
    { passNumber: 2, roleName: 'Wasp', model: 'anthropic/claude-opus-4.7' },
  ],
  verdict: 'request_changes',
};

test('renderMultiPassMarkdown: H1 carries passCount + mode', () => {
  const md = renderMultiPassMarkdown({
    review: MULTI_PASS_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.startsWith('# clud-bug review — PR #158 (2 passes · cross-check)\n'));
});

test('renderMultiPassMarkdown: extra metadata comments for passes + mode', () => {
  const md = renderMultiPassMarkdown({
    review: MULTI_PASS_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('<!-- passes: 2 -->'));
  assert.ok(md.includes('<!-- mode: cross-check -->'));
});

test('renderMultiPassMarkdown: Reviewers block lists every pass', () => {
  const md = renderMultiPassMarkdown({
    review: MULTI_PASS_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('**Reviewers:**'));
  assert.ok(md.includes('- Pass 1 — Beetle · anthropic/claude-sonnet-4.6'));
  assert.ok(md.includes('- Pass 2 — Wasp · anthropic/claude-opus-4.7'));
});

test('renderMultiPassMarkdown: head line carries first pass attribution', () => {
  const md = renderMultiPassMarkdown({
    review: MULTI_PASS_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(
    md.includes(
      '- [Pass 1 — Beetle · anthropic/claude-sonnet-4.6] **src/auth.ts:42** — race-conditions: Race condition',
    ),
  );
});

test('renderMultiPassMarkdown: follow-up attribution renders ✅ AGREED', () => {
  const md = renderMultiPassMarkdown({
    review: MULTI_PASS_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(
    md.includes(
      '[Pass 2 — Wasp · anthropic/claude-opus-4.7]: ✅ AGREED — confirmed by independent review',
    ),
  );
});

test('renderMultiPassMarkdown: Summary line ends with Verdict', () => {
  const md = renderMultiPassMarkdown({
    review: MULTI_PASS_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('**Verdict:** request_changes'));
});

test('renderMultiPassMarkdown: single-pass uses "pass" not "passes"', () => {
  const md = renderMultiPassMarkdown({
    review: { ...MULTI_PASS_REVIEW, passCount: 1, mode: 'independent' },
    prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.startsWith('# clud-bug review — PR #158 (1 pass · independent)\n'));
});

test('renderMultiPassMarkdown: independent attribution adds "found independently"', () => {
  const independentReview = {
    ...MULTI_PASS_REVIEW,
    findings: [
      {
        ...MULTI_PASS_REVIEW.findings[0],
        attributions: [
          {
            passNumber: 2, roleName: 'Wasp', model: 'anthropic/claude-opus-4.7',
            source: 'independent',
          },
        ],
      },
    ],
  };
  const md = renderMultiPassMarkdown({
    review: independentReview, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('— found independently]'));
});

test('renderReviewFile: absent f.file → "(unknown file)" fallback (not "undefined")', () => {
  // clud-bug-review #158 minor: findingItemSchema.file is optional so
  // f.file can be undefined; original template literal would emit literal
  // "undefined" into the SPEC §1.8.1 doc file. Guard prevents that.
  const noFileReview = {
    ...REVIEW_WITH_CRITICAL,
    critical_findings: [
      { skill: 'race-conditions', summary: 'Cross-cutting race', reasoning: 'No anchor.' },
    ],
  };
  const md = renderReviewFile({
    review: noFileReview, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(!md.includes('**undefined'));
  assert.ok(md.includes('(unknown file)'));
});

test('renderMultiPassMarkdown: absent f.file → "(unknown file)" fallback (not "undefined")', () => {
  const noFileReview = {
    ...MULTI_PASS_REVIEW,
    findings: [
      {
        ...MULTI_PASS_REVIEW.findings[0],
        file: undefined,
      },
    ],
  };
  const md = renderMultiPassMarkdown({
    review: noFileReview, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(!md.includes('**undefined'));
  assert.ok(md.includes('(unknown file)'));
});

// ---------------------------------------------------------------------------
// v0.7.0-rc.3 — SPEC §1.8.1 Resolved / Still-open blocks + §6.7.3 cache
// telemetry. New optional inputs to renderReviewFile.
// ---------------------------------------------------------------------------

const RESOLVED_SAMPLE = [
  {
    file: 'src/foo.ts', line: 12, severity: 'critical',
    skillName: 'critical-issues-only',
    summary: 'null-deref on empty array',
  },
];
const STILL_OPEN_SAMPLE = [
  {
    file: 'src/bar.ts', line: 84, severity: 'minor',
    skillName: 'evidence-based-review',
    summary: 'missing test for edge case',
  },
];

test('renderReviewFile: Resolved this round block present when input non-empty', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    resolvedFindings: RESOLVED_SAMPLE,
  });
  assert.ok(md.includes('**Resolved this round:**'));
  // SPEC §1.8.1 bullet shape — backtick-wrapped file + skill, (was 🔴 Critical) suffix.
  assert.ok(
    md.includes(
      '- `src/foo.ts:12` — `critical-issues-only`: null-deref on empty array (was 🔴 Critical)',
    ),
  );
});

test('renderReviewFile: Resolved block emitted AFTER severity buckets, BEFORE trailing ---', () => {
  // Use a review with a finding so we have severity buckets to anchor on.
  const md = renderReviewFile({
    review: REVIEW_WITH_CRITICAL, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    resolvedFindings: RESOLVED_SAMPLE,
  });
  const critIdx = md.indexOf('### 🔴 Critical');
  const resolvedIdx = md.indexOf('**Resolved this round:**');
  const dashIdx = md.indexOf('\n---\n');
  assert.ok(critIdx >= 0);
  assert.ok(resolvedIdx > critIdx);
  assert.ok(dashIdx > resolvedIdx);
});

test('renderReviewFile: Resolved block omitted entirely on empty array', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    resolvedFindings: [],
  });
  assert.ok(!md.includes('**Resolved this round:**'));
});

test('renderReviewFile: Resolved block omitted entirely when undefined', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(!md.includes('**Resolved this round:**'));
});

test('renderReviewFile: Still open block present when input non-empty', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    stillOpenFindings: STILL_OPEN_SAMPLE,
  });
  assert.ok(md.includes('**Still open:**'));
  assert.ok(
    md.includes(
      '- `src/bar.ts:84` — `evidence-based-review`: missing test for edge case (was 🟡 Minor)',
    ),
  );
});

test('renderReviewFile: Still open block emitted AFTER Resolved this round when both present', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    resolvedFindings: RESOLVED_SAMPLE,
    stillOpenFindings: STILL_OPEN_SAMPLE,
  });
  const resolvedIdx = md.indexOf('**Resolved this round:**');
  const stillIdx = md.indexOf('**Still open:**');
  assert.ok(resolvedIdx >= 0);
  assert.ok(stillIdx > resolvedIdx);
});

test('renderReviewFile: Still open block omitted entirely on empty array', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    stillOpenFindings: [],
  });
  assert.ok(!md.includes('**Still open:**'));
});

test('renderReviewFile: cross-cutting finding (line=0) omits :line suffix in diff block', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    resolvedFindings: [
      {
        file: 'README.md', line: 0, severity: 'critical',
        skillName: 'docs-link-check', summary: 'broken anchor',
      },
    ],
  });
  // line=0 means cross-cutting; we omit the :N suffix.
  assert.ok(md.includes('- `README.md` — `docs-link-check`: broken anchor (was 🔴 Critical)'));
  assert.ok(!md.includes('README.md:0'));
});

test('renderReviewFile: severity emoji correct in (was X) suffix for all three buckets', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    resolvedFindings: [
      { file: 'a.ts', line: 1, severity: 'critical', skillName: 's', summary: 'A' },
      { file: 'b.ts', line: 2, severity: 'minor', skillName: 's', summary: 'B' },
      { file: 'c.ts', line: 3, severity: 'preexisting', skillName: 's', summary: 'C' },
    ],
  });
  assert.ok(md.includes('(was 🔴 Critical)'));
  assert.ok(md.includes('(was 🟡 Minor)'));
  assert.ok(md.includes('(was 🟣 Preexisting)'));
});

test('renderReviewFile: SPEC §6.7.3 cache telemetry comment present when input provided', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    cacheStats: { cachedInputTokens: 12800, cacheCreationInputTokens: 184 },
  });
  assert.ok(md.includes('<!-- cache: 12800 read · 184 created -->'));
});

test('renderReviewFile: cache comment appears immediately below review-sha (SPEC §6.7.3)', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    cacheStats: { cachedInputTokens: 1000, cacheCreationInputTokens: 50 },
  });
  const shaIdx = md.indexOf('<!-- review-sha:');
  const cacheIdx = md.indexOf('<!-- cache:');
  assert.ok(shaIdx >= 0);
  assert.ok(cacheIdx > shaIdx);
  // Should be on the very next line — no other metadata between them.
  const between = md.slice(shaIdx, cacheIdx);
  // One newline + immediately the cache comment.
  assert.match(between, /^<!-- review-sha: [0-9a-f]+ -->\n$/);
});

test('renderReviewFile: cache comment omitted entirely when cacheStats undefined', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(!md.includes('<!-- cache:'));
});

test('renderReviewFile: cache comment with zero values still emitted (audit trail)', () => {
  const md = renderReviewFile({
    review: EMPTY_REVIEW, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
    cacheStats: { cachedInputTokens: 0, cacheCreationInputTokens: 0 },
  });
  // Even at 0 / 0 the comment lands — operators need to see "first review"
  // (0/0 means no cache hit, cold start) vs absent (caller didn't pass stats).
  assert.ok(md.includes('<!-- cache: 0 read · 0 created -->'));
});

test('renderMultiPassMarkdown: disagreed attribution adds Disputed note', () => {
  const disputedReview = {
    ...MULTI_PASS_REVIEW,
    findings: [
      {
        ...MULTI_PASS_REVIEW.findings[0],
        attributions: [
          MULTI_PASS_REVIEW.findings[0].attributions[0],
          {
            passNumber: 2, roleName: 'Wasp', model: 'anthropic/claude-opus-4.7',
            source: 'disagreed', note: 'guarded by surrounding lock',
          },
        ],
      },
    ],
  };
  const md = renderMultiPassMarkdown({
    review: disputedReview, prNumber: 158, headSha: HEAD_SHA, prUrl: PR_URL,
  });
  assert.ok(md.includes('❌ DISAGREED — guarded by surrounding lock (Disputed — human decides.)'));
});
