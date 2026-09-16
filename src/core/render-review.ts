// Render a clud-bug review's structured-output JSON to the GitHub-markdown
// summary comment shape the workflow has been posting since v0.6.5.
//
// 0.0.O (v0.6.22): introduced as the receiver for `--json-schema` output.
// The LLM emits structured JSON (one bundled string via the action's
// `outputs.structured_output`); a workflow post-step pipes that JSON to
// `clud-bug render --stdin` (CLI subcommand), which calls renderReview()
// here, then posts the result via `gh pr comment`. Failure mode: if
// `structured_output` is empty (max retries hit), the post-step is
// skipped and the LLM's prior free-form behaviour stands (it had already
// been instructed to post via `gh pr comment` directly as a fallback).
//
// Why an outside renderer at all: with --json-schema the LLM can no
// longer paraphrase the comment format (good for consistency, bad if the
// rendered shape is wrong). Centralising the markdown shape here means a
// future format tweak edits one function rather than the prompt.

import type {
  DedicatedSection,
  FindingSeverity,
  PerSkillScanItem,
  ReviewData,
  ReviewFinding,
  ReviewSummaryCounts,
} from './review-schema.js';
import { SPEC_VERSION } from './spec-version.js';

// Emoji constants: use explicit Unicode escape literals (`\u{HHHHH}`) so
// every step of the TS→JS toolchain — tsc, vitest's transformer, the
// publisher's tarball — emits the same byte sequence regardless of
// editor encoding settings. Per SPEC §6 byte-identical contract:
//   \u{1F534} = 🔴 (red circle, critical / "important")
//   \u{1F7E1} = 🟡 (yellow circle, minor / "nit")
//   \u{1F7E3} = 🟣 (purple circle, pre-existing)
//   \u{1F41B} = 🐛 (bug, H2 anchor for `## 🐛 Clud Bug review`)
const SEVERITY_EMOJI: Record<FindingSeverity, string> = {
  critical: '\u{1F534}',
  minor: '\u{1F7E1}',
  preexisting: '\u{1F7E3}',
};
const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: 'important',
  minor: 'nit',
  preexisting: 'pre-existing',
};
// SEVERITY_LABEL is retained for callers that import the constant table
// (the JS version exported it implicitly via module scope; keep the
// export so future renderer extensions can reuse it).
export { SEVERITY_LABEL };

// Renderer input type — schema-aligned but defensively typed. The renderer
// is the last line of defense against malformed JSON, so it accepts an
// "unknown-ish" shape and degrades gracefully rather than throwing on
// missing fields.
type RenderReviewInput = Partial<ReviewData> & Record<string, unknown>;

// clud-bug#256 gap B: the caller-supplied metadata SPEC §4.3 (SPEC.md:861-869)
// puts in the comment header. OPTIONAL — a caller with none of this yet
// (today: nothing, since renderReview has never taken a second argument)
// gets the pre-#256 H2 header and byte-identical output; the fixture corpus
// pins that. `verdict`/`independence` are separately optional WITHIN meta
// (clud-bug#256 ruling 4): the CLI render step doesn't know either one
// before the gate runs, and this renderer never invents them — each marker
// is emitted only when its field is present.
export interface RenderReviewMeta {
  /** Required whenever `meta` is passed — the H1 needs it. */
  prNumber: number;
  /** Defaults to `SPEC_VERSION` (./spec-version.ts) when meta is given without it. */
  specVersion?: string;
  writtenBy?: string;
  reviewSha?: string;
  verdict?: 'passing' | 'failing' | 'neutral';
  independence?: string;
}

export interface RenderReviewOptions {
  meta?: RenderReviewMeta;
}

// Render the full summary comment markdown. `data` is the parsed JSON
// matching the schema (see review-schema.ts). Returns a string suitable
// for `gh pr comment --body`. `opts.meta`, when given, switches the header
// to SPEC §4.3's shape (see RenderReviewMeta) — see renderHeaderBlock().
export function renderReview(
  data: RenderReviewInput | null | undefined,
  opts?: RenderReviewOptions,
): string {
  if (!data || typeof data !== 'object') {
    throw new TypeError('renderReview: data must be an object');
  }
  const meta = opts?.meta;
  const out: string[] = [];
  out.push(...(meta ? renderHeaderBlock(meta) : [renderHeader(data)]));
  out.push('');
  out.push(renderStatusLine(data.summary_counts));
  out.push('');
  out.push(renderStatsHeader(data.summary_counts));
  out.push('');
  out.push(...renderPerSkillScan(data.per_skill_scan));
  out.push('');
  for (const section of data.dedicated_sections || []) {
    out.push(...renderDedicatedSection(section));
    out.push('');
  }
  if (nonEmpty(data.critical_findings)) {
    out.push('### Critical findings');
    out.push('');
    out.push(...renderFindings(data.critical_findings, 'critical'));
    out.push('');
  }
  if (nonEmpty(data.minor_findings)) {
    out.push('### Minor findings');
    out.push('');
    out.push(...renderFindings(data.minor_findings, 'minor'));
    out.push('');
  }
  if (nonEmpty(data.preexisting_findings)) {
    out.push('### Pre-existing findings');
    out.push('');
    out.push(...renderFindings(data.preexisting_findings, 'preexisting'));
    out.push('');
  }
  if (nonEmpty(data.diagnostics)) {
    out.push('### Diagnostics');
    out.push('');
    for (const line of data.diagnostics) out.push(`- ${line}`);
    out.push('');
  }
  out.push(renderSkillsReferenced(data.skills_referenced));
  out.push('');
  // clud-bug#256 gap B: SPEC §4.3's `**Skills cited:**` block, ADDITIVE to
  // the existing "Skills referenced" line above (unchanged, meta or not —
  // the byte-identity fixture corpus pins it). Only emitted with meta, and
  // placed before last-reviewed-sha so that marker stays the final line in
  // every case (test/render-review.test.js pins it there).
  if (meta) {
    out.push(...renderSkillsCited(data));
    out.push('');
  }
  if (data.last_reviewed_sha) {
    out.push(`<!-- last-reviewed-sha: ${data.last_reviewed_sha} -->`);
  }
  // Trim trailing blank lines but always keep a single trailing newline so
  // the comment ends with a final newline (markdown rendering is unchanged
  // either way, but it matches the prior LLM-driven shape).
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

// SPEC §4.3 (SPEC.md:864-869) header block: H1 title + the five HTML-comment
// markers, in order. `verdict`/`independence` are each omitted when absent
// from `meta` (clud-bug#256 ruling 4 — never invented); `specVersion`
// defaults from SPEC_VERSION so its line is unconditional.
function renderHeaderBlock(meta: RenderReviewMeta): string[] {
  const out: string[] = [`# clud-bug review — PR #${meta.prNumber}`];
  out.push(`<!-- spec-version: ${meta.specVersion ?? SPEC_VERSION} -->`);
  if (meta.writtenBy) out.push(`<!-- written-by: ${meta.writtenBy} -->`);
  if (meta.reviewSha) out.push(`<!-- review-sha: ${meta.reviewSha} -->`);
  if (meta.verdict) out.push(`<!-- verdict: ${meta.verdict} -->`);
  if (meta.independence) out.push(`<!-- independence: ${meta.independence} -->`);
  return out;
}

// SPEC §4.3 `**Skills cited:**` block — same shape as review-writeback.ts's
// (renderReviewFile / renderMultiPassMarkdown): one bullet per skill in
// `skills_referenced` order, with its finding count across every bucket
// (including dedicated sections).
function renderSkillsCited(data: RenderReviewInput): string[] {
  const skills = Array.isArray(data.skills_referenced) ? data.skills_referenced : [];
  const out: string[] = ['**Skills cited:**'];
  if (skills.length === 0) {
    out.push('- _(none — see summary above)_');
    return out;
  }
  const all = collectAllFindings(data);
  for (const skill of skills) {
    const count = all.filter((f) => f && String(f.skill || '').trim() === skill).length;
    out.push(`- ${skill} (${count} finding${count === 1 ? '' : 's'})`);
  }
  return out;
}

function collectAllFindings(data: RenderReviewInput): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  if (Array.isArray(data.critical_findings)) out.push(...data.critical_findings);
  if (Array.isArray(data.minor_findings)) out.push(...data.minor_findings);
  if (Array.isArray(data.preexisting_findings)) out.push(...data.preexisting_findings);
  if (Array.isArray(data.dedicated_sections)) {
    for (const section of data.dedicated_sections) {
      if (section && Array.isArray(section.findings)) out.push(...section.findings);
    }
  }
  return out;
}

function renderHeader(data: RenderReviewInput): string {
  const verdict = data.status_header;
  const base = '## \u{1F41B} Clud Bug review';
  if (verdict === 'critical findings') return `${base} — critical findings`;
  if (verdict === 'clean') return `${base} — clean`;
  // 'bare' (non-strict-mode default) OR an unexpected verdict — render
  // the unsuffixed H2. Strict-mode gate's anchor stays intact either way.
  return base;
}

function renderStatusLine(counts: ReviewSummaryCounts | undefined): string {
  const c = sanitizeCounts(counts);
  return `**This round:** ${c.critical} critical · ${c.minor} minor · ${c.resolved_from_prior} resolved from prior · ${c.still_open} still open`;
}

// Severity-emoji stats header. Counts pre-existing in 🟣 even though
// it's not in summary_counts (the prompt counts pre-existing separately
// in preexisting_findings.length).
function renderStatsHeader(counts: ReviewSummaryCounts | undefined): string {
  const c = sanitizeCounts(counts);
  return `Found: ${c.critical} \u{1F534} / ${c.minor} \u{1F7E1} / ${c.preexisting} \u{1F7E3}`;
}

function renderPerSkillScan(scan: PerSkillScanItem[] | undefined): string[] {
  const out: string[] = ['### Per-skill scan'];
  if (!Array.isArray(scan) || scan.length === 0) {
    out.push('- (no skills loaded — review proceeded against the baseline.)');
    return out;
  }
  for (const entry of scan) {
    if (!entry || typeof entry !== 'object') continue;
    const skill = String(entry.skill || '').trim();
    const outcome = String(entry.outcome || '').trim();
    if (!skill) continue;
    out.push(`- [${skill}]: ${outcome || 'scanned (no outcome reported).'}`);
  }
  return out;
}

function renderDedicatedSection(section: DedicatedSection | undefined): string[] {
  if (!section || typeof section !== 'object') return [];
  const name = String(section.section_name || '').trim();
  const skill = String(section.skill || '').trim();
  const header = skill && name
    ? `### ${name} [${skill}]`
    : `### ${name || skill || 'Dedicated section'}`;
  const out: string[] = [header, ''];
  if (Array.isArray(section.findings) && section.findings.length > 0) {
    // Dedicated-section findings use the same emoji-prefix block.
    // Default severity for dedicated sections is "critical" — they're
    // domain-specific findings the skill considers important.
    out.push(...renderFindings(section.findings, 'critical'));
  } else {
    out.push('No findings.');
  }
  return out;
}

function renderFindings(findings: ReviewFinding[] | undefined, severity: FindingSeverity): string[] {
  const emoji = SEVERITY_EMOJI[severity] || SEVERITY_EMOJI.critical;
  const out: string[] = [];
  if (!Array.isArray(findings)) return out;
  for (const f of findings) {
    if (!f || typeof f !== 'object') continue;
    const skill = String(f.skill || '').trim();
    const summary = String(f.summary || '').trim();
    if (!summary) continue;
    const skillPrefix = skill ? `[${skill}]: ` : '';
    const anchor = locationAnchor(f);
    const claim = anchor
      ? `${emoji} ${skillPrefix}${stripTrailingPunctuation(summary)} (${anchor}).`
      : `${emoji} ${skillPrefix}${summary}`;
    out.push(claim);
    if (f.reasoning) {
      out.push('<details><summary>Reasoning</summary>');
      out.push('');
      out.push(String(f.reasoning).trim());
      out.push('');
      out.push('</details>');
    }
    out.push('');
  }
  // Remove the trailing empty line — renderReview adds its own separators.
  if (out[out.length - 1] === '') out.pop();
  return out;
}

function renderSkillsReferenced(skills: string[] | undefined): string {
  if (!Array.isArray(skills) || skills.length === 0) {
    return 'Skills referenced: [none] — no installed skill applied to this diff.';
  }
  return `Skills referenced: [${skills.join(', ')}]`;
}

// --- helpers ---

function nonEmpty<T>(arr: T[] | undefined): arr is T[] {
  return Array.isArray(arr) && arr.length > 0;
}

function sanitizeCounts(counts: ReviewSummaryCounts | undefined): ReviewSummaryCounts {
  const c = counts && typeof counts === 'object' ? counts : ({} as Partial<ReviewSummaryCounts>);
  return {
    critical: numOrZero(c.critical),
    minor: numOrZero(c.minor),
    preexisting: numOrZero(c.preexisting),
    resolved_from_prior: numOrZero(c.resolved_from_prior),
    still_open: numOrZero(c.still_open),
  };
}

function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function locationAnchor(f: ReviewFinding): string | null {
  const file = String(f.file || '').trim();
  if (!file) return null;
  const line = Number(f.line);
  return Number.isFinite(line) && line > 0 ? `${file}:${line}` : file;
}

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.!?]+$/, '');
}
