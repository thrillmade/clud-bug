// Wave 5a — D.2.X inline review threads (npm workflow parity, OSS port).
//
// This module holds the pure helpers + GraphQL operation strings that BOTH
// the npm workflow path and the hosted clud-bug-app use to attach a
// per-finding inline review thread to the PR (replacing the legacy
// "one big summary comment listing every finding" UX).
//
// The split between npm and app:
//   - npm path (this package's CLI verb `post-inline-threads`) is stateless:
//     it shells out to `gh api` for the REST createReview + `gh api graphql`
//     for the GraphQL thread-id lookup, then EXITS. No persistent record —
//     Wave 5b's auto-resolve re-queries GitHub on the next push and re-derives
//     finding IDs from the comment-body markers we embed here.
//   - app path keeps its Redis-backed persistence for performance (cross-
//     push thread correlation without re-querying GraphQL every time). The
//     pure helpers below are designed so a future Wave 5c swap can have the
//     App import from this module + drop its local duplicates.
//
// Designed to share `findingId` semantics with clud-bug-app's
// `lib/inline-threads.ts:findingId` (SHA-256 of the canonical 5-tuple,
// truncated to 16 hex chars) so threads posted by one consumer stay
// matchable by the other after the App migrates.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Severity = 'critical' | 'minor' | 'preexisting';

/**
 * Minimal shape this module needs from a review finding. Both the npm CLI
 * and the App's `Finding` type satisfy this; the App also carries
 * `reasoning` + nullable `file`/`line` which we tolerate via the optional
 * fields below.
 */
export interface FindingForThread {
  severity: Severity;
  skill: string;
  file?: string;
  line?: number;
  summary: string;
  reasoning?: string;
}

/**
 * Per-file unified-diff entry. Matches the shape returned by `gh api
 * repos/{owner}/{repo}/pulls/{n}/files` (after JSON.parse) AND
 * `octokit.rest.pulls.listFiles(...).data` so the App can pass either
 * directly.
 */
export interface DiffFile {
  filename: string;
  patch?: string;
}

// ---------------------------------------------------------------------------
// Stable finding id — SHA-256 of the canonical 5-tuple, truncated to 16 hex.
// ---------------------------------------------------------------------------

/**
 * Hashes the canonical `${file}:${line}:${severity}:${skill}:${summary[:100]}`
 * tuple to 16 hex characters. Stable across consumers — the App computes
 * the same hash for the same finding, so threads posted by one consumer
 * stay matchable by the other.
 *
 * Summary is truncated to 100 chars BEFORE hashing so small wording tweaks
 * on subsequent review passes don't generate a fresh id and orphan the
 * prior thread.
 *
 * Distinct from `findingIdentity` in `./diff-findings` (which returns the
 * plain unhashed string — used by the Resolved/Still-open block matcher).
 * Both helpers coexist on purpose: the unhashed string is human-readable
 * for in-prose matching; the hash is short + collision-safe for embedding
 * in `<!-- finding-id: ... -->` comment-body markers.
 */
export function findingId(finding: {
  file?: string;
  line?: number;
  severity: Severity;
  skill: string;
  summary: string;
}): string {
  const file = finding.file ?? '<no-file>';
  const line = finding.line ?? 0;
  const summary = finding.summary.slice(0, 100);
  const payload = `${file}:${line}:${finding.severity}:${finding.skill}:${summary}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Diff anchor detection
// ---------------------------------------------------------------------------

/**
 * Returns the set of 1-indexed HEAD-side line numbers a unified-diff patch
 * touches (added + context lines). GitHub only accepts inline review
 * comments on lines that appear in the diff, so this gates whether a
 * finding's `line` can become a thread.
 *
 * "Touched" = appears on the RIGHT side of the unified diff: added (`+`)
 * lines OR unchanged context (` `) lines inside any hunk. Removed (`-`)
 * lines are LEFT-side only and can't anchor inline comments.
 *
 * If `patch` is undefined (binary file, GitHub truncation) returns an empty
 * set — the caller falls back to the summary comment for those findings.
 */
export function parseHeadLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;

  // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
  // newLines defaults to 1 when omitted.
  const hunkHeaderRe = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/;

  let newLine = 0;
  let inHunk = false;
  for (const rawLine of patch.split('\n')) {
    const m = rawLine.match(hunkHeaderRe);
    if (m) {
      newLine = Number.parseInt(m[1]!, 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      lines.add(newLine);
      newLine++;
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      // LEFT-side only — does not advance the newLine counter.
    } else if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file" — doesn't advance.
    } else {
      // Context line — counts as a HEAD-side line.
      lines.add(newLine);
      newLine++;
    }
  }

  return lines;
}

/**
 * Returns true when the finding's `(file, line)` can be anchored as an
 * inline comment on the current diff. `diffFiles` is the per-file diff
 * (as returned by `gh api repos/.../pulls/.../files`).
 */
export function findingAnchorable(
  finding: { file?: string; line?: number },
  diffFiles: ReadonlyArray<DiffFile>,
): boolean {
  if (!finding.file || !finding.line) return false;
  const file = diffFiles.find((f) => f.filename === finding.file);
  if (!file) return false;
  return parseHeadLines(file.patch).has(finding.line);
}

// ---------------------------------------------------------------------------
// Context extraction for the verifier (consumed in Wave 5b)
// ---------------------------------------------------------------------------

/**
 * Builds the `{codeBefore, codeAfter, diffAtAnchor?}` triple Wave 5b's
 * auto-resolve verifier consumes for a single finding, pulled out of the
 * unified-diff hunk that touches the finding's line.
 *
 * Works entirely from the in-hand patch — no fresh API calls. The patch
 * already encodes BEFORE (lines with `-` or context) and AFTER (lines with
 * `+` or context) for every hunk the PR touches.
 *
 * Returns empty strings for `codeBefore`/`codeAfter` when the finding's
 * file isn't in the diff at all. The verifier sees "unchanged" and
 * typically returns NOT_ADDRESSED / UNCERTAIN, which is the correct
 * behavior — an unchanged file isn't a fix.
 */
export function extractAnchorContext(
  finding: { file?: string; line?: number },
  diffFiles: ReadonlyArray<DiffFile>,
): { codeBefore: string; codeAfter: string; diffAtAnchor?: string } {
  if (!finding.file || !finding.line) {
    return { codeBefore: '', codeAfter: '' };
  }
  const file = diffFiles.find((f) => f.filename === finding.file);
  if (!file || !file.patch) {
    return { codeBefore: '', codeAfter: '' };
  }

  // Locate the hunk whose new-side range contains finding.line.
  const hunkHeaderRe = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;
  const patchLines = file.patch.split('\n');
  let currentHunkStart = -1;

  for (let i = 0; i < patchLines.length; i++) {
    const m = patchLines[i]!.match(hunkHeaderRe);
    if (!m) continue;
    const newStart = Number.parseInt(m[3]!, 10);
    const newLen = m[4] !== undefined ? Number.parseInt(m[4]!, 10) : 1;
    if (
      finding.line >= newStart &&
      finding.line < newStart + Math.max(newLen, 1)
    ) {
      currentHunkStart = i;
      break;
    }
  }

  if (currentHunkStart < 0) {
    return { codeBefore: '', codeAfter: '' };
  }

  const before: string[] = [];
  const after: string[] = [];
  const hunkBody: string[] = [patchLines[currentHunkStart]!];

  for (let i = currentHunkStart + 1; i < patchLines.length; i++) {
    const line = patchLines[i]!;
    if (line.match(hunkHeaderRe)) break;
    hunkBody.push(line);

    if (line.startsWith('+') && !line.startsWith('+++')) {
      after.push(line.slice(1));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      before.push(line.slice(1));
    } else if (line.startsWith('\\')) {
      // No-newline marker — skip.
    } else if (line.length > 0) {
      // Context line — appears on both sides.
      const stripped = line.startsWith(' ') ? line.slice(1) : line;
      before.push(stripped);
      after.push(stripped);
    }
  }

  return {
    codeBefore: before.join('\n'),
    codeAfter: after.join('\n'),
    diffAtAnchor: hunkBody.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Comment body rendering
// ---------------------------------------------------------------------------

/**
 * Body for a single inline-thread comment. Includes a hidden HTML marker
 * carrying `findingId` so Wave 5b's auto-resolve can recover the canonical
 * id from the thread's first comment body without persisting state.
 */
export function renderThreadBody(finding: FindingForThread): string {
  const id = findingId(finding);
  const severityBadge = finding.severity === 'critical' ? '🔴' : '🟡';
  const header = `${severityBadge} \`${finding.skill}\``;
  const body = finding.summary.trim();
  const reasoning = finding.reasoning ? `\n\n${finding.reasoning.trim()}` : '';
  return `<!-- finding-id: ${id} -->\n${header}\n\n${body}${reasoning}`;
}

/**
 * Extracts the hashed `findingId` from a thread comment body that was
 * rendered by `renderThreadBody`. Returns null when the marker is absent
 * (a manual reply, or a comment posted by a different tool).
 *
 * Used by Wave 5b's auto-resolve to re-derive finding ids from existing
 * GitHub threads on a stateless re-run.
 */
export function extractFindingIdFromBody(body: string): string | null {
  // Anchor to start-of-string so a user reply that quotes the marker can't be
  // misattributed as bot-authored. `renderThreadBody` always places the marker
  // on line 1 — anything else is suspect input.
  const m = body.match(/^<!--\s*finding-id:\s*([a-f0-9]{16})\s*-->/);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// Inline-thread posting plan
// ---------------------------------------------------------------------------

/**
 * One entry in the createReview `comments[]` array. Matches GitHub's REST
 * shape exactly so callers can JSON.stringify directly into a `gh api` body.
 */
export interface InlineCommentPlan {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

export interface PlanInlineThreadsResult {
  /** Comment entries for the createReview `comments[]` field. */
  comments: InlineCommentPlan[];
  /** Findings the diff couldn't anchor (file or line not in any hunk). */
  skipped: FindingForThread[];
  /** Findings filtered out because severity is 'preexisting' (informational only). */
  preexisting: FindingForThread[];
}

/**
 * Partitions a flat findings list into the `comments[]` body for
 * `POST /repos/:owner/:repo/pulls/:n/reviews` + the findings the caller
 * should surface elsewhere (summary comment for `skipped`; never for
 * `preexisting`).
 *
 * Pure function — no I/O. The CLI verb uses this to compute the API body;
 * the App can use it after Wave 5c migration to share the same partitioning.
 */
export function planInlineThreads(
  findings: ReadonlyArray<FindingForThread>,
  diffFiles: ReadonlyArray<DiffFile>,
): PlanInlineThreadsResult {
  const comments: InlineCommentPlan[] = [];
  const skipped: FindingForThread[] = [];
  const preexisting: FindingForThread[] = [];

  for (const f of findings) {
    if (f.severity === 'preexisting') {
      preexisting.push(f);
      continue;
    }
    if (!findingAnchorable(f, diffFiles)) {
      skipped.push(f);
      continue;
    }
    comments.push({
      path: f.file!,
      line: f.line!,
      side: 'RIGHT',
      body: renderThreadBody(f),
    });
  }

  return { comments, skipped, preexisting };
}

// ---------------------------------------------------------------------------
// GraphQL operations — pinned to module scope so callers (and tests) can
// reference the same query strings as the App.
// ---------------------------------------------------------------------------

export const REVIEW_THREADS_QUERY = `
  query ReviewThreads($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes {
                databaseId
                path
                line
                originalLine
                body
              }
            }
          }
        }
      }
    }
  }
`;

// Includes `body` (unlike the App's lighter state query, which omits it) so
// Wave 5b's auto-resolve can re-derive the `findingId` from the
// `<!-- finding-id: ... -->` marker on each thread's first comment WITHOUT
// persisting state between fix-pushes. The npm workflow is stateless; the
// body field is the substitute for Redis-backed thread-id correlation.
export const REVIEW_THREADS_STATE_QUERY = `
  query ReviewThreadStates($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes {
                databaseId
                body
              }
            }
          }
        }
      }
    }
  }
`;

export const RESOLVE_THREAD_MUTATION = `
  mutation ResolveThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        isResolved
      }
    }
  }
`;
