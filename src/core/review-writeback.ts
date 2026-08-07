// SPEC §1.8.1 doc-file renderer for `docs/reviews/PR-<n>.md`.
//
// This is the PURE rendering half of the App's `lib/review-writeback.ts`.
// The Octokit-side WRITEBACK (branch detection, idempotent rewrite,
// Contents-API commit) stays App-side — that surface depends on Octokit
// which we don't want to pull into core.
//
// Renamed from the App's `renderReview` to `renderReviewFile` to avoid
// colliding with the CLI's existing `renderReview` (which renders the
// summary-PR-comment shape, not the doc-file). Both renderers coexist:
//   - `renderReview` (./render-review.ts) → `## 🐛 Clud Bug review` PR comment
//   - `renderReviewFile` (this module)    → `# clud-bug review — PR #N` doc file
//
// SPEC pins honored here:
//   - `<!-- spec-version: 2.0.0 -->`                 — SPEC §4.3: "the version
//     of this document the producer implements". Sourced from `SPEC_VERSION`
//     (./spec-version.ts), never a local literal.
//   - `<!-- written-by: clud-bug[bot] -->`           — App identity, not Action.
//   - `<!-- review-sha: <40-char-head-sha> -->`      — pinned to review-time HEAD.
//   - Severity bucket order: red → yellow → purple.
//   - Empty buckets omitted entirely (no empty headers).
//   - "Resolved this round:" and "Still open:" blocks omitted when empty
//     (D.2.0 always omits — multi-pass is D.2.5).
//   - Trailing `---\n[Link to PR](<url>)` line preserved verbatim.
//   - Emoji codepoints: U+1F534, U+1F7E1, U+1F7E3, NFC-normalized.

import {
  deriveSkillsReferenced,
  deriveSummaryCounts,
  flattenFindings,
  type Finding,
  type Review,
} from './review-schema-zod.js';
import { SPEC_VERSION } from './spec-version.js';

export { SPEC_VERSION };

/**
 * @deprecated Use `SPEC_VERSION`. Retained as an alias because this name is a
 * public export of `clud-bug/core` and the App re-exports it; removing it
 * would break the consumer at the version-skew boundary rather than at a
 * coordinated bump (SPEC §7.5: a surface on its way out "MUST keep working
 * until a major version removes it", naming what replaces it).
 *
 * It used to read '0.1.0' — a value that matched no version of the document.
 */
export const PROTOCOL_VERSION = SPEC_VERSION;

/** "Written by" tag for the App writeback (SPEC §6.1). */
export const WRITTEN_BY = 'clud-bug[bot]';

// Severity emoji per SPEC §1.8.1. We define them by codepoint so a stray
// editor that switches encoding can't silently break byte-equality with
// the Action-runner output. Same constants as render-review.ts but kept
// local so this module is independent of the CLI renderer.
export const SEVERITY_EMOJI = {
  critical: '\u{1F534}', // U+1F534 RED CIRCLE
  minor: '\u{1F7E1}', // U+1F7E1 YELLOW CIRCLE
  preexisting: '\u{1F7E3}', // U+1F7E3 PURPLE CIRCLE
} as const;

/**
 * One parsed finding suitable for the SPEC §1.8.1 Resolved / Still-open
 * blocks. Mirrors `ParsedFinding` from `./diff-findings.ts`; declared
 * here as a structural interface (not re-imported) so callers without
 * `diff-findings` in scope can still construct the input.
 */
export interface RenderedFindingRef {
  file: string;
  line: number;
  severity: 'critical' | 'minor' | 'preexisting';
  skillName: string;
  summary: string;
}

/**
 * SPEC §6.7.3 cache telemetry — per-invocation token counts from the
 * Anthropic-family `usage` block. When present, the renderer emits a
 * `<!-- cache: ... -->` HTML comment immediately below the
 * `<!-- review-sha: ... -->` metadata line so downstream cost analysis
 * tooling can audit cache behaviour from the committed doc-file.
 */
export interface CacheStats {
  /** `cache_read_input_tokens` from the Anthropic usage block. */
  cachedInputTokens: number;
  /** `cache_creation_input_tokens` from the Anthropic usage block. */
  cacheCreationInputTokens: number;
}

export interface RenderReviewFileInput {
  review: Review;
  prNumber: number;
  /** 40-char head SHA. Pinned to `<!-- review-sha: ... -->`. */
  headSha: string;
  /** GitHub PR URL — appended verbatim to the trailing rule. */
  prUrl: string;
  /**
   * Findings present in the prior `docs/reviews/PR-<n>.md` that are NOT
   * present in this round's `review`. When non-empty, emits the SPEC
   * §1.8.1 `**Resolved this round:**` block AFTER the severity buckets
   * and BEFORE the trailing `---` separator. Omitted entirely when
   * empty/undefined (SPEC §1.8.1: blocks MUST be omitted when empty).
   *
   * Produced by `diffFindings()` from `./diff-findings.ts`.
   */
  resolvedFindings?: RenderedFindingRef[];
  /**
   * Findings present in BOTH the prior `docs/reviews/PR-<n>.md` AND
   * this round's `review` — the persistent ones. When non-empty, emits
   * the SPEC §1.8.1 `**Still open:**` block AFTER `**Resolved this
   * round:**` and before the trailing `---` separator. Omitted entirely
   * when empty/undefined.
   *
   * Produced by `diffFindings()` from `./diff-findings.ts`.
   */
  stillOpenFindings?: RenderedFindingRef[];
  /**
   * SPEC §6.7.3 cache telemetry. When present, emits a
   * `<!-- cache: <read> read · <created> created -->` HTML comment
   * immediately below the `<!-- review-sha: ... -->` metadata line.
   * Omitted entirely when undefined (this comment is OPTIONAL per the
   * SPEC, but SHOULD be implemented for cost-analysis tooling).
   */
  cacheStats?: CacheStats;
}

/**
 * Renders the review object to the SPEC §1.8.1 markdown template.
 *
 * Pure: no I/O, no time-of-day, no provider info — fixture-stable.
 *
 * NB: This produces the doc-file shape (`# clud-bug review — PR #N` H1).
 * The CLI's `renderReview` produces the PR-comment shape (`## 🐛 Clud Bug
 * review` H2). Both are valid review outputs; SPEC §6.2 says they share
 * the underlying finding data but differ in container.
 */
export function renderReviewFile(input: RenderReviewFileInput): string {
  const {
    review,
    prNumber,
    headSha,
    prUrl,
    resolvedFindings,
    stillOpenFindings,
    cacheStats,
  } = input;
  // Wire-shape Review carries findings in 3 severity arrays. Flatten to
  // internal `Finding[]` so the renderer's bucketing, count-derivation,
  // and per-skill aggregation can work uniformly.
  const findings = flattenFindings(review);

  // Always derive these from findings to guarantee they match what we
  // actually render. The model can drift on counts; we don't trust it.
  const counts = deriveSummaryCounts(findings);
  const skillsReferenced = deriveSkillsReferenced(findings);

  const lines: string[] = [];

  lines.push(`# clud-bug review — PR #${prNumber}`);
  // SPEC §4.3 names this marker `spec-version`, not `protocol-version`.
  lines.push(`<!-- spec-version: ${SPEC_VERSION} -->`);
  lines.push(`<!-- written-by: ${WRITTEN_BY} -->`);
  lines.push(`<!-- review-sha: ${headSha} -->`);
  // SPEC §6.7.3: cache telemetry comment goes immediately below the
  // review-sha so a single grep can pull review-sha + cache stats out
  // of a doc-file without re-parsing the whole block. Omitted entirely
  // when cacheStats is undefined.
  if (cacheStats !== undefined) {
    lines.push(
      `<!-- cache: ${cacheStats.cachedInputTokens} read · ${cacheStats.cacheCreationInputTokens} created -->`,
    );
  }
  lines.push('');

  // Summary line — SPEC §1.8.1 wording.
  lines.push(
    `**Summary:** ${counts.critical} critical · ${counts.minor} minor · ${counts.preexisting} preexisting · ${counts.resolved_from_prior} resolved-from-prior · ${counts.still_open} still-open`,
  );
  lines.push('');

  // Skills cited block — group findings per skill for citation counts.
  lines.push('**Skills cited:**');
  if (skillsReferenced.length === 0) {
    lines.push('- _(none — see summary above)_');
  } else {
    for (const slug of skillsReferenced) {
      const count = findings.filter((f) => f.skill === slug).length;
      lines.push(`- ${slug} (${count} finding${count === 1 ? '' : 's'})`);
    }
  }
  lines.push('');

  lines.push('**Findings:**');
  lines.push('');

  // Severity buckets in SPEC order; empty buckets are omitted entirely.
  const bucketed = bucketBySeverity(findings);
  if (bucketed.critical.length > 0) {
    lines.push(`### ${SEVERITY_EMOJI.critical} Critical`);
    for (const f of bucketed.critical) lines.push(renderFinding(f, true));
    lines.push('');
  }
  if (bucketed.minor.length > 0) {
    lines.push(`### ${SEVERITY_EMOJI.minor} Minor`);
    for (const f of bucketed.minor) lines.push(renderFinding(f, false));
    lines.push('');
  }
  if (bucketed.preexisting.length > 0) {
    lines.push(`### ${SEVERITY_EMOJI.preexisting} Preexisting (informational)`);
    for (const f of bucketed.preexisting) lines.push(renderFinding(f, false));
    lines.push('');
  }

  // SPEC §1.8.1 Resolved this round / Still open blocks. Omitted
  // entirely when the corresponding input list is empty/undefined.
  //
  // Bullet shape (one finding per line):
  //   - `path/file.ts:42` — `critical-issues-only`: null-deref ... (was 🔴 Critical)
  //
  // The `(was <emoji> <Severity>)` suffix carries the SEVERITY at the
  // time the finding was last seen so a downgrade across rounds is
  // visible without diffing the two doc files. Note: backticks around
  // file and skill render in markdown viewers as inline-code, which
  // makes the file path scannable in the GitHub UI.
  if (resolvedFindings !== undefined && resolvedFindings.length > 0) {
    lines.push('**Resolved this round:**');
    for (const f of resolvedFindings) {
      lines.push(renderDiffFinding(f));
    }
    lines.push('');
  }
  if (stillOpenFindings !== undefined && stillOpenFindings.length > 0) {
    lines.push('**Still open:**');
    for (const f of stillOpenFindings) {
      lines.push(renderDiffFinding(f));
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`[Link to PR](${prUrl})`);

  // Final NFC normalization — guarantees the emoji codepoints stay
  // composed even if a future renderer step decomposes them.
  return lines.join('\n').normalize('NFC') + '\n';
}

function bucketBySeverity(findings: Finding[]): Record<
  'critical' | 'minor' | 'preexisting',
  Finding[]
> {
  return {
    critical: findings.filter((f) => f.severity === 'critical'),
    minor: findings.filter((f) => f.severity === 'minor'),
    preexisting: findings.filter((f) => f.severity === 'preexisting'),
  };
}

/**
 * Renders one finding for the SPEC §1.8.1 Resolved / Still-open blocks.
 * Output shape:
 *
 *   - `path/file.ts:42` — `critical-issues-only`: null-deref ... (was 🔴 Critical)
 *
 * Line `0` is treated as "no anchor" (cross-cutting / missing) and the
 * `:N` suffix is omitted. The severity label uses the SPEC §1.8.1
 * emoji + label so a reader can see at a glance whether the finding
 * was downgraded (different severity in current round) or merely
 * resolved.
 */
function renderDiffFinding(f: RenderedFindingRef): string {
  const location = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  const label =
    f.severity === 'critical'
      ? 'Critical'
      : f.severity === 'minor'
        ? 'Minor'
        : 'Preexisting';
  const emoji = SEVERITY_EMOJI[f.severity];
  return `- \`${location}\` — \`${f.skillName}\`: ${f.summary} (was ${emoji} ${label})`;
}

function renderFinding(f: Finding, includeReasoning: boolean): string {
  // findingItemSchema.file is z.string().optional() — the model is
  // instructed to always provide it, but Zod doesn't enforce. Without
  // the fallback an absent file would emit literal "undefined" in the
  // committed SPEC §1.8.1 doc file. clud-bug-review #158 flagged this.
  const fileLabel = f.file ?? '(unknown file)';
  const location = f.line ? `${fileLabel}:${f.line}` : fileLabel;
  // Per SPEC §1.8.1: "**<file>:<line>** — <skill-name>: <one-line summary>".
  const head = `- **${location}** — ${f.skill}: ${f.summary}`;
  // Reasoning line is documented for the Critical bucket; we follow the
  // SPEC template strictly. For Minor/Preexisting, no reasoning line.
  if (includeReasoning && f.reasoning) {
    return `${head}\n  Reasoning: ${f.reasoning}`;
  }
  return head;
}

// ---------------------------------------------------------------------------
// D.2.5 multi-pass renderer
// ---------------------------------------------------------------------------

/**
 * Provenance label for a single finding's attribution from one pass.
 * Mirrors the App's `PassSource` discriminator.
 *
 * `mode === 'cross-check'`:
 *   - 'first'       → finding raised by Pass 1
 *   - 'agreed'      → later pass agreed
 *   - 'disagreed'   → later pass disagreed
 *   - 'independent' → later pass surfaced this finding independently
 *
 * `mode === 'consensus'`:
 *   - 'first'        → finding tuple unique to Pass 1
 *   - 'independent'  → finding tuple unique to Pass N (N > 1)
 *   - 'agreed'       → finding tuple appeared in 2+ passes (consensus)
 */
export type PassSource = 'first' | 'agreed' | 'disagreed' | 'independent';

export interface PassAttribution {
  /** 1-indexed pass number — matches the spec's "[Pass N]" label. */
  passNumber: number;
  /** Role display name, e.g. "Beetle". */
  roleName: string;
  /** Model slug for this pass — used by the renderer for the "· Sonnet 4.6" tail. */
  model: string;
  /** Provenance — see PassSource doc. */
  source: PassSource;
  /** Optional one-line note from the pass, e.g. cross-check rationale. */
  note?: string;
}

/**
 * SPEC §6.10.1 consensus marker, derived from a finding's per-pass attributions
 * by the aggregator's `deriveConsensus`. Defined here — the canonical home of
 * the unified-finding shape — so it rides on `MultiPassReview.findings`.
 *
 * - `1-of-N` — single pass produced this finding; no consensus reached.
 *   §6.10.2 MUST NOT fire auto-fix on these.
 * - `2-of-2` — two passes independently produced an equivalent finding.
 *   Qualifies for auto-fix per §6.10.2.
 * - `arbitrated` — passes disagreed; an arbiter resolved the dispute. Today's
 *   cross-check shape treats `arbitrated` as NOT-qualifying (conservative).
 */
export type Consensus = '1-of-N' | '2-of-2' | 'arbitrated';

export interface UnifiedFinding extends Finding {
  /** One PassAttribution per pass involved with this finding. Order: by passNumber. */
  attributions: PassAttribution[];
  /**
   * SPEC §6.10.1 consensus verdict. Stamped by the aggregator's `finalize()`
   * from `deriveConsensus(attributions)`. Optional: single-pass / non-aggregated
   * findings omit it; consumers treat absence as '1-of-N' (the auto-fix gate
   * default — see clud-bug-app/lib/auto-fix-policy.ts).
   */
  consensus?: Consensus;
}

/** Effective resolution verdict the multi-pass orchestrator emits. */
export type MultiPassVerdict = 'request_changes' | 'review_only' | 'clean';

/** Effective multi-pass mode. */
export type ReviewPassMode = 'cross-check' | 'consensus' | 'independent';

export interface MultiPassReview {
  /** Status header — derived from aggregated findings + mode resolution rules. */
  status_header: Review['status_header'];
  /** Summary counts, derived from the unified findings list. */
  summary_counts: Review['summary_counts'];
  /** Skills cited at least once across any pass. */
  skills_referenced: string[];
  /** Unified findings, with per-pass attribution. */
  findings: UnifiedFinding[];
  /** Effective mode (for the renderer's "(N passes · mode)" header line). */
  mode: ReviewPassMode;
  /** Number of passes that actually ran. */
  passCount: number;
  /** Role labels per pass, parallel to passCount. Used by the renderer. */
  roles: Array<{ passNumber: number; roleName: string; model: string }>;
  /** Resolution verdict — see App's multi-pass-aggregator for derivation. */
  verdict: MultiPassVerdict;
}

export interface RenderMultiPassMarkdownInput {
  review: MultiPassReview;
  prNumber: number;
  /** 40-char head SHA. Pinned to `<!-- review-sha: ... -->`. */
  headSha: string;
  /** GitHub PR URL — appended verbatim to the trailing rule. */
  prUrl: string;
}

/**
 * Renders a multi-pass review with per-pass attribution lines.
 *
 * Output layout (SPEC §1.8.5):
 *
 *   # clud-bug review — PR #N (M passes · mode)
 *   <!-- spec-version: ... -->
 *   <!-- written-by: clud-bug[bot] -->
 *   <!-- review-sha: ... -->
 *   <!-- passes: M -->
 *   <!-- mode: cross-check|consensus|independent -->
 *
 *   **Summary:** ... · **Verdict:** request_changes / review_only / clean
 *
 *   **Reviewers:**
 *     - Pass 1 — Beetle · anthropic/claude-sonnet-4.6
 *     - Pass 2 — Wasp   · anthropic/claude-opus-4.7
 *
 *   **Skills cited:** ...
 *
 *   **Findings:**
 *
 *   ### (red) Critical
 *   - [Pass 1 — Beetle · Sonnet 4.6] auth.ts:42 — race-conditions: Race condition
 *     Reasoning: ...
 *     [Pass 2 — Wasp · Opus 4.7]: (check) AGREED — same finding identified independently.
 *
 *   ...
 *
 *   ---
 *   [Link to PR](...)
 *
 * Pure: no I/O, no time-of-day, fixture-stable.
 */
export function renderMultiPassMarkdown(
  input: RenderMultiPassMarkdownInput,
): string {
  const { review, prNumber, headSha, prUrl } = input;
  const lines: string[] = [];

  lines.push(
    `# clud-bug review — PR #${prNumber} (${review.passCount} ${
      review.passCount === 1 ? 'pass' : 'passes'
    } · ${review.mode})`,
  );
  // SPEC §4.3 names this marker `spec-version`, not `protocol-version`.
  lines.push(`<!-- spec-version: ${SPEC_VERSION} -->`);
  lines.push(`<!-- written-by: ${WRITTEN_BY} -->`);
  lines.push(`<!-- review-sha: ${headSha} -->`);
  lines.push(`<!-- passes: ${review.passCount} -->`);
  lines.push(`<!-- mode: ${review.mode} -->`);
  lines.push('');

  const counts = review.summary_counts;
  lines.push(
    `**Summary:** ${counts.critical} critical · ${counts.minor} minor · ${counts.preexisting} preexisting · ${counts.resolved_from_prior} resolved-from-prior · ${counts.still_open} still-open · **Verdict:** ${review.verdict}`,
  );
  lines.push('');

  lines.push('**Reviewers:**');
  for (const r of review.roles) {
    lines.push(`- Pass ${r.passNumber} — ${r.roleName} · ${r.model}`);
  }
  lines.push('');

  lines.push('**Skills cited:**');
  if (review.skills_referenced.length === 0) {
    lines.push('- _(none — see summary above)_');
  } else {
    for (const slug of review.skills_referenced) {
      const count = review.findings.filter((f) => f.skill === slug).length;
      lines.push(`- ${slug} (${count} finding${count === 1 ? '' : 's'})`);
    }
  }
  lines.push('');

  lines.push('**Findings:**');
  lines.push('');

  // Severity buckets in SPEC order; empty buckets are omitted entirely.
  const bucketed = bucketUnifiedBySeverity(review.findings);
  if (bucketed.critical.length > 0) {
    lines.push(`### ${SEVERITY_EMOJI.critical} Critical`);
    for (const f of bucketed.critical)
      lines.push(renderUnifiedFinding(f, /* includeReasoning */ true));
    lines.push('');
  }
  if (bucketed.minor.length > 0) {
    lines.push(`### ${SEVERITY_EMOJI.minor} Minor`);
    for (const f of bucketed.minor) lines.push(renderUnifiedFinding(f, false));
    lines.push('');
  }
  if (bucketed.preexisting.length > 0) {
    lines.push(`### ${SEVERITY_EMOJI.preexisting} Preexisting (informational)`);
    for (const f of bucketed.preexisting)
      lines.push(renderUnifiedFinding(f, false));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`[Link to PR](${prUrl})`);

  return lines.join('\n').normalize('NFC') + '\n';
}

function bucketUnifiedBySeverity(findings: UnifiedFinding[]): Record<
  'critical' | 'minor' | 'preexisting',
  UnifiedFinding[]
> {
  return {
    critical: findings.filter((f) => f.severity === 'critical'),
    minor: findings.filter((f) => f.severity === 'minor'),
    preexisting: findings.filter((f) => f.severity === 'preexisting'),
  };
}

/**
 * Renders one finding with inline per-pass attribution. The headline carries
 * the FIRST attribution (whichever pass raised the issue); subsequent
 * attributions appear on indented sub-lines:
 *
 *   - [Pass 1 — Beetle · sonnet] auth.ts:42 — race: Race condition
 *     Reasoning: ...
 *     [Pass 2 — Wasp · opus]: (check) AGREED — confirmed by independent review.
 *     [Pass 3 — Mantis · opus]: (x) DISAGREED — guarded by the surrounding lock.
 *
 * The headline always tracks the FIRST attribution to preserve the SPEC
 * §1.8.1 grep pattern (`**<file>:<line>** — <skill>: <summary>`).
 */
function renderUnifiedFinding(
  f: UnifiedFinding,
  includeReasoning: boolean,
): string {
  // Same guard as renderFinding — findingItemSchema.file is optional.
  const fileLabel = f.file ?? '(unknown file)';
  const location = f.line ? `${fileLabel}:${f.line}` : fileLabel;
  const head = f.attributions[0];
  if (!head) {
    // Defensive — shouldn't happen; the aggregator guarantees ≥1 attribution.
    return `- **${location}** — ${f.skill}: ${f.summary}`;
  }
  const headLabel = formatAttributionLabel(head);
  const lines: string[] = [];
  // SPEC §6.8.1 (NORMATIVE for multi-pass): a per-finding pass-attribution HTML
  // comment immediately preceding the bullet, naming the originating pass as a
  // stable lowercase identifier so consumers can aggregate per-pass metrics.
  lines.push(`<!-- pass: ${passIdentifier(head.roleName)} -->`);
  // SPEC §6.10.1 (NORMATIVE for gated reviewers): the consensus marker alongside
  // the pass attribution, when the finding carries a consensus verdict.
  if (f.consensus) {
    lines.push(`<!-- consensus: ${f.consensus} -->`);
  }
  lines.push(`- ${headLabel} **${location}** — ${f.skill}: ${f.summary}`);
  if (includeReasoning && f.reasoning) {
    lines.push(`  Reasoning: ${f.reasoning}`);
  }
  for (let i = 1; i < f.attributions.length; i++) {
    const a = f.attributions[i];
    if (!a) continue;
    lines.push(`  ${formatFollowupAttribution(a)}`);
  }
  return lines.join('\n');
}

/**
 * The leading bracket on the head line. Example:
 *
 *   [Pass 1 — Beetle · anthropic/claude-sonnet-4.6]
 *   [Pass 2 — Wasp · anthropic/claude-opus-4.7 — found independently]
 *
 * "found independently" only fires when the head attribution is NOT
 * `source: 'first'` — i.e. when a later pass surfaced this finding without
 * Pass 1 raising it.
 */
/** SPEC §6.8.1 pass identifier: a stable lowercase slug of the role name. */
function passIdentifier(roleName: string): string {
  return roleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatAttributionLabel(a: PassAttribution): string {
  const independent =
    a.source === 'independent' && a.passNumber > 1
      ? ' — found independently'
      : '';
  return `[Pass ${a.passNumber} — ${a.roleName} · ${a.model}${independent}]`;
}

/**
 * Subsequent-line attribution. Example:
 *
 *   [Pass 2 — Wasp · opus]: ✅ AGREED — confirmed.
 *   [Pass 3 — Mantis · opus]: ❌ DISAGREED — guarded by surrounding lock.
 */
function formatFollowupAttribution(a: PassAttribution): string {
  const verdictSymbol =
    a.source === 'agreed'
      ? '✅ AGREED' // U+2705 WHITE HEAVY CHECK MARK
      : a.source === 'disagreed'
        ? '❌ DISAGREED' // U+274C CROSS MARK
        : a.source === 'independent'
          ? 'INDEPENDENTLY FLAGGED'
          : 'NOTED';
  const note = a.note ? ` — ${a.note}` : '';
  const disputed = a.source === 'disagreed' ? ' (Disputed — human decides.)' : '';
  return `[Pass ${a.passNumber} — ${a.roleName} · ${a.model}]: ${verdictSymbol}${note}${disputed}`;
}

/** SPEC §6.1 / §1.8 path. The App's Octokit writeback uses this. */
export function reviewFilePath(prNumber: number): string {
  return `docs/reviews/PR-${prNumber}.md`;
}

/**
 * SPEC §6.1 commit message: exactly `[skip-logmind] clud-bug review: PR #<n>`.
 * The `[skip-logmind]` prefix tells `check-decisions.yml` to ignore this
 * commit (SPEC §6.4). The App's Octokit writeback uses this.
 */
export function reviewCommitMessage(prNumber: number): string {
  return `[skip-logmind] clud-bug review: PR #${prNumber}`;
}
