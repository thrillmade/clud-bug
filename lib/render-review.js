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

const SEVERITY_EMOJI = { critical: '🔴', minor: '🟡', preexisting: '🟣' };
const SEVERITY_LABEL = {
  critical: 'important',
  minor: 'nit',
  preexisting: 'pre-existing',
};

// Render the full summary comment markdown. `data` is the parsed JSON
// matching the schema (see schema.js). Returns a string suitable for
// `gh pr comment --body`.
export function renderReview(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError('renderReview: data must be an object');
  }
  const out = [];
  out.push(renderHeader(data));
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
  if (data.last_reviewed_sha) {
    out.push(`<!-- last-reviewed-sha: ${data.last_reviewed_sha} -->`);
  }
  // Trim trailing blank lines but always keep a single trailing newline so
  // the comment ends with a final newline (markdown rendering is unchanged
  // either way, but it matches the prior LLM-driven shape).
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
}

function renderHeader(data) {
  const verdict = data.status_header;
  const base = '## 🐛 Clud Bug review';
  if (verdict === 'critical findings') return `${base} — critical findings`;
  if (verdict === 'clean') return `${base} — clean`;
  // 'bare' (non-strict-mode default) OR an unexpected verdict — render
  // the unsuffixed H2. Strict-mode gate's anchor stays intact either way.
  return base;
}

function renderStatusLine(counts) {
  const c = sanitizeCounts(counts);
  return `**This round:** ${c.critical} critical · ${c.minor} minor · ${c.resolved_from_prior} resolved from prior · ${c.still_open} still open`;
}

// Severity-emoji stats header. Counts pre-existing in 🟣 even though
// it's not in summary_counts (the prompt counts pre-existing separately
// in preexisting_findings.length).
function renderStatsHeader(counts) {
  const c = sanitizeCounts(counts);
  return `Found: ${c.critical} 🔴 / ${c.minor} 🟡 / ${c.preexisting} 🟣`;
}

function renderPerSkillScan(scan) {
  const out = ['### Per-skill scan'];
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

function renderDedicatedSection(section) {
  if (!section || typeof section !== 'object') return [];
  const name = String(section.section_name || '').trim();
  const skill = String(section.skill || '').trim();
  const header = skill && name
    ? `### ${name} [${skill}]`
    : `### ${name || skill || 'Dedicated section'}`;
  const out = [header, ''];
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

function renderFindings(findings, severity) {
  const emoji = SEVERITY_EMOJI[severity] || '🔴';
  const out = [];
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

function renderSkillsReferenced(skills) {
  if (!Array.isArray(skills) || skills.length === 0) {
    return 'Skills referenced: [none] — no installed skill applied to this diff.';
  }
  return `Skills referenced: [${skills.join(', ')}]`;
}

// --- helpers ---

function nonEmpty(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function sanitizeCounts(counts) {
  const c = counts && typeof counts === 'object' ? counts : {};
  return {
    critical: numOrZero(c.critical),
    minor: numOrZero(c.minor),
    preexisting: numOrZero(c.preexisting),
    resolved_from_prior: numOrZero(c.resolved_from_prior),
    still_open: numOrZero(c.still_open),
  };
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function locationAnchor(f) {
  const file = String(f.file || '').trim();
  if (!file) return null;
  const line = Number(f.line);
  return Number.isFinite(line) && line > 0 ? `${file}:${line}` : file;
}

function stripTrailingPunctuation(s) {
  return s.replace(/[.!?]+$/, '');
}
