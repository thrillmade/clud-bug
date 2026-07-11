// Zod-typed review schema for the AI-Gateway-shape consumer (clud-bug-app).
//
// The CLI runtime in `./review-schema.ts` ships a plain JSON-Schema object
// because that's what the Agent SDK validator expects on the
// `--json-schema '<JSON>'` argument. The App's runtime instead funnels the
// model output through the Vercel AI SDK, which derives a JSON Schema from
// a Zod schema. Both consumers need to agree on the WIRE shape — separate
// `critical_findings[] / minor_findings[] / preexisting_findings[]` arrays
// per SPEC §1.8.1 — but each builds its validator from a different source.
//
// This module ports the App's Zod schemas + flat-shape helpers into core
// so a future drift between the App's Zod and the CLI's JSON-Schema lives
// in one repo. The equivalence test (test/review-schema-zod.test.js)
// asserts the two schemas describe the same wire shape (required fields,
// finding-item shape) for every release.
//
// Ported from clud-bug-app/lib/review-schema.ts (commit shipped 2026-06-08).
// The pure helpers (`flattenFindings`, `unflattenFindings`,
// `deriveSummaryCounts`, `deriveSkillsReferenced`, `buildReviewFromFindings`)
// are byte-equivalent to the App's helpers — see test for the equivalence
// fixtures.

import { z } from 'zod';

// Severity buckets per SPEC §1.8.1. Only used by the internal `Finding`
// type — the wire `findingItemSchema` does NOT carry severity.
export const severityValues = ['critical', 'minor', 'preexisting'] as const;
export const severitySchema = z.enum(severityValues);
export type Severity = z.infer<typeof severitySchema>;

// Status header at the top of the review file.
export const statusHeaderValues = [
  'critical findings',
  'clean',
  'bare',
] as const;
export const statusHeaderSchema = z.enum(statusHeaderValues);
export type StatusHeader = z.infer<typeof statusHeaderSchema>;

export const summaryCountsSchema = z.object({
  critical: z.number().int().min(0),
  minor: z.number().int().min(0),
  preexisting: z.number().int().min(0),
  resolved_from_prior: z.number().int().min(0),
  still_open: z.number().int().min(0),
});
export type SummaryCounts = z.infer<typeof summaryCountsSchema>;

/**
 * Wire-shape finding item — NO severity field (mirrors the CLI's
 * `FINDING_ITEM` JSON Schema in `./review-schema.ts`). Severity is implicit
 * in which array the item lives in (`critical_findings`/`minor_findings`/
 * `preexisting_findings`).
 */
export const findingItemSchema = z.object({
  skill: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().min(1).optional(),
  summary: z.string().min(1),
  reasoning: z.string().optional(),
  // Notary grounding (§10.3.3). Optional on the WIRE (a schema-required field can
  // be satisfied with junk); the notary bundle + `validateGrounding` enforce it
  // as required-for-critical, checking the span against the ground-truth diff.
  grounding: z.string().optional(),
  grounding_kind: z.enum(['quote', 'reproduction', 'invariant']).optional(),
});
export type FindingItem = z.infer<typeof findingItemSchema>;

/** Per-skill scan report — one entry per loaded skill (even silent ones). */
export const perSkillScanItemSchema = z.object({
  skill: z.string(),
  outcome: z.string(),
});
export type PerSkillScanItem = z.infer<typeof perSkillScanItemSchema>;

/** Dedicated-section block for `review_mode: dedicated` skills. */
export const dedicatedSectionSchema = z.object({
  section_name: z.string(),
  skill: z.string(),
  findings: z.array(findingItemSchema),
});
export type DedicatedSection = z.infer<typeof dedicatedSectionSchema>;

/**
 * Full review payload — wire shape. The model produces this; the App
 * orchestrator immediately flattens to the internal `Finding[]` shape via
 * `flattenFindings()` for multi-pass + aggregator work, then unflattens
 * back via `unflattenFindings()` before writeback.
 */
export const reviewSchema = z.object({
  status_header: statusHeaderSchema,
  summary_counts: summaryCountsSchema,
  per_skill_scan: z.array(perSkillScanItemSchema),
  critical_findings: z.array(findingItemSchema),
  minor_findings: z.array(findingItemSchema),
  preexisting_findings: z.array(findingItemSchema),
  dedicated_sections: z.array(dedicatedSectionSchema).optional(),
  diagnostics: z.array(z.string()).optional(),
  skills_referenced: z.array(z.string()),
  last_reviewed_sha: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * Internal flat-finding type used by App orchestrator, multi-pass
 * aggregator, skill-usage telemetry, etc. Created from a wire-shape
 * `Review` via `flattenFindings()`. Has explicit `severity` field so
 * internal code doesn't need to track which array a finding came from.
 *
 * Exported from the core barrel as `ZodFinding` to disambiguate from
 * the CLI-shape `ReviewFinding` (which never carries severity — its
 * severity comes from the array it lives in).
 */
export type Finding = FindingItem & { severity: Severity };

/**
 * Zod schema describing the internal Finding shape (for tests + cross-check
 * Pass 2 independentFindings). The wire equivalent is `findingItemSchema`
 * which does NOT have severity.
 */
export const findingSchema = findingItemSchema.extend({
  severity: severitySchema,
});

/**
 * Flatten wire-shape `Review.critical_findings / minor_findings /
 * preexisting_findings` into a single `Finding[]` with severity tagged.
 * Preserves ordering: criticals first, then minors, then preexistings.
 */
export function flattenFindings(review: Review): Finding[] {
  const out: Finding[] = [];
  for (const f of review.critical_findings) out.push({ ...f, severity: 'critical' });
  for (const f of review.minor_findings) out.push({ ...f, severity: 'minor' });
  for (const f of review.preexisting_findings) out.push({ ...f, severity: 'preexisting' });
  return out;
}

/**
 * Inverse of `flattenFindings`: split a flat `Finding[]` back into the
 * three wire-shape arrays. Used at writeback time after multi-pass
 * aggregation has produced the final flat list.
 */
export function unflattenFindings(findings: Finding[]): {
  critical_findings: FindingItem[];
  minor_findings: FindingItem[];
  preexisting_findings: FindingItem[];
} {
  const stripSeverity = (f: Finding): FindingItem => {
    const { severity: _s, ...rest } = f;
    return rest;
  };
  return {
    critical_findings: findings.filter((f) => f.severity === 'critical').map(stripSeverity),
    minor_findings: findings.filter((f) => f.severity === 'minor').map(stripSeverity),
    preexisting_findings: findings.filter((f) => f.severity === 'preexisting').map(stripSeverity),
  };
}

/**
 * Derive `summary_counts` from a flat `Finding[]` list. Canonical
 * source-of-truth used by the orchestrator after flattening, to
 * overwrite the model's potentially-drifted counts.
 */
export function deriveSummaryCounts(findings: Finding[]): SummaryCounts {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    minor: findings.filter((f) => f.severity === 'minor').length,
    preexisting: findings.filter((f) => f.severity === 'preexisting').length,
    resolved_from_prior: 0,
    still_open: 0,
  };
}

/**
 * Derive `skills_referenced` from a flat `Finding[]` list, preserving
 * citation order (first appearance wins) and deduplicating.
 */
export function deriveSkillsReferenced(findings: Finding[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of findings) {
    if (seen.has(f.skill)) continue;
    seen.add(f.skill);
    out.push(f.skill);
  }
  return out;
}

/**
 * Test helper: build a wire-shape `Review` from a flat `Finding[]` list.
 * Tests historically built reviews with a flat `findings: [...]` field; the
 * wire shape (separate severity arrays + per_skill_scan + last_reviewed_sha
 * required) is more verbose. This helper keeps fixtures short — pass a
 * flat list, get back a valid wire-shape Review with derived counts and
 * skills.
 *
 * Production code should NOT use this; it constructs reviews from AI output
 * directly. This is purely for test ergonomics.
 */
export function buildReviewFromFindings(opts: {
  findings: Finding[];
  status_header?: StatusHeader;
  last_reviewed_sha?: string;
  per_skill_scan?: PerSkillScanItem[];
  dedicated_sections?: DedicatedSection[];
  diagnostics?: string[];
}): Review {
  const split = unflattenFindings(opts.findings);
  // Default status_header is derived from severity, NOT just emptiness.
  // The App's original buildReviewFromFindings defaulted to
  // 'critical findings' for ANY non-empty list, including minor-only and
  // preexisting-only inputs. That was a bug (caught by clud-bug-review
  // on PR #158): a review with only minor findings should be 'clean', not
  // 'critical findings'. Fixed here on port to core.
  //
  // Callers that need the old behavior can pass `status_header` explicitly.
  // Callers that want SPEC §1.8.1 semantics (the default) get the correct
  // bucket: criticals present → 'critical findings'; else → 'clean'.
  const hasCritical = opts.findings.some((f) => f.severity === 'critical');
  const defaultStatus = hasCritical ? 'critical findings' : 'clean';
  return {
    status_header: opts.status_header ?? defaultStatus,
    summary_counts: deriveSummaryCounts(opts.findings),
    skills_referenced: deriveSkillsReferenced(opts.findings),
    per_skill_scan: opts.per_skill_scan ?? [],
    critical_findings: split.critical_findings,
    minor_findings: split.minor_findings,
    preexisting_findings: split.preexisting_findings,
    ...(opts.dedicated_sections !== undefined
      ? { dedicated_sections: opts.dedicated_sections }
      : {}),
    ...(opts.diagnostics !== undefined ? { diagnostics: opts.diagnostics } : {}),
    last_reviewed_sha: opts.last_reviewed_sha ?? '',
  };
}

// ---------------------------------------------------------------------------
// D.2.5 — cross-check pass schema
// ---------------------------------------------------------------------------

/**
 * Per-finding verdict from a cross-check pass. The pass2 model echoes
 * back Pass 1's findings by 0-indexed `pass1Index` + `agreed`/`disagreed`
 * + rationale. The aggregator stitches these into
 * `MultiPassReview.findings[].attributions`.
 *
 * Cross-check Pass 2 operates on a flat finding list (its own
 * representation), so its independentFindings carry severity — uses the
 * legacy `findingSchema` shape.
 */
export const crossCheckVerdictSchema = z.object({
  pass1Index: z.number().int().min(0),
  verdict: z.enum(['agreed', 'disagreed']),
  rationale: z.string().optional(),
});
export type CrossCheckVerdictSchema = z.infer<typeof crossCheckVerdictSchema>;

/**
 * Full cross-check response. Pass 2 outputs verdicts on Pass-1 findings
 * plus its own independent finds (in the internal `findingSchema` shape
 * with severity, since cross-check works on already-flattened lists).
 */
export const crossCheckSchema = z.object({
  verdicts: z.array(crossCheckVerdictSchema),
  independentFindings: z.array(findingSchema),
});
export type CrossCheck = z.infer<typeof crossCheckSchema>;
