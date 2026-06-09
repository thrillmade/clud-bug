// Standalone classifier for the strict-mode-gate composite action.
//
// v0.7.0+: clud-bug's source moved from lib/ to src/ (compiled to dist/),
// and dist/ is gitignored. The composite action runs inside the consumer's
// checked-out clud-bug ref tree, which contains src/ and tests/ but NOT
// dist/. To keep the action buildless (no `npm ci` + `npm run build` in the
// composite — that'd add ~30s of overhead and `npm ci` permissions to every
// strict-mode PR), we vendor the two pure functions the action needs:
//   - selectReviewHeader
//   - isCriticalReviewHeader
//
// These are byte-identical ports of the equivalent exports in
// src/core/skills.ts. Keep this file in sync with src/core/skills.ts —
// the test test/strict-mode-gate-classifier.test.js asserts equivalence.
//
// (Only these two functions are needed by action.yml. If a future composite
// step needs `selectReviewBody` or `classifyPerSkillOutcome`, port them
// here too, with a corresponding equivalence test.)

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
