// Pure audit helpers — no FS, no git, no child_process.
//
// Split from lib/audit.js during the v0.7.0 TS migration: durationToGitSince
// and renderAuditHeader are pure functions safe to consume from any runtime
// (e.g. clud-bug-app's serverless review path), so they live in src/core/.
// The git-spawning siblings (gitLines, computeAuditFileSet) live in
// src/cli/audit.ts.

// Convert a duration like "7d", "2w", "1mo", "3mo", "1y" to a git --since arg.
// Returns null if the input is empty/undefined; throws on malformed input.
export function durationToGitSince(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = String(input).trim().match(/^(\d+)\s*(d|w|mo|m|y)$/i);
  if (!m) {
    throw new Error(`Unrecognized duration "${input}". Examples: 7d, 2w, 1mo, 1y.`);
  }
  // Capture group 1 (\d+) is always present when m is truthy; same for group 2.
  const n = Number(m[1]);
  const unit = (m[2] as string).toLowerCase();
  const map: Record<string, string> = { d: 'day', w: 'week', mo: 'month', m: 'month', y: 'year' };
  return `${n} ${map[unit]}${n === 1 ? '' : 's'} ago`;
}

export interface AuditHeaderInput {
  date: string;
  scopeLabel: string;
  files: string[];
}

// Render the audit report's initial markdown body. The Action's Claude run
// will append findings under a "## Findings" section after this header.
export function renderAuditHeader({ date, scopeLabel, files }: AuditHeaderInput): string {
  const head = `# 🐛 Clud Bug audit — ${date}

A scheduled walk through the habitat. Scope: ${scopeLabel}.
Files surveyed: **${files.length}**.

<details>
<summary>File manifest (${files.length})</summary>

\`\`\`
${files.join('\n')}
\`\`\`

</details>

---

## Findings

`;
  return head;
}
