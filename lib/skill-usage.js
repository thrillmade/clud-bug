// lib/skill-usage.js — Component 1+2 of the pragmatic SkDD pivot.
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

/**
 * Compute per-skill usage delta from a single review's structured JSON.
 *
 * @param {object} reviewJson - Parsed structured-output JSON from one
 *   clud-bug review. Expected shape (subset of review-schema.js):
 *     - per_skill_scan: [{ skill, outcome }, ...]
 *     - critical_findings: [{ skill, ... }, ...]
 *     - minor_findings: [{ skill, ... }, ...]
 *     - dedicated_sections: [{ skill, findings: [...] }, ...]
 *
 * @returns {object} - Per-skill delta:
 *     { "<slug>": { loads: 1, citations: 0|1 } }
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
export function computeSkillUsageDelta(reviewJson) {
  if (!reviewJson || typeof reviewJson !== 'object') return {};

  const delta = {};

  // Loads — one per skill that scanned.
  for (const entry of reviewJson.per_skill_scan || []) {
    if (!entry || typeof entry.skill !== 'string') continue;
    const slug = entry.skill;
    if (!delta[slug]) delta[slug] = { loads: 0, citations: 0 };
    delta[slug].loads = 1;
  }

  // Citations — collect unique skill slugs across all finding buckets.
  const cited = new Set();
  const collect = (findings) => {
    for (const f of findings || []) {
      if (f && typeof f.skill === 'string') cited.add(f.skill);
    }
  };
  collect(reviewJson.critical_findings);
  collect(reviewJson.minor_findings);
  collect(reviewJson.preexisting_findings);
  for (const section of reviewJson.dedicated_sections || []) {
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
 * @param {object} existing - Current usage block (may be empty/missing).
 *   Shape: { "<slug>": { loads: int, citations: int, last_cited: string|null } }
 * @param {object} delta - From computeSkillUsageDelta (above).
 * @param {string|null} timestamp - ISO 8601 timestamp of THIS review
 *   (e.g., "2026-05-30T16:22:26Z"). Used to update last_cited when the
 *   skill is cited in this review. Pass null to skip the timestamp
 *   update (rarely useful — tests primarily).
 *
 * @returns {object} - New merged usage block (does NOT mutate inputs).
 *
 * Semantics:
 *   - existing.loads + delta.loads → new.loads (accumulates forever)
 *   - existing.citations + delta.citations → new.citations
 *   - last_cited updates only when delta.citations > 0 (i.e., cited
 *     in THIS review). Stays at the prior value otherwise.
 *   - New skills (not in existing) get initialized fresh.
 */
export function mergeSkillUsage(existing, delta, timestamp) {
  const safeExisting = (existing && typeof existing === 'object') ? existing : {};
  const result = {};

  // Copy all existing skills first (preserve skills NOT in this delta).
  for (const [slug, entry] of Object.entries(safeExisting)) {
    if (entry && typeof entry === 'object') {
      result[slug] = {
        loads: Number(entry.loads) || 0,
        citations: Number(entry.citations) || 0,
        last_cited: entry.last_cited || null,
      };
    }
  }

  // Merge delta.
  for (const [slug, d] of Object.entries(delta || {})) {
    if (!result[slug]) {
      result[slug] = { loads: 0, citations: 0, last_cited: null };
    }
    result[slug].loads += Number(d.loads) || 0;
    result[slug].citations += Number(d.citations) || 0;
    if ((Number(d.citations) || 0) > 0 && timestamp) {
      result[slug].last_cited = timestamp;
    }
  }

  return result;
}

/**
 * Apply deterministic skill-health thresholds to a usage block.
 *
 * @param {object} usage - The usage block from mergeSkillUsage.
 * @param {Date} now - The current time (injected for testability).
 *
 * @returns {object[]} - Sorted array of:
 *     { slug, status, loads, citations, last_cited, days_since_cited }
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
export function assessSkillHealth(usage, now) {
  const safeUsage = (usage && typeof usage === 'object') ? usage : {};
  const safeNow = (now instanceof Date) ? now : new Date();
  const sixtyDaysAgoMs = safeNow.getTime() - (60 * 24 * 60 * 60 * 1000);

  const rows = [];
  for (const [slug, entry] of Object.entries(safeUsage)) {
    if (!entry || typeof entry !== 'object') continue;

    const loads = Number(entry.loads) || 0;
    const citations = Number(entry.citations) || 0;
    const last_cited = entry.last_cited || null;

    let status;
    let days_since_cited = null;

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
  const statusOrder = { 'archive-candidate': 0, 'stale': 1, 'new': 2, 'healthy': 3 };
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
 *
 * @param {object[]} rows - Output of assessSkillHealth.
 * @returns {string} - Multi-line markdown-ish table for stdout.
 */
export function formatHealthDashboard(rows) {
  if (!rows || rows.length === 0) {
    return (
      'Skill health: no usage data yet.\n\n' +
      'Usage data accumulates after clud-bug reviews land in your repo.\n' +
      'v0.6.29 wires up per-review delta writes via the workflow post-step\n' +
      'and uploads them as 90-day artifacts. v0.6.30 will add cross-review\n' +
      'aggregation so this dashboard reads the full artifact stream.'
    );
  }

  const STATUS_GLYPH = {
    'archive-candidate': '🟥 archive?',
    'stale': '🟨 stale',
    'new': '🟦 new',
    'healthy': '🟩 healthy',
  };

  const lines = [];
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

/**
 * Default `gh` runner — spawns the local gh CLI. Tests inject a mock.
 *
 * The runner has two methods:
 *   - json(args): returns parsed JSON stdout, or null on error.
 *   - run(args): returns {code, stdout, stderr}. For commands that
 *     download files etc. — no JSON parsing.
 */
async function defaultGhJson(args) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

async function defaultGhRun(args) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', () => resolve({ code: 1, stdout: '', stderr: 'gh not on PATH' }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export const DEFAULT_GH_RUNNER = {
  json: defaultGhJson,
  run: defaultGhRun,
};

/**
 * Fetch all per-PR skill-usage artifacts from a repo. Each artifact is
 * downloaded to a temp dir, its `.clud-bug.json` is parsed, and the
 * usage block is returned.
 *
 * @param {object} opts
 * @param {string} opts.owner - GitHub repo owner.
 * @param {string} opts.repo - GitHub repo name.
 * @param {Date|null} opts.since - Filter to artifacts created on/after this date.
 * @param {object} opts.ghRunner - Injected gh CLI runner (see DEFAULT_GH_RUNNER).
 *
 * @returns {Promise<{prNumber: number, artifactId: number, usage: object, fetchedAt: string}[]>}
 */
export async function fetchUsageArtifacts({ owner, repo, since = null, ghRunner = DEFAULT_GH_RUNNER }) {
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

  const filtered = since
    ? list.filter((a) => new Date(a.created_at) >= since)
    : list;

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');

  const results = [];
  for (const art of filtered) {
    const prMatch = art.name.match(/^clud-bug-skill-usage-pr-(\d+)$/);
    if (!prMatch) continue;
    const prNumber = Number(prMatch[1]);

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
      let parsed;
      try {
        const raw = await fs.readFile(jsonPath, 'utf-8');
        parsed = JSON.parse(raw);
      } catch {
        continue; // artifact corrupted or layout unexpected
      }
      const usage = parsed && parsed.usage ? parsed.usage : {};
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
 *
 * @param {{usage: object, fetchedAt: string}[]} artifacts
 * @returns {object} accumulated usage block, shape matches mergeSkillUsage output
 */
export function aggregateUsageStream(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return {};
  const sorted = [...artifacts].sort(
    (a, b) => new Date(a.fetchedAt) - new Date(b.fetchedAt)
  );
  return sorted.reduce(
    (acc, art) => mergeSkillUsage(acc, art.usage || {}, art.fetchedAt),
    {}
  );
}
