// Phase Z3 — the notary's DETERMINISTIC validators (③ coverage · ④ grounding ·
// ⑤ consistency). Pure, no LLM, ~free (protocol SPEC §10.3.3).
//
// These run in TWO places: LOCALLY during a `clud-bug` run (fast context for the
// max-mode agent + a pre-checked bundle) and AUTHORITATIVELY on the server
// (Z4's `/notarize`, re-run against GitHub's ground-truth diff — local is
// patchable, so it's never authoritative alone). Both call the SAME functions
// here; only the diff source differs.
//
// What is (and isn't) provable deterministically:
//   ⑤ consistency — verdict ⟺ findings. Fully decidable.
//   ④ grounding   — a `quote`-form critical's span MUST appear in the diff; a
//                   critical with NO evidence is rejected. `reproduction`/
//                   `invariant` criticals carry no diff-checkable artifact →
//                   accepted-but-flagged for the clean-case audit (accepting a
//                   critical is the SAFE direction — it blocks).
//   ③ coverage    — every changed file is present in the review's coverage claim
//                   (no silently-skipped file). Note: whether the review truly
//                   *looked* at a clean hunk is NOT attestable — that's the
//                   theorem, handled by the audit, not here.

import { parseHeadLines, type DiffFile } from './inline-threads.js';
import type { ReviewVerdict } from './check-verdict.js';
import type { NotaryBundle, NotaryFinding } from './notary-bundle.js';

// ---------------------------------------------------------------------------
// ⑤ consistency — verdict ⟺ findings
// ---------------------------------------------------------------------------

export interface ConsistencyResult {
  ok: boolean;
  reason?: string;
}

/**
 * A `clean` verdict with a critical finding, or a `critical` verdict with none,
 * is internally contradictory — the review can't be trusted, so it can't gate.
 * `unverified` and `failed` are self-consistent regardless of the finding set
 * (they never claim "clean"), so they always pass ⑤.
 */
export function validateConsistency(
  verdict: ReviewVerdict,
  findings: readonly NotaryFinding[],
): ConsistencyResult {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  if (verdict === 'clean' && criticalCount > 0) {
    return { ok: false, reason: `verdict 'clean' but ${criticalCount} critical finding(s) present` };
  }
  if (verdict === 'critical' && criticalCount === 0) {
    return { ok: false, reason: `verdict 'critical' but no critical findings` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ③ coverage — every changed file addressed
// ---------------------------------------------------------------------------

export interface CoverageResult {
  ok: boolean;
  /** Changed files present in the ground-truth diff but absent from the coverage claim. */
  missingFiles: string[];
}

/**
 * The review's coverage claim MUST include every file the ground-truth diff
 * changed. A missing file = a silently-skipped surface → the review can't be
 * certified as complete. Extra claimed files (not in the diff) are harmless and
 * ignored. Empty diff → trivially covered.
 */
export function validateCoverage(
  coverage: readonly string[],
  diffFiles: readonly DiffFile[],
): CoverageResult {
  const claimed = new Set(coverage.map((f) => f.trim()).filter(Boolean));
  const missingFiles = diffFiles
    .map((f) => f.filename)
    .filter((name) => !claimed.has(name));
  return { ok: missingFiles.length === 0, missingFiles };
}

// ---------------------------------------------------------------------------
// ④ grounding — every 🔴 critical anchored to real evidence
// ---------------------------------------------------------------------------

export interface GroundingViolation {
  index: number;
  file?: string | undefined;
  line?: number | undefined;
  reason: string;
}

export interface GroundingResult {
  ok: boolean;
  /** Hard failures: a critical with no evidence, or a `quote` span not in the diff. */
  violations: GroundingViolation[];
  /**
   * Criticals whose grounding the deterministic notary CANNOT confirm
   * (`reproduction`/`invariant` form — no diff-checkable artifact). Not a
   * failure: accepting a critical blocks the merge, the safe direction. Surfaced
   * so the server can seed the clean-case audit / a human can scrutinize them.
   */
  unverifiable: GroundingViolation[];
}

/**
 * For every CRITICAL finding:
 *   - no `grounding` at all              → hard violation (no bare critical).
 *   - `quote` (or unspecified) grounding → the span MUST appear verbatim
 *     (whitespace-normalized) in an added/context line of its file's diff, else
 *     hard violation (a claimed quote that isn't in the diff is fabricated).
 *   - `reproduction`/`invariant`         → recorded as `unverifiable` (audit).
 * Minor/preexisting findings are not grounding-gated here.
 */
export function validateGrounding(
  findings: readonly NotaryFinding[],
  diffFiles: readonly DiffFile[],
): GroundingResult {
  const violations: GroundingViolation[] = [];
  const unverifiable: GroundingViolation[] = [];

  findings.forEach((f, index) => {
    if (f.severity !== 'critical') return;
    const span = (f.grounding ?? '').trim();
    if (!span) {
      violations.push({ index, file: f.file, line: f.line, reason: 'critical finding has no grounding' });
      return;
    }
    const kind = f.grounding_kind ?? 'quote';
    if (kind !== 'quote') {
      // No diff-checkable artifact — defer to the audit rather than reject.
      unverifiable.push({ index, file: f.file, line: f.line, reason: `grounded by ${kind} (not deterministically verifiable)` });
      return;
    }
    if (!f.file) {
      violations.push({ index, line: f.line, reason: 'quote-grounded critical has no file to anchor against' });
      return;
    }
    const file = diffFiles.find((d) => d.filename === f.file);
    if (!file || !file.patch) {
      violations.push({ index, file: f.file, line: f.line, reason: 'quote-grounded critical references a file not in the diff' });
      return;
    }
    if (!spanAppearsInDiff(span, file.patch)) {
      violations.push({ index, file: f.file, line: f.line, reason: 'grounding span not found in the diff' });
    }
  });

  return { ok: violations.length === 0, violations, unverifiable };
}

// ---------------------------------------------------------------------------
// whole-bundle validation
// ---------------------------------------------------------------------------

export interface BundleValidation {
  ok: boolean;
  coverage: CoverageResult;
  grounding: GroundingResult;
  consistency: ConsistencyResult;
}

/**
 * Run ③④⑤ over a bundle against a diff. `ok` is the AND of all three hard
 * checks (grounding's `unverifiable` list does not fail the bundle). The server
 * layers ① nonce + ② ground-truth-diff-fetch + the clean-case audit ON TOP of
 * this (Z4); this function is the shared deterministic core both sides call.
 */
export function validateBundle(
  bundle: NotaryBundle,
  diffFiles: readonly DiffFile[],
): BundleValidation {
  const coverage = validateCoverage(bundle.coverage, diffFiles);
  const grounding = validateGrounding(bundle.findings, diffFiles);
  const consistency = validateConsistency(bundle.verdict, bundle.findings);
  return {
    ok: coverage.ok && grounding.ok && consistency.ok,
    coverage,
    grounding,
    consistency,
  };
}

// ---------------------------------------------------------------------------
// diff helpers
// ---------------------------------------------------------------------------

/**
 * Whitespace-normalized substring match of a quoted span against the HEAD-side
 * (added + context) content of a unified-diff patch. Normalizing runs of
 * whitespace to a single space tolerates indentation/wrapping differences
 * between the agent's quote and the exact diff bytes, while still requiring the
 * actual tokens to be present (an attacker can't ground a span that isn't there).
 */
export function spanAppearsInDiff(span: string, patch: string): boolean {
  const needle = normalizeWhitespace(span);
  if (!needle) return false;
  return normalizeWhitespace(collectHeadSide(patch)).includes(needle);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The HEAD-side content of a patch: added (`+`) and context lines, prefix
 * stripped, joined by newlines. Mirrors `parseHeadLines`' notion of "on the new
 * side of the diff" but yields the CONTENT rather than the line numbers.
 */
function collectHeadSide(patch: string): string {
  const out: string[] = [];
  const hunkHeaderRe = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    if (hunkHeaderRe.test(raw)) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push(raw.slice(1));
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // LEFT-side only — not on the head side.
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — not content.
    } else {
      // Context line — appears on the head side.
      out.push(raw.startsWith(' ') ? raw.slice(1) : raw);
    }
  }
  return out.join('\n');
}

/**
 * Decode a path token from a diff header to its real string. Handles the two
 * ways git mangles a path: (a) a git-appended TRAILING TAB on an unquoted path
 * containing a space (`b/my file.ts\t`), and (b) a fully C-QUOTED path when it
 * has non-ASCII / control bytes (`"b/caf\303\251.ts"`, octal-escaped UTF-8).
 * Without this, such files silently vanish from the parsed diff — a
 * false-accept for coverage and a false-reject for a legitimately-grounded
 * critical. (Our own `git` calls also pass `-c core.quotepath=false`, but
 * `gh pr diff` and other sources can still quote, so the parser must be robust.)
 */
function unquoteGitPath(raw: string): string {
  // A git-appended trailing tab separates an unquoted path from following text.
  const s0 = raw.replace(/\t.*$/, '');
  if (!s0.startsWith('"')) return s0;
  const inner = s0.slice(1, s0.endsWith('"') ? -1 : s0.length);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c !== '\\') {
      for (const b of Buffer.from(c, 'utf8')) bytes.push(b);
      continue;
    }
    const next = inner[i + 1] ?? '';
    if (next >= '0' && next <= '7') {
      let oct = '';
      let j = i + 1;
      while (j < inner.length && oct.length < 3 && inner[j]! >= '0' && inner[j]! <= '7') {
        oct += inner[j];
        j++;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
      i = j - 1;
    } else {
      const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
      bytes.push(map[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The destination (`b/…`) path from a `diff --git <src> <dst>` line, quote-aware. */
function dstPathFromDiffGit(rest: string): string | undefined {
  if (rest.endsWith('"')) {
    // The dst is the trailing "…" token (may itself contain spaces/escapes).
    const m = rest.match(/"((?:[^"\\]|\\.)*)"$/);
    if (!m) return undefined;
    const unq = unquoteGitPath(`"${m[1]}"`);
    return unq.startsWith('b/') ? unq.slice(2) : unq;
  }
  const m = rest.match(/ b\/(.+)$/);
  return m ? m[1] : undefined;
}

/**
 * Split raw unified-diff text (`git diff` / `gh pr diff` output) into per-file
 * `{ filename, patch }` entries — the same shape `gh api .../pulls/{n}/files`
 * returns, so downstream validators are source-agnostic. Each `patch` is the
 * hunk region (from the first `@@` onward). Files with no hunk (pure
 * rename/mode/binary) yield `{ filename }` with no patch. Quote/tab-aware
 * (see `unquoteGitPath`) so non-ASCII and space-containing paths survive.
 */
export function splitUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!raw) return files;

  let filename: string | undefined;
  let body: string[] = [];
  let inHunk = false;

  const flush = () => {
    if (filename !== undefined) {
      files.push(body.length ? { filename, patch: body.join('\n') } : { filename });
    }
    filename = undefined;
    body = [];
    inHunk = false;
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      filename = dstPathFromDiffGit(line.slice('diff --git '.length));
      continue;
    }
    if (filename === undefined) continue;
    // The `+++ ` header is the most reliable filename (handles renames); skip
    // `/dev/null` (a deletion — keep the `diff --git` name).
    if (line.startsWith('+++ ')) {
      const p = line.slice('+++ '.length);
      if (p !== '/dev/null') {
        const unq = unquoteGitPath(p);
        filename = unq.startsWith('b/') ? unq.slice(2) : unq;
      }
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      body.push(line);
      continue;
    }
    if (inHunk) body.push(line);
  }
  flush();

  return files;
}

// Re-export the reused primitive so notary consumers have one import surface.
export { parseHeadLines };
