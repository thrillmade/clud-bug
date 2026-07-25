// src/cli/skill-usage.ts — Component 1+2 of the pragmatic SkDD pivot.
//
// Pure functions for deterministic skill-usage tracking. Per the
// strategic pivot (2026-05-30): replace Zak Elfassi's speculative
// recursive-meta-skill direction with concrete usage data + human-gated
// approval. This module is the data layer.
//
// Three responsibilities:
//
//   1. computeSkillUsageDelta(reviewJson)
//      Given the structured-output JSON from one clud-bug review,
//      return the per-skill delta for that one review.
//
//   2. mergeSkillUsage(existing, delta, timestamp)
//      Merge a delta into the persistent usage block (the `usage`
//      field in `.claude/skills/.clud-bug.json`).
//
//   3. assessSkillHealth(usage, now)
//      Apply the deterministic thresholds + return a row per skill
//      that `clud-bug usage --health` renders as a table.
//
// All three are pure. Side effects (file I/O) live in bin/clud-bug.js
// and the workflow post-step (v0.6.29).
//
// Thresholds — concrete numbers per design (2026-05-30):
//
//   - archive-candidate: citations == 0 across last 90 days of loads
//   - stale:             last cited > 60 days ago
//   - healthy:           >= 3 citations in any rolling 90-day window
//   - new:               loads < 5 (still bedding in; don't judge yet)
//
// No automation acts on this output. It's a READ-ONLY dashboard.
// Humans read; humans decide; humans act.
//
// SPEC §1.12.1 shape (v0.7.0, §17 interop item 3) — the `usage[<slug>]`
// entry we emit into `.claude/skills/.clud-bug.json` MUST match:
//
//   "usage": {
//     "<slug>": {
//       "loads": 0,
//       "citations": 0,
//       "last_cited": "YYYY-MM-DDTHH:MM:SSZ",
//       "last_loaded": "YYYY-MM-DDTHH:MM:SSZ"
//     }
//   }
//
// Two normative constraints from §1.12.1 that are easy to near-miss:
//   - "`usage[<slug>].last_*` timestamps MUST be ISO-8601 UTC with a
//     `Z` suffix and second precision." — `Date#toISOString()` emits
//     millisecond precision, so `formatSpecTimestamp` below truncates.
//   - "Unset is represented by omitting the key, not by an empty
//     string." — we extend this to "not by `null`" too, since a bare
//     `null` is neither an ISO-8601 string nor an absent key; a
//     consumer parsing this field as a Date will choke on it. Entries
//     with no citation/load event yet simply omit `last_cited` /
//     `last_loaded` rather than carrying a `null` placeholder.

import { spawn } from 'node:child_process';

// Per-skill delta record (one review's contribution).
export interface SkillDelta {
  loads: number;
  citations: number;
}

// Per-skill usage record (accumulated across reviews). `last_cited` /
// `last_loaded` are OPTIONAL — per SPEC §1.12.1, "unset" means the key
// is absent, never `null` or `""`.
export interface SkillUsageEntry {
  loads: number;
  citations: number;
  last_cited?: string;
  last_loaded?: string;
}

/**
 * Normalize a timestamp to the SPEC §1.12.1 shape: ISO-8601 UTC, `Z`
 * suffix, SECOND precision (no milliseconds). Returns `undefined` for
 * anything that doesn't parse to a valid instant, so callers can treat
 * "no valid timestamp" the same as "omit the key."
 *
 * Idempotent: re-normalizing an already-second-precision timestamp
 * (or one produced by a prior call) yields the same string.
 */
export function formatSpecTimestamp(input: string | null | undefined): string | undefined {
  if (typeof input !== 'string' || input.length === 0) return undefined;
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) return undefined;
  // toISOString() always includes milliseconds (".SSSZ") — strip them
  // down to second precision per SPEC §1.12.1.
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Map keyed by skill slug.
export type SkillDeltaMap = Record<string, SkillDelta>;
export type SkillUsageMap = Record<string, SkillUsageEntry>;

// Shape of one finding entry the JSON delta extracts.
interface FindingLike {
  skill?: unknown;
}

interface PerSkillScanLike {
  skill?: unknown;
}

interface DedicatedSectionLike {
  findings?: FindingLike[] | null | undefined;
}

interface ReviewJsonShape {
  per_skill_scan?: PerSkillScanLike[] | null | undefined;
  critical_findings?: FindingLike[] | null | undefined;
  minor_findings?: FindingLike[] | null | undefined;
  preexisting_findings?: FindingLike[] | null | undefined;
  dedicated_sections?: DedicatedSectionLike[] | null | undefined;
}

/**
 * Compute per-skill usage delta from a single review's structured JSON.
 *
 * Rules:
 *   - loads = 1 for every skill in per_skill_scan (the skill was in
 *     context for this review).
 *   - citations = 1 if the skill slug appears in ANY finding bucket
 *     (critical / minor / dedicated). Multiple findings from the same
 *     skill on one review = 1 citation, not N. Citations count REVIEWS
 *     that cited the skill, not findings within a review.
 *
 * Returns {} on missing / malformed input (defensive — never throws).
 */
export function computeSkillUsageDelta(reviewJson: unknown): SkillDeltaMap {
  if (!reviewJson || typeof reviewJson !== 'object') return {};
  const review = reviewJson as ReviewJsonShape;

  const delta: SkillDeltaMap = {};

  // Loads — one per skill that scanned.
  for (const entry of review.per_skill_scan || []) {
    if (!entry || typeof entry.skill !== 'string') continue;
    const slug = entry.skill;
    if (!delta[slug]) delta[slug] = { loads: 0, citations: 0 };
    delta[slug].loads = 1;
  }

  // Citations — collect unique skill slugs across all finding buckets.
  const cited = new Set<string>();
  const collect = (findings: FindingLike[] | null | undefined) => {
    for (const f of findings || []) {
      if (f && typeof f.skill === 'string') cited.add(f.skill);
    }
  };
  collect(review.critical_findings);
  collect(review.minor_findings);
  collect(review.preexisting_findings);
  for (const section of review.dedicated_sections || []) {
    collect(section?.findings);
  }

  for (const slug of cited) {
    if (!delta[slug]) delta[slug] = { loads: 0, citations: 0 };
    delta[slug].citations = 1;
  }

  return delta;
}

/**
 * Merge a per-review delta into a persistent usage block.
 *
 * Semantics:
 *   - existing.loads + delta.loads → new.loads (accumulates forever)
 *   - existing.citations + delta.citations → new.citations
 *   - last_cited updates only when delta.citations > 0 (i.e., cited
 *     in THIS review). Stays at the prior value otherwise.
 *   - last_loaded updates only when delta.loads > 0 (SPEC §1.12.1
 *     tracks loads and citations as independent counters, each with
 *     its own `last_*` timestamp).
 *   - New skills (not in existing) get initialized fresh.
 *   - Both `last_*` fields are normalized to SPEC §1.12.1 shape
 *     (second-precision ISO-8601, `Z` suffix) via `formatSpecTimestamp`,
 *     and OMITTED entirely (not `null`) while unset — this also cures
 *     any legacy `last_cited: null` entries written before this fix on
 *     their next merge.
 */
export function mergeSkillUsage(
  existing: unknown,
  delta: SkillDeltaMap | null | undefined,
  timestamp: string | null,
): SkillUsageMap {
  const safeExisting: Record<string, unknown> =
    (existing && typeof existing === 'object') ? (existing as Record<string, unknown>) : {};
  const result: SkillUsageMap = {};

  // Copy all existing skills first (preserve skills NOT in this delta).
  for (const [slug, entry] of Object.entries(safeExisting)) {
    if (entry && typeof entry === 'object') {
      const e = entry as { loads?: unknown; citations?: unknown; last_cited?: unknown; last_loaded?: unknown };
      const row: SkillUsageEntry = {
        loads: Number(e.loads) || 0,
        citations: Number(e.citations) || 0,
      };
      const lastCited = formatSpecTimestamp(typeof e.last_cited === 'string' ? e.last_cited : undefined);
      if (lastCited) row.last_cited = lastCited;
      const lastLoaded = formatSpecTimestamp(typeof e.last_loaded === 'string' ? e.last_loaded : undefined);
      if (lastLoaded) row.last_loaded = lastLoaded;
      result[slug] = row;
    }
  }

  // Merge delta.
  const ts = formatSpecTimestamp(timestamp);
  for (const [slug, d] of Object.entries(delta || {})) {
    let row = result[slug];
    if (!row) {
      row = { loads: 0, citations: 0 };
      result[slug] = row;
    }
    const loadsDelta = Number(d.loads) || 0;
    const citationsDelta = Number(d.citations) || 0;
    row.loads += loadsDelta;
    row.citations += citationsDelta;
    if (loadsDelta > 0 && ts) {
      row.last_loaded = ts;
    }
    if (citationsDelta > 0 && ts) {
      row.last_cited = ts;
    }
  }

  return result;
}

export type SkillHealthStatus = 'archive-candidate' | 'stale' | 'new' | 'healthy';

export interface SkillHealthRow {
  slug: string;
  status: SkillHealthStatus;
  loads: number;
  citations: number;
  last_cited: string | null;
  days_since_cited: number | null;
}

/**
 * Apply deterministic skill-health thresholds to a usage block.
 *
 * Status values:
 *   - "archive-candidate": citations == 0 AND loads >= 5
 *     → loaded enough to judge, never cited → propose for removal
 *   - "stale": last_cited > 60 days ago (even with citations history)
 *     → was useful, hasn't fired recently
 *   - "new": loads < 5
 *     → still bedding in; don't judge yet
 *   - "healthy": cited within 60 days
 *     → still earning its place
 *
 * Sorted by status priority (archive > stale > new > healthy), then
 * by loads desc within each group. Highest-noise skills surface first.
 */
export function assessSkillHealth(usage: unknown, now: Date | null | undefined): SkillHealthRow[] {
  const safeUsage: Record<string, unknown> =
    (usage && typeof usage === 'object') ? (usage as Record<string, unknown>) : {};
  const safeNow = (now instanceof Date) ? now : new Date();
  const sixtyDaysAgoMs = safeNow.getTime() - (60 * 24 * 60 * 60 * 1000);

  const rows: SkillHealthRow[] = [];
  for (const [slug, entry] of Object.entries(safeUsage)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { loads?: unknown; citations?: unknown; last_cited?: unknown };

    const loads = Number(e.loads) || 0;
    const citations = Number(e.citations) || 0;
    const last_cited: string | null = typeof e.last_cited === 'string' ? e.last_cited : null;

    let status: SkillHealthStatus;
    let days_since_cited: number | null = null;

    if (loads < 5) {
      status = 'new';
    } else if (citations === 0) {
      status = 'archive-candidate';
    } else {
      // Has citations. Check recency.
      const lastCitedMs = last_cited ? Date.parse(last_cited) : null;
      if (lastCitedMs && lastCitedMs >= sixtyDaysAgoMs) {
        status = 'healthy';
        days_since_cited = Math.floor((safeNow.getTime() - lastCitedMs) / (24 * 60 * 60 * 1000));
      } else if (lastCitedMs) {
        status = 'stale';
        days_since_cited = Math.floor((safeNow.getTime() - lastCitedMs) / (24 * 60 * 60 * 1000));
      } else {
        // Has citations count but no timestamp (legacy / corrupted) — treat as stale.
        status = 'stale';
      }
    }

    rows.push({ slug, status, loads, citations, last_cited, days_since_cited });
  }

  // Sort: archive-candidates first, then stale, then new, then healthy.
  // Within each group, by loads descending (loudest first).
  const statusOrder: Record<SkillHealthStatus, number> = {
    'archive-candidate': 0,
    'stale': 1,
    'new': 2,
    'healthy': 3,
  };
  rows.sort((a, b) => {
    const da = statusOrder[a.status] ?? 99;
    const db = statusOrder[b.status] ?? 99;
    if (da !== db) return da - db;
    return b.loads - a.loads;
  });

  return rows;
}


/**
 * Render the health dashboard as a 3-column table for the CLI.
 */
export function formatHealthDashboard(rows: SkillHealthRow[] | null | undefined): string {
  if (!rows || rows.length === 0) {
    return (
      'Skill health: no usage data yet.\n\n' +
      'Skill-usage artifacts will start accumulating from your next\n' +
      'clud-bug-review run on a substantive PR (workflow-only PRs auto-skip\n' +
      'review via 0.0.W² and produce no artifact). Run this command again\n' +
      'with `--repo owner/name` once a few reviews have completed.'
    );
  }

  const STATUS_GLYPH: Record<SkillHealthStatus, string> = {
    'archive-candidate': '🟥 archive?',
    'stale': '🟨 stale',
    'new': '🟦 new',
    'healthy': '🟩 healthy',
  };

  const lines: string[] = [];
  lines.push('Skill health (deterministic — read-only; no automation acts on this)');
  lines.push('');
  lines.push('  STATUS            SLUG                              LOADS  CITES  LAST CITED');
  lines.push('  ----------------  --------------------------------  -----  -----  --------------');
  for (const r of rows) {
    const status = STATUS_GLYPH[r.status] || r.status;
    const slug = r.slug.length > 32 ? r.slug.slice(0, 29) + '...' : r.slug;
    const ago = r.days_since_cited != null ? `${r.days_since_cited}d ago` : '(never)';
    lines.push(
      `  ${status.padEnd(16)}  ${slug.padEnd(32)}  ${String(r.loads).padStart(5)}  ` +
      `${String(r.citations).padStart(5)}  ${ago}`
    );
  }
  lines.push('');
  lines.push('Thresholds:');
  lines.push('  archive-candidate = citations==0 + loads>=5');
  lines.push('  stale             = last cited >60 days ago');
  lines.push('  new               = loads<5 (still bedding in)');
  lines.push('  healthy           = cited within 60 days');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// v0.6.30 — cross-review aggregation
//
// The v0.6.29 workflow post-step uploads `.clud-bug.json` as a per-PR
// artifact named `clud-bug-skill-usage-pr-<N>` (90-day retention). This
// section walks the artifact stream + accumulates into one dashboard read.
//
// Artifact persistence design choice (recap from v0.6.29): we picked
// artifacts over commit-back-to-main because commit-back required
// `contents: write` permission expansion — v0.6.23 hit a regression
// from a similar expansion. Artifacts are GitHub-native, zero perm
// widening, zero commit noise. v0.6.30 reads them back here.
// ---------------------------------------------------------------------------

export interface GhRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface GhRunner {
  json: (args: string[]) => Promise<unknown>;
  run: (args: string[]) => Promise<GhRunResult>;
}

/**
 * Default `gh` runner — spawns the local gh CLI. Tests inject a mock.
 *
 * The runner has two methods:
 *   - json(args): returns parsed JSON stdout, or null on error.
 *   - run(args): returns {code, stdout, stderr}. For commands that
 *     download files etc. — no JSON parsing.
 */
async function defaultGhJson(args: string[]): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout!.on('data', (d: Buffer | string) => { stdout += d; });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

async function defaultGhRun(args: string[]): Promise<GhRunResult> {
  return new Promise<GhRunResult>((resolve) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer | string) => { stdout += d; });
    child.stderr!.on('data', (d: Buffer | string) => { stderr += d; });
    child.on('error', () => resolve({ code: 1, stdout: '', stderr: 'gh not on PATH' }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export const DEFAULT_GH_RUNNER: GhRunner = {
  json: defaultGhJson,
  run: defaultGhRun,
};

export interface FetchUsageArtifactsOptions {
  owner: string;
  repo: string;
  since?: Date | null | undefined;
  ghRunner?: GhRunner | undefined;
}

export interface UsageArtifactRecord {
  prNumber: number;
  artifactId: number;
  usage: SkillUsageMap;
  fetchedAt: string;
}

// One entry returned by `gh api .../actions/artifacts --jq '[...]'`.
interface ArtifactListItem {
  id: number;
  name: string;
  workflow_run_id: number;
  created_at: string;
}

/**
 * Fetch all per-PR skill-usage artifacts from a repo. Each artifact is
 * downloaded to a temp dir, its `.clud-bug.json` is parsed, and the
 * usage block is returned.
 */
export async function fetchUsageArtifacts(
  { owner, repo, since = null, ghRunner = DEFAULT_GH_RUNNER }: FetchUsageArtifactsOptions,
): Promise<UsageArtifactRecord[]> {
  if (!owner || !repo) {
    throw new Error('fetchUsageArtifacts: owner + repo are required');
  }

  // List artifacts in one call. We deliberately do NOT use `--paginate`:
  // `gh api --paginate --jq <expr>` applies the jq filter to EACH page
  // independently and concatenates the outputs with newlines, which
  // produces `[...]\n[...]` — invalid as a single JSON document.
  // `JSON.parse` returns null and the dashboard silently shows nothing
  // for repos with >30 artifacts (default page size). Caught by
  // clud-bug-review on PR #127.
  //
  // `?per_page=100` covers up to 100 artifacts in one call. The 90-day
  // artifact retention means most repos won't hit that ceiling (>100
  // PR reviews in 90 days = >1/day sustained). If a future repo
  // saturates this, paginate manually in v0.6.31+ (per_page=100 +
  // explicit `?page=N` loop, parse each response as JSON, concatenate).
  const list = await ghRunner.json([
    'api',
    `repos/${owner}/${repo}/actions/artifacts?per_page=100`,
    '--jq',
    '[.artifacts[] | select(.name | startswith("clud-bug-skill-usage-pr-")) | select(.expired == false) | {id, name, workflow_run_id: .workflow_run.id, created_at}]',
  ]);

  // `--jq '[...]'` wraps the stream into a single array. If the runner
  // returns null (404, no auth, etc.), bail to empty list.
  if (!Array.isArray(list)) return [];
  const items = list as ArtifactListItem[];

  const filtered = since
    ? items.filter((a) => new Date(a.created_at) >= since)
    : items;

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const results: UsageArtifactRecord[] = [];
  for (const art of filtered) {
    const prMatch = art.name.match(/^clud-bug-skill-usage-pr-(\d+)$/);
    if (!prMatch) continue;
    // prMatch[1] is `string | undefined` under noUncheckedIndexedAccess; the
    // regex guarantees the capture exists when match succeeds.
    const prNumber = Number(prMatch[1]!);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clud-bug-art-'));
    try {
      const dl = await ghRunner.run([
        'run', 'download', String(art.workflow_run_id),
        '-R', `${owner}/${repo}`,
        '-n', art.name,
        '-D', tmpDir,
      ]);
      if (dl.code !== 0) continue;

      // The workflow uploaded `.clud-bug.json` (single file under the
      // path key). `gh run download -D <dir>` writes it to the dest as
      // `<dir>/.clud-bug.json` (preserves the source path).
      const jsonPath = path.join(tmpDir, '.clud-bug.json');
      let parsed: unknown;
      try {
        const raw = await fs.readFile(jsonPath, 'utf-8');
        parsed = JSON.parse(raw);
      } catch {
        continue; // artifact corrupted or layout unexpected
      }
      const parsedObj = (parsed && typeof parsed === 'object')
        ? (parsed as { usage?: unknown })
        : {};
      const usage: SkillUsageMap = (parsedObj.usage && typeof parsedObj.usage === 'object')
        ? (parsedObj.usage as SkillUsageMap)
        : {};
      results.push({
        prNumber,
        artifactId: art.id,
        usage,
        fetchedAt: art.created_at,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  return results;
}

/**
 * Reduce an array of per-PR artifact records into a single accumulated
 * usage block by left-folding `mergeSkillUsage` over them, ordered by
 * `fetchedAt` ascending so the last_cited timestamp is deterministic.
 *
 * Because `mergeSkillUsage` is commutative for loads + citations counts
 * AND keeps the LATEST timestamp it sees as last_cited (we sort
 * ascending so newest wins on the final pass), out-of-order input
 * produces an identical result.
 */
export function aggregateUsageStream(
  artifacts: Array<{ usage: SkillUsageMap | null | undefined; fetchedAt: string }> | null | undefined,
): SkillUsageMap {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return {};
  const sorted = [...artifacts].sort(
    (a, b) => new Date(a.fetchedAt).getTime() - new Date(b.fetchedAt).getTime()
  );
  return sorted.reduce<SkillUsageMap>(
    // mergeSkillUsage expects SkillDeltaMap-shape for the delta arg; usage
    // here is SkillUsageMap (loads/citations counts match — only last_cited
    // is extra, which mergeSkillUsage ignores from the delta side). The
    // type assertion is safe and matches the JS prior behavior exactly.
    (acc, art) => mergeSkillUsage(acc, (art.usage || {}) as unknown as SkillDeltaMap, art.fetchedAt),
    {}
  );
}
