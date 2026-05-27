// Server-side data fetchers for cludbug.dev. All public-only sources.
// Cached + revalidated hourly so the page stays fully static between rebuilds.

const REVALIDATE_SECONDS = 3600;
const REPO = 'thrillmade/clud-bug';

export type LatestReview = {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  headline: string; // first non-empty findings line, plain text
} | null;

async function safeFetch(url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, {
      ...init,
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { accept: 'application/json', ...(init?.headers || {}) },
    });
    if (!res.ok) return null;
    // Must await inside the try so JSON parse failures (truncated stream,
    // HTML CDN error page returned with 200, etc.) are caught here instead
    // of escaping to the caller and crashing the Server Component render.
    return await res.json();
  } catch {
    return null;
  }
}

export async function getLatestPublicReview(): Promise<LatestReview> {
  // Pull recent issue comments and find the latest one authored by claude[bot]
  // that starts with our review header. Only inspect this public repo for now.
  const comments = await safeFetch(
    `https://api.github.com/repos/${REPO}/issues/comments?per_page=50&sort=created&direction=desc`,
  );
  if (!Array.isArray(comments)) return null;

  for (const c of comments) {
    if (c.user?.login !== 'claude' && c.user?.login !== 'claude[bot]') continue;
    const body: string = c.body || '';
    if (!body.includes('🐛 Clud Bug review')) continue;

    const headline = extractHeadline(body);
    if (!headline) continue;

    const issueUrl: string = c.issue_url || '';
    const prNumberMatch = issueUrl.match(/\/issues\/(\d+)$/);
    if (!prNumberMatch) continue;
    const prNumber = Number(prNumberMatch[1]);
    const pr = await safeFetch(`https://api.github.com/repos/${REPO}/pulls/${prNumber}`);
    if (!pr || pr.draft) continue;

    return {
      prNumber,
      prTitle: pr.title,
      prUrl: pr.html_url,
      headline,
    };
  }
  return null;
}

function extractHeadline(body: string): string | null {
  const lines = body.split('\n').map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('**Claude finished')) continue;
    if (line.startsWith('---')) continue;
    if (line.startsWith('##')) continue;
    if (line.startsWith('- [')) continue;
    if (line.startsWith('|')) continue;
    if (line.startsWith('>')) continue;
    if (line.startsWith('·')) continue;
    if (line.startsWith('### ')) continue;
    const plain = line
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    if (plain.length < 30) continue;
    return plain.length > 220 ? plain.slice(0, 217).trimEnd() + '…' : plain;
  }
  return null;
}
