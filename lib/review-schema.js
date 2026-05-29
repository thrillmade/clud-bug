// JSON Schema for clud-bug review structured output (0.0.O / v0.6.22).
//
// Passed to claude-code-action via `claude_args: --json-schema '<JSON>'`.
// The Agent SDK validates the LLM's emitted JSON against this schema and
// re-prompts on mismatch (internal retry; not a clud-bug-level loop).
//
// Schema design choices:
//   - Flat top-level — composite-action outputs are a single string, so we
//     fromJSON() once and pluck fields. No deep nesting that would force
//     extra path traversal in the post-step shell.
//   - Word/char caps in `description:` — the SDK doc names these as the
//     primary lever for keeping output cheap. They're advisory (the SDK
//     does not enforce numeric caps; the LLM treats them as instruction).
//     0.0.X already lives in the prompt, so the schema description here is
//     a complementary belt-and-suspenders signal.
//   - Required minimum — only the fields a renderer absolutely needs to
//     produce a valid summary comment. Counts are always required (the
//     stats header + status block depend on them); finding arrays are
//     required but may be empty (a clean review has 0 findings, not
//     missing arrays).
//   - `additionalProperties: false` on every object — schema-strict mode.
//     Anthropic's structured-outputs doc explicitly recommends this to
//     keep the model from inventing fields.
//
// Bumped via deliberate edit; not derived from a TypeScript type. The
// rendering side (lib/render-review.js) treats unknown fields permissively
// — schema and renderer can drift up to one minor version safely.

const FINDING_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    skill: {
      type: 'string',
      description: 'The skill name in brackets, e.g. "critical-issues-only". Must match a loaded skill or "(none)".',
    },
    file: {
      type: 'string',
      description: 'Path of the affected file relative to repo root. Optional when the finding is cross-cutting.',
    },
    line: {
      type: 'integer',
      minimum: 1,
      description: 'Line number in the affected file. Required when `file` is set.',
    },
    summary: {
      type: 'string',
      description: 'One sentence stating the claim. Max ~20 words; no trailing period (the renderer adds one).',
    },
    reasoning: {
      type: 'string',
      description: 'Evidence anchor + suggested fix. Max ~80 words. Rendered inside <details> block; can be omitted for self-evident findings.',
    },
  },
  required: ['skill', 'summary'],
};

const PER_SKILL_SCAN_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    skill: { type: 'string' },
    outcome: {
      type: 'string',
      description: 'One sentence describing what the skill found. Max ~15 words. Examples: "scanned all paths. 2 critical findings below.", "0 findings.", "not applicable to this diff."',
    },
  },
  required: ['skill', 'outcome'],
};

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status_header: {
      type: 'string',
      enum: ['critical findings', 'clean'],
      description: '`critical findings` when ANY 🔴 finding exists. `clean` when all three tiers are 0. Drives the strict-mode gate header.',
    },
    summary_counts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        critical: { type: 'integer', minimum: 0 },
        minor: { type: 'integer', minimum: 0 },
        preexisting: { type: 'integer', minimum: 0 },
        resolved_from_prior: { type: 'integer', minimum: 0 },
        still_open: { type: 'integer', minimum: 0 },
      },
      required: ['critical', 'minor', 'preexisting', 'resolved_from_prior', 'still_open'],
    },
    per_skill_scan: {
      type: 'array',
      description: 'One entry per LOADED skill — even silent ones. Empty when no skills are installed.',
      items: PER_SKILL_SCAN_ITEM,
    },
    critical_findings: {
      type: 'array',
      description: 'NEW 🔴 findings (bugs, security, perf, missing test coverage). May be empty.',
      items: FINDING_ITEM,
    },
    minor_findings: {
      type: 'array',
      description: 'NEW 🟡 findings (nits, style, observations). May be empty.',
      items: FINDING_ITEM,
    },
    preexisting_findings: {
      type: 'array',
      description: 'NEW 🟣 findings (issues that pre-date this PR). May be empty.',
      items: FINDING_ITEM,
    },
    dedicated_sections: {
      type: 'array',
      description: 'Per-dedicated-mode-skill section blocks. Each item carries the section header text and its findings.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section_name: { type: 'string', description: 'Human-readable section title, e.g. "Brand voice".' },
          skill: { type: 'string', description: 'The dedicated skill name.' },
          findings: { type: 'array', items: FINDING_ITEM },
        },
        required: ['section_name', 'skill', 'findings'],
      },
    },
    diagnostics: {
      type: 'array',
      description: '0.0.T tee-hint diagnostics. One line per `head -c` cap that fired during fetch. Empty when no truncation occurred.',
      items: { type: 'string' },
    },
    skills_referenced: {
      type: 'array',
      description: 'Names of every skill cited in any finding. Empty list (or ["(none)"]) when no skill applied.',
      items: { type: 'string' },
    },
    last_reviewed_sha: {
      type: 'string',
      description: 'The HEAD SHA at review time, used by the incremental-diff handshake. Set to the literal value of the workflow env var $HEAD_SHA.',
    },
  },
  required: [
    'status_header',
    'summary_counts',
    'per_skill_scan',
    'critical_findings',
    'minor_findings',
    'preexisting_findings',
    'skills_referenced',
    'last_reviewed_sha',
  ],
};

// Serialize the schema for inclusion in workflow templates as the
// `--json-schema '<JSON>'` argument. Single-line (the workflow YAML uses
// the pipe block; single-quoted JSON inside that needs to stay flat to
// avoid YAML parser surprises with embedded newlines).
export function serializedReviewSchema() {
  return JSON.stringify(REVIEW_SCHEMA);
}
