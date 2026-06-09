// Standalone classifier for the strict-mode-gate composite action.
//
// v0.7.0+: clud-bug's source moved from lib/ to src/ (compiled to dist/),
// and dist/ is gitignored. The composite action runs inside the consumer's
// checked-out clud-bug ref tree, which contains src/ and tests/ but NOT
// dist/. To keep the action buildless (no `npm ci` + `npm run build` in the
// composite — that'd add ~30s of overhead and `npm ci` permissions to every
// strict-mode PR), we vendor the five pure functions the action needs:
//   - selectReviewHeader      (step 1: gate failure on critical findings)
//   - isCriticalReviewHeader  (step 1)
//   - extractFirstReviewHeaderLine (helper used by both selectors)
//   - selectReviewBody         (step 2: BB.3 per-skill check-runs body)
//   - extractPerSkillLine     (step 2)
//   - classifyPerSkillOutcome (step 2)
//
// These are byte-identical ports of the equivalent exports in
// src/core/skills.ts. Keep this file in sync — the equivalence test at
// test/strict-mode-gate-classifier.test.js asserts both stay in lockstep.

export function extractFirstReviewHeaderLine(body) {
  if (typeof body !== 'string') return null;
  const m = body.match(/^## 🐛 Clud Bug review[^\n]*/m);
  return m ? m[0] : null;
}

export function selectReviewHeader(comments, botLogin) {
  if (!Array.isArray(comments)) return null;
  if (typeof botLogin !== 'string' || !botLogin) return null;
  const sorted = [...comments].sort((a, b) => {
    const ta = typeof a?.created_at === 'string' ? Date.parse(a.created_at) : 0;
    const tb = typeof b?.created_at === 'string' ? Date.parse(b.created_at) : 0;
    return tb - ta; // newest first
  });
  for (const c of sorted) {
    if (!c || typeof c !== 'object') continue;
    const author = c.user?.login;
    const body = c.body;
    if (author !== botLogin || typeof body !== 'string') continue;
    const headerLine = extractFirstReviewHeaderLine(body);
    if (headerLine) return headerLine;
  }
  return null;
}

export function isCriticalReviewHeader(headerLine) {
  if (typeof headerLine !== 'string') return false;
  return /Clud Bug review — critical findings/.test(headerLine);
}

// Step 2 (BB.3 per-skill check-runs): returns the full body of the
// latest clud-bug review comment, used as the source for per-skill scan
// outcome extraction.
export function selectReviewBody(comments, botLogin) {
  if (!Array.isArray(comments)) return null;
  if (typeof botLogin !== 'string' || !botLogin) return null;
  const sorted = [...comments].sort((a, b) => {
    const ta = typeof a?.created_at === 'string' ? Date.parse(a.created_at) : 0;
    const tb = typeof b?.created_at === 'string' ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  for (const c of sorted) {
    if (!c || typeof c !== 'object') continue;
    const author = c.user?.login;
    const body = c.body;
    if (author !== botLogin || typeof body !== 'string') continue;
    if (extractFirstReviewHeaderLine(body)) return body;
  }
  return null;
}

// Step 2: extract the `- [skill-name]: …` outcome line for one skill
// from the latest review body. Returns the outcome substring (everything
// after `]:`) or null when the skill wasn't mentioned.
export function extractPerSkillLine(comment, skillName) {
  if (typeof comment !== 'string' || !comment) return null;
  if (typeof skillName !== 'string' || !skillName) return null;
  const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*-\\s*\\[${escaped}\\]:\\s*(.+?)\\s*$`, 'm');
  const m = comment.match(re);
  return m ? m[1] : null;
}

// Step 2: classify a per-skill outcome line into the check-run conclusion
// the composite emits. See src/core/skills.ts for the natural-language
// patterns supported and their rationale.
export function classifyPerSkillOutcome(outcomeLine) {
  if (outcomeLine == null) return 'failure';
  const text = String(outcomeLine);
  if (/\b[1-9]\d*\s+(?:\w+\s+){0,3}finding/i.test(text)) return 'failure';
  if (/\b(?:0|no|zero)\s+(?:\S+\s+){0,3}finding/i.test(text)) return 'success';
  if (/\bn\/a\b/i.test(text)) return 'success';
  if (/\bnot\s+applicable\b/i.test(text)) return 'success';
  if (/(?:^|\s)✓(?:\s|$|[.,;:])/.test(text)) return 'success';
  return 'failure';
}
