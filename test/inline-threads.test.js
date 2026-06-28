// Tests for src/core/inline-threads.ts — Wave 5a (D.2.X) pure helpers
// + GraphQL constants. The IO-bound `gh api` calls live in the CLI verb
// `post-inline-threads`; this file covers the pure logic those calls
// build on top of.

import { describe, expect, it } from 'vitest';

import {
  findingId,
  parseHeadLines,
  findingAnchorable,
  extractAnchorContext,
  renderThreadBody,
  extractFindingIdFromBody,
  parseThreadBody,
  planInlineThreads,
  REVIEW_THREADS_QUERY,
  REVIEW_THREADS_STATE_QUERY,
  RESOLVE_THREAD_MUTATION,
  ADD_REPLY_MUTATION,
} from '../src/core/inline-threads.js';
import {
  findingId as barrelFindingId,
  planInlineThreads as barrelPlan,
  REVIEW_THREADS_QUERY as barrelQuery,
} from '../src/core/index.js';

// ---------------------------------------------------------------------------
// Barrel re-exports
// ---------------------------------------------------------------------------

describe('core barrel re-exports', () => {
  it('exposes findingId, planInlineThreads, REVIEW_THREADS_QUERY via index.js', () => {
    expect(typeof barrelFindingId).toBe('function');
    expect(typeof barrelPlan).toBe('function');
    expect(typeof barrelQuery).toBe('string');
    // Same reference (the barrel re-exports, doesn't wrap).
    expect(barrelFindingId).toBe(findingId);
    expect(barrelQuery).toBe(REVIEW_THREADS_QUERY);
  });
});

// ---------------------------------------------------------------------------
// findingId — SHA-256 hash stability
// ---------------------------------------------------------------------------

describe('findingId', () => {
  it('returns 16 hex characters', () => {
    const id = findingId({
      file: 'src/foo.ts',
      line: 10,
      severity: 'critical',
      skill: 'critical-issues-only',
      summary: 'NPE risk',
    });
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is stable for the same inputs', () => {
    const args = {
      file: 'src/foo.ts',
      line: 10,
      severity: 'critical',
      skill: 'critical-issues-only',
      summary: 'NPE risk',
    };
    expect(findingId(args)).toBe(findingId(args));
  });

  it('absorbs summary drift past the 100-char truncation boundary', () => {
    const base = 'A'.repeat(100);
    const a = findingId({
      file: 'src/foo.ts',
      line: 10,
      severity: 'critical',
      skill: 's1',
      summary: base + ' tail one',
    });
    const b = findingId({
      file: 'src/foo.ts',
      line: 10,
      severity: 'critical',
      skill: 's1',
      summary: base + ' totally different tail',
    });
    expect(a).toBe(b);
  });

  it('changes id when any tuple field changes within the first 100 chars', () => {
    const base = {
      file: 'src/foo.ts',
      line: 10,
      severity: 'critical',
      skill: 's1',
      summary: 'short summary',
    };
    expect(findingId(base)).not.toBe(findingId({ ...base, file: 'src/bar.ts' }));
    expect(findingId(base)).not.toBe(findingId({ ...base, line: 11 }));
    expect(findingId(base)).not.toBe(findingId({ ...base, severity: 'minor' }));
    expect(findingId(base)).not.toBe(findingId({ ...base, skill: 's2' }));
    expect(findingId(base)).not.toBe(findingId({ ...base, summary: 'different' }));
  });

  it('tolerates missing file/line (uses `<no-file>` + 0 placeholders)', () => {
    const id = findingId({
      severity: 'critical',
      skill: 's',
      summary: 'x',
    });
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// parseHeadLines — diff parsing
// ---------------------------------------------------------------------------

describe('parseHeadLines', () => {
  it('returns empty set for undefined patch', () => {
    expect(parseHeadLines(undefined)).toEqual(new Set());
  });

  it('returns empty set for empty patch', () => {
    expect(parseHeadLines('')).toEqual(new Set());
  });

  it('extracts added lines from a simple hunk', () => {
    const patch = `@@ -1,1 +1,2 @@
 unchanged
+new line`;
    expect(parseHeadLines(patch)).toEqual(new Set([1, 2]));
  });

  it('counts context lines as HEAD-side line numbers', () => {
    const patch = `@@ -1,3 +1,3 @@
 line1
-removed
+added
 line3`;
    expect(parseHeadLines(patch)).toEqual(new Set([1, 2, 3]));
  });

  it('does not advance line counter on removed (-) lines', () => {
    const patch = `@@ -10,3 +10,1 @@
 keep
-rm1
-rm2`;
    expect(parseHeadLines(patch)).toEqual(new Set([10]));
  });

  it('skips +++/--- file headers', () => {
    const patch = `--- a/old.ts
+++ b/new.ts
@@ -1,1 +1,1 @@
+real add`;
    expect(parseHeadLines(patch)).toEqual(new Set([1]));
  });

  it('handles multiple hunks', () => {
    const patch = `@@ -1,1 +1,1 @@
+a
@@ -10,1 +20,1 @@
+b`;
    expect(parseHeadLines(patch)).toEqual(new Set([1, 20]));
  });

  it('handles defaulted newLines count (single-line hunks)', () => {
    const patch = `@@ -5 +5 @@
+only`;
    expect(parseHeadLines(patch)).toEqual(new Set([5]));
  });

  it('skips the "\\ No newline at end of file" marker', () => {
    const patch = `@@ -1,1 +1,1 @@
+x
\\ No newline at end of file`;
    expect(parseHeadLines(patch)).toEqual(new Set([1]));
  });
});

// ---------------------------------------------------------------------------
// findingAnchorable — gate per-finding thread creation
// ---------------------------------------------------------------------------

describe('findingAnchorable', () => {
  const diffFiles = [
    {
      filename: 'src/foo.ts',
      patch: `@@ -1,1 +1,2 @@
 ctx
+added`,
    },
    { filename: 'src/binary.bin' }, // no patch (binary or truncated)
  ];

  it('returns true when file + line are in the diff', () => {
    expect(findingAnchorable({ file: 'src/foo.ts', line: 1 }, diffFiles)).toBe(true);
    expect(findingAnchorable({ file: 'src/foo.ts', line: 2 }, diffFiles)).toBe(true);
  });

  it('returns false when line is outside the hunks', () => {
    expect(findingAnchorable({ file: 'src/foo.ts', line: 99 }, diffFiles)).toBe(false);
  });

  it('returns false when file is not in the diff', () => {
    expect(findingAnchorable({ file: 'src/bar.ts', line: 1 }, diffFiles)).toBe(false);
  });

  it('returns false for binary files (no patch)', () => {
    expect(findingAnchorable({ file: 'src/binary.bin', line: 1 }, diffFiles)).toBe(false);
  });

  it('returns false when file or line is missing', () => {
    expect(findingAnchorable({ line: 1 }, diffFiles)).toBe(false);
    expect(findingAnchorable({ file: 'src/foo.ts' }, diffFiles)).toBe(false);
    expect(findingAnchorable({}, diffFiles)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractAnchorContext — verifier context extraction
// ---------------------------------------------------------------------------

describe('extractAnchorContext', () => {
  const diffFiles = [
    {
      filename: 'src/foo.ts',
      patch: `@@ -5,3 +5,4 @@
 ctx1
-old1
+new1
+new2
 ctx2`,
    },
  ];

  it('returns codeBefore and codeAfter populated from the hunk', () => {
    const ctx = extractAnchorContext({ file: 'src/foo.ts', line: 6 }, diffFiles);
    expect(ctx.codeBefore).toContain('old1');
    expect(ctx.codeAfter).toContain('new1');
    expect(ctx.diffAtAnchor).toContain('@@');
  });

  it('returns empty strings when file is not in the diff', () => {
    const ctx = extractAnchorContext({ file: 'src/bar.ts', line: 1 }, diffFiles);
    expect(ctx).toEqual({ codeBefore: '', codeAfter: '' });
  });

  it('returns empty strings when file/line are missing', () => {
    expect(extractAnchorContext({}, diffFiles)).toEqual({ codeBefore: '', codeAfter: '' });
  });

  it('returns empty strings when line is outside all hunks', () => {
    const ctx = extractAnchorContext({ file: 'src/foo.ts', line: 99 }, diffFiles);
    expect(ctx).toEqual({ codeBefore: '', codeAfter: '' });
  });
});

// ---------------------------------------------------------------------------
// renderThreadBody / extractFindingIdFromBody — marker roundtrip
// ---------------------------------------------------------------------------

describe('renderThreadBody + extractFindingIdFromBody', () => {
  const finding = {
    severity: 'critical',
    skill: 'critical-issues-only',
    file: 'src/foo.ts',
    line: 42,
    summary: 'NPE on null user',
    reasoning: 'getUser() can return null when the cache misses.',
  };

  it('embeds the canonical finding-id marker as the first line', () => {
    const body = renderThreadBody(finding);
    expect(body.startsWith('<!-- finding-id: ')).toBe(true);
    const extracted = extractFindingIdFromBody(body);
    expect(extracted).toBe(findingId(finding));
  });

  it('renders critical severity with red circle badge', () => {
    expect(renderThreadBody({ ...finding, severity: 'critical' })).toContain('🔴');
  });

  it('renders minor severity with yellow circle badge', () => {
    expect(renderThreadBody({ ...finding, severity: 'minor' })).toContain('🟡');
  });

  it('includes skill name in backticks', () => {
    expect(renderThreadBody(finding)).toContain('`critical-issues-only`');
  });

  it('includes summary + reasoning in the body', () => {
    const body = renderThreadBody(finding);
    expect(body).toContain('NPE on null user');
    expect(body).toContain('getUser() can return null');
  });

  it('omits reasoning section when reasoning is undefined', () => {
    const body = renderThreadBody({ ...finding, reasoning: undefined });
    expect(body).toContain('NPE on null user');
    expect(body).not.toContain('getUser()');
  });

  it('returns null when body has no finding-id marker', () => {
    expect(extractFindingIdFromBody('just a regular comment')).toBeNull();
    expect(extractFindingIdFromBody('<!-- some-other-marker: xxx -->')).toBeNull();
  });

  it('returns null when finding-id marker is malformed (wrong length)', () => {
    expect(extractFindingIdFromBody('<!-- finding-id: deadbeef -->')).toBeNull(); // 8 chars, not 16
    expect(extractFindingIdFromBody('<!-- finding-id: deadbeefdeadbeefXX -->')).toBeNull(); // non-hex
  });

  it('returns null when marker appears mid-body (anti-injection — user reply quoting the marker)', () => {
    // A human replying to the inline thread might paste/quote the marker
    // text. The extractor MUST NOT match it as bot-authored — `renderThreadBody`
    // always places the canonical marker as the first line of the original
    // comment, so anything mid-body is suspect input from a downstream reply.
    const body =
      '> The original finding id was <!-- finding-id: deadbeefdeadbeef -->\n\nI disagree with this finding.';
    expect(extractFindingIdFromBody(body)).toBeNull();
  });

  it('extracts the marker when it is on the very first line (the canonical place)', () => {
    const body = '<!-- finding-id: 0123456789abcdef -->\nrest of comment';
    expect(extractFindingIdFromBody(body)).toBe('0123456789abcdef');
  });
});

// ---------------------------------------------------------------------------
// planInlineThreads — finding partition
// ---------------------------------------------------------------------------

describe('planInlineThreads', () => {
  const diffFiles = [
    {
      filename: 'src/foo.ts',
      patch: `@@ -1,1 +1,2 @@
 ctx
+added`,
    },
  ];

  it('returns empty comments for empty findings', () => {
    const r = planInlineThreads([], diffFiles);
    expect(r.comments).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.preexisting).toEqual([]);
  });

  it('anchors a critical finding into a comment entry', () => {
    const finding = {
      severity: 'critical',
      skill: 's',
      file: 'src/foo.ts',
      line: 2,
      summary: 'bug',
    };
    const r = planInlineThreads([finding], diffFiles);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({
      path: 'src/foo.ts',
      line: 2,
      side: 'RIGHT',
    });
    expect(r.comments[0].body).toContain('<!-- finding-id:');
    expect(r.skipped).toEqual([]);
    expect(r.preexisting).toEqual([]);
  });

  it('moves preexisting findings to their own bucket (never threaded)', () => {
    const finding = {
      severity: 'preexisting',
      skill: 's',
      file: 'src/foo.ts',
      line: 2,
      summary: 'old',
    };
    const r = planInlineThreads([finding], diffFiles);
    expect(r.comments).toEqual([]);
    expect(r.preexisting).toHaveLength(1);
  });

  it('moves non-anchorable findings to skipped', () => {
    const finding = {
      severity: 'critical',
      skill: 's',
      file: 'src/bar.ts', // not in diff
      line: 1,
      summary: 'bug',
    };
    const r = planInlineThreads([finding], diffFiles);
    expect(r.comments).toEqual([]);
    expect(r.skipped).toHaveLength(1);
  });

  it('mixed batch: anchors what it can, partitions the rest', () => {
    const findings = [
      { severity: 'critical', skill: 'a', file: 'src/foo.ts', line: 2, summary: 'in' },
      { severity: 'minor', skill: 'b', file: 'src/foo.ts', line: 99, summary: 'out-of-hunk' },
      { severity: 'preexisting', skill: 'c', file: 'src/foo.ts', line: 1, summary: 'pre' },
    ];
    const r = planInlineThreads(findings, diffFiles);
    expect(r.comments).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.preexisting).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GraphQL constants — shape sanity (regex spot-checks, not full parse)
// ---------------------------------------------------------------------------

describe('GraphQL operation strings', () => {
  it('REVIEW_THREADS_QUERY queries reviewThreads with id + isResolved + comments', () => {
    expect(REVIEW_THREADS_QUERY).toMatch(/query ReviewThreads/);
    expect(REVIEW_THREADS_QUERY).toMatch(/reviewThreads\(first: 100\)/);
    expect(REVIEW_THREADS_QUERY).toMatch(/isResolved/);
    expect(REVIEW_THREADS_QUERY).toMatch(/databaseId/);
    expect(REVIEW_THREADS_QUERY).toMatch(/originalLine/);
  });

  it('REVIEW_THREADS_STATE_QUERY queries the lighter state shape', () => {
    expect(REVIEW_THREADS_STATE_QUERY).toMatch(/query ReviewThreadStates/);
    expect(REVIEW_THREADS_STATE_QUERY).toMatch(/isResolved/);
    // State query embeds body so Wave 5b can re-derive finding-id from the marker.
    expect(REVIEW_THREADS_STATE_QUERY).toMatch(/body/);
  });

  it('RESOLVE_THREAD_MUTATION calls resolveReviewThread with threadId', () => {
    expect(RESOLVE_THREAD_MUTATION).toMatch(/mutation ResolveThread/);
    expect(RESOLVE_THREAD_MUTATION).toMatch(/resolveReviewThread/);
    expect(RESOLVE_THREAD_MUTATION).toMatch(/\$threadId: ID!/);
  });

  it('ADD_REPLY_MUTATION calls addPullRequestReviewThreadReply (Wave 5b)', () => {
    expect(ADD_REPLY_MUTATION).toMatch(/mutation AddThreadReply/);
    expect(ADD_REPLY_MUTATION).toMatch(/addPullRequestReviewThreadReply/);
    expect(ADD_REPLY_MUTATION).toMatch(/\$threadId: ID!/);
    expect(ADD_REPLY_MUTATION).toMatch(/\$body: String!/);
  });
});

// ---------------------------------------------------------------------------
// parseThreadBody — invert renderThreadBody for Wave 5b auto-resolve
// ---------------------------------------------------------------------------

describe('parseThreadBody — Wave 5b inverse of renderThreadBody', () => {
  const finding = {
    severity: 'critical',
    skill: 'critical-issues-only',
    file: 'lib/utils.ts',
    line: 15,
    summary: 'NPE risk on null user',
    reasoning: 'getUser() can return null when the cache misses.',
  };

  it('roundtrips the canonical body shape', () => {
    const body = renderThreadBody(finding);
    const parsed = parseThreadBody(body);
    expect(parsed).not.toBeNull();
    expect(parsed.findingId).toBe(findingId(finding));
    expect(parsed.severity).toBe('critical');
    expect(parsed.skill).toBe('critical-issues-only');
    expect(parsed.summary).toBe('NPE risk on null user');
    expect(parsed.reasoning).toMatch(/getUser\(\)/);
  });

  it('roundtrips minor severity', () => {
    const minor = { ...finding, severity: 'minor' };
    const parsed = parseThreadBody(renderThreadBody(minor));
    expect(parsed.severity).toBe('minor');
  });

  it('omits reasoning when source finding had none', () => {
    const noReasoning = { ...finding, reasoning: undefined };
    const parsed = parseThreadBody(renderThreadBody(noReasoning));
    expect(parsed.reasoning).toBeUndefined();
  });

  it('returns null on a body that lacks the marker (regular human comment)', () => {
    expect(parseThreadBody('Hello, I have a question about this.')).toBeNull();
  });

  it('returns null on a body where the marker is mid-body (anti-injection)', () => {
    const body =
      '> The original finding id was <!-- finding-id: deadbeefdeadbeef -->\n\nI disagree.';
    expect(parseThreadBody(body)).toBeNull();
  });

  it('returns null on a body that has the marker but malformed structure (no badge line)', () => {
    expect(
      parseThreadBody('<!-- finding-id: deadbeefdeadbeef -->\nWrong format'),
    ).toBeNull();
  });
});
