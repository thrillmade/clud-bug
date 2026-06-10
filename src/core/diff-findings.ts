// SPEC §1.8.1 multi-pass diff: prior `docs/reviews/PR-<n>.md` vs current
// review findings. Produces the `**Resolved this round:**` /
// `**Still open:**` lists that `renderReviewFile` consumes.
//
// Identity model
// --------------
// Each finding's identity is a stable hash of:
//
//   `${file}:${line}:${severity}:${skillName}:${summary.slice(0, 100)}`
//
// A 100-character truncation on `summary` is enough to discriminate
// distinct findings without being so long that whitespace/punctuation
// drift between passes breaks identity. A severity-bucket change (e.g.
// the same skill flags the same line as 🔴 then 🟡 the next round)
// produces a DIFFERENT identity — by design — so a severity downgrade
// counts as one resolved finding + one new finding (the user gets
// credit for the fix AND can see the bot still has a concern, just at
// a lower severity).
//
// The same identity shape is what auto-fix / auto-resolve in
// clud-bug-app uses for thread anchoring; keeping it identical means a
// future per-finding cross-reference between the doc-file diff and the
// inline-thread surface is trivial.

import {
  flattenFindings,
  type Finding,
  type Review,
} from './review-schema-zod.js';

import { SEVERITY_EMOJI } from './review-writeback.js';

/** One parsed finding from a prior `docs/reviews/PR-<n>.md`. */
export type ParsedFinding = {
  /** Relative path. Falls back to '(unknown file)' when the prior file
   *  itself rendered the unknown-file marker; we keep it intact for
   *  identity stability. */
  file: string;
  /**
   * 1-indexed line number. Zero when the prior file had no `:N` suffix
   * (cross-cutting findings). Zero participates in identity as-is.
   */
  line: number;
  severity: 'critical' | 'minor' | 'preexisting';
  skillName: string;
  summary: string;
};

export type ParsedReview = { findings: ParsedFinding[] };

/**
 * Parse a `docs/reviews/PR-<n>.md` markdown back into structured findings.
 *
 * Robust to:
 *   - `null` / `undefined` input            → returns `null`
 *   - empty / whitespace-only markdown      → returns `null`
 *   - missing severity sections             → those sections contribute 0
 *   - lines that don't match the SPEC bullet shape → silently dropped
 *   - mixed unknown-file markers (`(unknown file)` vs absent)
 *
 * Parsing strategy: walk top-down, switch active severity on each
 * `### <emoji> <Label>` header (one of the three SPEC §1.8.1 buckets),
 * then collect every line starting with `- **` until the next header
 * (or `---` end marker). Each `- **<file>:<line>** — <skill>: <summary>`
 * line is split into its 4 fields; `:<line>` is optional (cross-cutting).
 *
 * `(unknown file)` files are preserved verbatim — they participate in
 * identity, so the same cross-cutting finding can still be diffed across
 * rounds even when neither pass has a line anchor.
 */
export function parsePriorReviewFile(
  markdown: string | null | undefined,
): ParsedReview | null {
  if (markdown == null) return null;
  if (markdown.trim() === '') return null;

  const lines = markdown.split('\n');
  const out: ParsedFinding[] = [];
  let current: ParsedFinding['severity'] | null = null;

  for (const raw of lines) {
    // Strip trailing whitespace; leading indent is meaningful for
    // sub-lines (Reasoning, attribution) which we deliberately ignore.
    const line = raw.replace(/\s+$/, '');

    // The SPEC §1.8.1 trailing `---` separator ends the findings region.
    // Anything after it (the [Link to PR] line) is metadata and parsed
    // by short-circuit so we don't mistake the literal `---` for a
    // missing header.
    if (line === '---') {
      current = null;
      continue;
    }

    // Switch active severity on every `### <emoji> <Label>` heading.
    // We pattern-match on the emoji codepoint (not the label text) so a
    // future SPEC tweak to "Critical" → "Blocking" doesn't break us.
    if (line.startsWith('### ')) {
      if (line.includes(SEVERITY_EMOJI.critical)) {
        current = 'critical';
      } else if (line.includes(SEVERITY_EMOJI.minor)) {
        current = 'minor';
      } else if (line.includes(SEVERITY_EMOJI.preexisting)) {
        current = 'preexisting';
      } else {
        current = null;
      }
      continue;
    }

    // Resolved / Still-open blocks under SPEC §1.8.1 — these list
    // findings from PRIOR rounds, NOT this-round findings. Skip them
    // so a multi-round PR doesn't double-count its own history.
    // (`**Resolved this round:**` / `**Still open:**` headings.)
    if (line.startsWith('**Resolved this round:') || line.startsWith('**Still open:')) {
      current = null;
      continue;
    }

    if (current == null) continue;

    // SPEC §1.8.1 bullet: `- **<file>:<line>** — <skill>: <summary>`
    //                  OR `- **<file>** — <skill>: <summary>`
    //                  OR `- **(unknown file)** — <skill>: <summary>`
    //
    // The multi-pass renderer prepends `[Pass N — Role · model]` to the
    // bullet; we accept that prefix and discard it for parsing.
    const parsed = parseFindingBullet(line);
    if (parsed) {
      out.push({ ...parsed, severity: current });
    }
  }

  if (out.length === 0) return null;
  return { findings: out };
}

/**
 * Diff prior vs current.
 *
 * `resolvedFindings`: findings that appeared in `prior` but NOT in
 * `current`. The PR author (or auto-fix) addressed them.
 *
 * `stillOpenFindings`: findings that appeared in BOTH `prior` and
 * `current`. These are persistent — the PR author hasn't fixed them
 * (or the bot still considers them findings post-fix-push).
 *
 * Findings unique to `current` (newly raised this round) appear in
 * neither list — those are surfaced directly by the renderer's normal
 * severity-bucket emission.
 *
 * Order is preserved from `prior` for stability across rounds.
 */
export function diffFindings(
  prior: ParsedReview | null,
  current: {
    critical_findings?: Array<{
      skill: string;
      file?: string;
      line?: number;
      summary: string;
    }>;
    minor_findings?: Array<{
      skill: string;
      file?: string;
      line?: number;
      summary: string;
    }>;
    preexisting_findings?: Array<{
      skill: string;
      file?: string;
      line?: number;
      summary: string;
    }>;
  },
): {
  resolvedFindings: ParsedFinding[];
  stillOpenFindings: ParsedFinding[];
} {
  if (prior === null || prior.findings.length === 0) {
    return { resolvedFindings: [], stillOpenFindings: [] };
  }

  // Build identity set for the current round. We do not need the
  // current-round ParsedFinding objects — we only need to know which
  // identities are still present.
  //
  // Cast through `Review` shape — the schema's three arrays mirror our
  // input slice exactly (skill / file / line / summary), so we can lean
  // on `flattenFindings` to produce a tagged list.
  const currentReview: Review = {
    status_header: 'clean',
    summary_counts: {
      critical: 0,
      minor: 0,
      preexisting: 0,
      resolved_from_prior: 0,
      still_open: 0,
    },
    per_skill_scan: [],
    critical_findings: current.critical_findings ?? [],
    minor_findings: current.minor_findings ?? [],
    preexisting_findings: current.preexisting_findings ?? [],
    skills_referenced: [],
    last_reviewed_sha: '',
  };
  const currentFlat: Finding[] = flattenFindings(currentReview);
  const currentIds = new Set<string>(currentFlat.map((f) => findingIdentity({
    file: f.file ?? '(unknown file)',
    line: f.line ?? 0,
    severity: f.severity,
    skillName: f.skill,
    summary: f.summary,
  })));

  const resolved: ParsedFinding[] = [];
  const stillOpen: ParsedFinding[] = [];
  for (const f of prior.findings) {
    const id = findingIdentity(f);
    if (currentIds.has(id)) {
      stillOpen.push(f);
    } else {
      resolved.push(f);
    }
  }
  return { resolvedFindings: resolved, stillOpenFindings: stillOpen };
}

/**
 * Stable identity for a finding. Used for diffing prior vs current
 * across review rounds AND (by intention) shareable with the
 * clud-bug-app inline-thread anchor hash so future cross-feature
 * surfaces (e.g. "the auto-fix that resolved this thread also resolves
 * this doc-file finding") align without re-computing.
 *
 * Exposed for tests + downstream callers that want to align their own
 * finding storage on the same scheme.
 */
export function findingIdentity(f: {
  file: string;
  line: number;
  severity: 'critical' | 'minor' | 'preexisting';
  skillName: string;
  summary: string;
}): string {
  // Truncate summary to 100 chars to absorb whitespace/punctuation
  // drift between rounds without losing discrimination between
  // genuinely-distinct findings (the SPEC §1.8.1 summary line is
  // user-visible so it tends to be stable; 100 chars is enough for any
  // realistic distinct summary while tolerating "fix the X" → "fix X"
  // drift).
  const summaryPart = f.summary.slice(0, 100);
  return `${f.file}:${f.line}:${f.severity}:${f.skillName}:${summaryPart}`;
}

// ---------------------------------------------------------------------------
// Parsing internals
// ---------------------------------------------------------------------------

/**
 * Parse one SPEC §1.8.1 bullet line into a {file, line, skill, summary}
 * tuple. Returns null for any line that doesn't match the SPEC shape.
 *
 * Accepts both shapes:
 *   `- **<file>:<line>** — <skill>: <summary>`
 *   `- **<file>** — <skill>: <summary>`
 *
 * Also tolerates the multi-pass attribution prefix (D.2.5):
 *   `- [Pass 1 — Role · model] **<file>:<line>** — <skill>: <summary>`
 *
 * Em-dash recognition: the SPEC pins U+2014 EM DASH between location
 * and skill. Some downstream tools have been observed using `--` or
 * regular hyphens; we accept both for resilience.
 */
function parseFindingBullet(line: string): Omit<ParsedFinding, 'severity'> | null {
  // Strip the leading `- ` bullet marker.
  if (!line.startsWith('- ')) return null;
  let rest = line.slice(2);

  // Strip optional `[Pass N — ...] ` attribution prefix (D.2.5).
  if (rest.startsWith('[')) {
    const closeIdx = rest.indexOf('] ');
    if (closeIdx === -1) return null;
    rest = rest.slice(closeIdx + 2);
  }

  // Expect `**<location>** ` next.
  if (!rest.startsWith('**')) return null;
  const locEnd = rest.indexOf('**', 2);
  if (locEnd === -1) return null;
  const location = rest.slice(2, locEnd);
  rest = rest.slice(locEnd + 2);

  // Strip the location separator. SPEC pins ` — ` (U+2014 surrounded by
  // spaces). We accept hyphen-minus variants as a courtesy.
  // The separator may be ` — `, ` -- `, or ` - `.
  const sepMatch = rest.match(/^\s+(?:—|--|-)\s+/);
  if (!sepMatch) return null;
  rest = rest.slice(sepMatch[0].length);

  // `<skill>: <summary>` — split on the first `: `.
  const sepIdx = rest.indexOf(': ');
  if (sepIdx === -1) return null;
  const skillName = rest.slice(0, sepIdx).trim();
  const summary = rest.slice(sepIdx + 2).trim();
  if (skillName === '' || summary === '') return null;

  // Split location into file + optional line. Walk RIGHTWARD from the
  // last `:` so file names containing colons (Windows-style, rare) on
  // the LHS don't confuse us.
  const colonIdx = location.lastIndexOf(':');
  let file = location;
  let lineNum = 0;
  if (colonIdx !== -1) {
    const tail = location.slice(colonIdx + 1);
    if (/^\d+$/.test(tail)) {
      file = location.slice(0, colonIdx);
      lineNum = Number(tail);
    }
  }

  return { file, line: lineNum, skillName, summary };
}
