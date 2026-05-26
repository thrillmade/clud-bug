import { mkdir, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const API_BASE = 'https://skills.sh/api/v1';
const MAX_SKILLS = 8;
const MANIFEST_FILE = '.clud-bug.json';
const MANIFEST_VERSION = 1;

// Canonical home for clud-bug's baseline skills.
// PINNED TO A COMMIT SHA, NOT `main`. This re-couples the trust boundary
// to clud-bug releases: a compromised commit on agent-skills@main cannot
// silently land in users' Claude review skills mid-cycle. To roll new
// skill content, bump BASELINE_SKILLS_REF below in the same clud-bug PR
// that ships the corresponding bundled fallback update.
// See thrillmot/agent-skills — skills.sh `skills/<name>/SKILL.md` layout.
const BASELINE_SKILLS_REF = 'a44559770686e6c51d08ba5bb842d78f85876fb2';
const AGENT_SKILLS_BASE = process.env.CLUD_BUG_AGENT_SKILLS_BASE
  ?? `https://raw.githubusercontent.com/thrillmot/agent-skills/${BASELINE_SKILLS_REF}/skills`;
const SKILL_FETCH_TIMEOUT_MS = 5000;
const SKILL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 24h

export class SkillsClient {
  constructor({ fetch = globalThis.fetch, base, userAgent = 'clud-bug' } = {}) {
    this.fetch = fetch;
    this.base = base ?? process.env.CLUD_BUG_SKILLS_SH_BASE ?? API_BASE;
    this.userAgent = userAgent;
  }

  async #json(path) {
    const res = await this.fetch(`${this.base}${path}`, {
      headers: { 'User-Agent': this.userAgent, accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`skills.sh ${path} → ${res.status}`);
    }
    return res.json();
  }

  async search(terms) {
    const q = terms.filter(Boolean).join(' ').trim();
    if (!q) return [];
    const data = await this.#json(`/skills/search?q=${encodeURIComponent(q)}`);
    return normalizeList(data);
  }

  async curated() {
    const data = await this.#json('/skills/curated');
    return normalizeList(data);
  }

  async getContent(source, name) {
    const data = await this.#json(`/skills/${encodeURIComponent(source)}/${encodeURIComponent(name)}`);
    // The API may return content as `body`, `content`, or under `files[0].content`.
    // Try the documented shapes in order; fail loudly if none match so we know
    // the API contract changed.
    if (typeof data?.content === 'string') return data.content;
    if (typeof data?.body === 'string') return data.body;
    if (typeof data?.files?.[0]?.content === 'string') return data.files[0].content;
    throw new Error(`skills.sh response for ${source}/${name} had no content field`);
  }
}

function normalizeList(data) {
  // Tolerate either { skills: [...] } or a bare array.
  const list = Array.isArray(data) ? data : (data?.skills || data?.results || []);
  return list.map(item => ({
    source: item.source || item.repo || '',
    name: item.name || item.slug || '',
    description: item.description || item.summary || '',
    installs: item.installs || item.installCount || 0,
  })).filter(s => s.source && s.name);
}

// Deduplicates by source/name and caps at MAX_SKILLS, preferring curated then by install count.
export function rankAndCap(curated, searched, baseline, cap = MAX_SKILLS) {
  const seen = new Set(baseline.map(b => `local:${b.name}`));
  const out = [...baseline];
  const remaining = cap - baseline.length;
  if (remaining <= 0) return out.slice(0, cap);

  const curatedSorted = [...curated].sort((a, b) => b.installs - a.installs);
  const searchedSorted = [...searched].sort((a, b) => b.installs - a.installs);

  for (const skill of [...curatedSorted, ...searchedSorted]) {
    if (out.length >= cap) break;
    const key = `${skill.source}/${skill.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...skill, kind: skill.kind || 'remote' });
  }
  return out;
}

// Loads the baseline skills, preferring the pinned thrillmot/agent-skills
// commit and falling back to the bundled npm-package copy on any fetch failure.
// Returns the same shape as before, plus a `_source` of either 'agent-skills'
// or 'bundled' so the CLI can report which path was used.
//
// Options:
//   - fetch     — injectable for tests (defaults to globalThis.fetch)
//   - cacheDir  — where to cache fetched SKILL.md files (defaults to
//                 ~/.cache/clud-bug/skills/, skipped if null)
export async function loadBaseline(baselineDir, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const cacheDir = opts.cacheDir === null ? null
    : (opts.cacheDir ?? join(homedir(), '.cache', 'clud-bug', 'skills'));

  // First, enumerate the bundled baseline skills (source of truth for which
  // names exist). Then fetch each in parallel — sequential awaits would
  // stack timeouts (3 baselines × 5s = 15s before fallback when offline).
  const bundled = await readBundled(baselineDir);
  const remotes = await Promise.all(
    bundled.map((s) => tryFetchSkill(s.name, fetchImpl, cacheDir)),
  );
  return bundled.map((skill, i) => remotes[i]
    ? { ...skill, content: remotes[i], _source: 'agent-skills' }
    : { ...skill, _source: 'bundled' });
}

// Reads the bundled baseline from the npm-package directory.
async function readBundled(baselineDir) {
  const skills = [];
  let entries;
  try {
    entries = await readdir(baselineDir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const content = await readFile(join(baselineDir, entry.name), 'utf8');
    skills.push({
      source: 'clud-bug-baseline',
      name: entry.name.replace(/\.md$/, ''),
      description: '(baseline)',
      installs: 0,
      kind: 'baseline',
      content,
    });
  }
  return skills;
}

// Try to read from cache, then fall back to network. Returns the SKILL.md
// content string on success, null on any failure (caller falls back to bundled).
async function tryFetchSkill(name, fetchImpl, cacheDir) {
  // Cache lookup first.
  if (cacheDir) {
    const cached = await readFromCache(cacheDir, name);
    if (cached !== null) return cached;
  }

  // Network fetch with timeout covering BOTH the connection AND the body
  // read (clearTimeout in finally guarantees the timer doesn't keep the
  // event loop alive for up to 5s past a failed CLI run).
  const url = `${AGENT_SKILLS_BASE}/${encodeURIComponent(name)}/SKILL.md`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SKILL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const content = await res.text();
    if (!content || !content.trim()) return null;
    if (cacheDir) await writeToCache(cacheDir, name, content);
    return content;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readFromCache(cacheDir, name) {
  const path = cachePath(cacheDir, name);
  try {
    const st = await stat(path);
    if (Date.now() - st.mtimeMs > SKILL_CACHE_TTL_MS) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function writeToCache(cacheDir, name, content) {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath(cacheDir, name), content);
  } catch {
    // Cache write failures are non-fatal — we already have the content.
  }
}

function cachePath(cacheDir, name) {
  // Include AGENT_SKILLS_BASE in the hash so different upstream URLs (e.g.
  // a fork via CLUD_BUG_AGENT_SKILLS_BASE, or a different pinned SHA after
  // a clud-bug release) get different cache entries. Otherwise switching
  // bases would silently return the previously-cached content from a
  // different upstream — cross-base cache poisoning.
  const hash = createHash('sha256').update(`${AGENT_SKILLS_BASE}\n${name}`).digest('hex').slice(0, 16);
  return join(cacheDir, `${hash}.md`);
}

export async function writeSkills(targetDir, skills, client) {
  await mkdir(targetDir, { recursive: true });
  const written = [];
  for (const skill of skills) {
    const entry = await writeSkill(targetDir, skill, client);
    written.push(entry);
  }
  await writeManifest(targetDir, mergeManifest(await readManifest(targetDir), written));
  return written;
}

export async function writeSkill(targetDir, skill, client) {
  await mkdir(targetDir, { recursive: true });
  const slug = sanitizeSlug(skill.name);
  const skillDir = join(targetDir, slug);
  await mkdir(skillDir, { recursive: true });
  const content = skill.content ?? await client.getContent(skill.source, skill.name);
  await writeFile(join(skillDir, 'SKILL.md'), content);
  return {
    slug,
    name: skill.name,
    source: skill.source,
    kind: skill.kind || 'remote',
    description: skill.description || '',
  };
}

export async function readManifest(targetDir) {
  try {
    const text = await readFile(join(targetDir, MANIFEST_FILE), 'utf8');
    const data = JSON.parse(text);
    return {
      ...data,
      version: data.version || MANIFEST_VERSION,
      installed: Array.isArray(data.installed) ? data.installed : [],
    };
  } catch {
    return { version: MANIFEST_VERSION, installed: [] };
  }
}

export async function writeManifest(targetDir, manifest) {
  await mkdir(targetDir, { recursive: true });
  // Preserve any additional fields callers want to stamp (e.g. lastUpdate,
  // lastUpdateVersion, pinVersion). Only `version` and `installed` are normalized.
  const out = {
    ...manifest,
    version: manifest.version || MANIFEST_VERSION,
    installed: manifest.installed || [],
  };
  await writeFile(join(targetDir, MANIFEST_FILE), JSON.stringify(out, null, 2) + '\n');
}

export function mergeManifest(existing, newEntries) {
  const byKey = new Map();
  for (const entry of existing.installed || []) {
    byKey.set(entryKey(entry), entry);
  }
  for (const entry of newEntries) {
    byKey.set(entryKey(entry), entry);
  }
  // Spread `existing` so caller-set fields (pinVersion, lastUpdate,
  // lastUpdateVersion, etc.) survive merges performed by writeSkills /
  // refresh / add. Only `installed` is rebuilt; everything else carries.
  return { ...existing, version: MANIFEST_VERSION, installed: [...byKey.values()] };
}

function entryKey(entry) {
  // Baseline skills have no source; key by slug. Remote skills key by source/name.
  return entry.kind === 'baseline' ? `baseline:${entry.slug}` : `${entry.source}/${entry.name || entry.slug}`;
}

export async function removeSkill(targetDir, slug) {
  const manifest = await readManifest(targetDir);
  const entry = manifest.installed.find(e => e.slug === slug);
  if (!entry) {
    throw new Error(`'${slug}' is not in the clud-bug manifest. If it's a custom skill, delete it manually with: rm -rf .claude/skills/${slug}`);
  }
  await rm(join(targetDir, slug), { recursive: true, force: true });
  manifest.installed = manifest.installed.filter(e => e.slug !== slug);
  await writeManifest(targetDir, manifest);
  return entry;
}

export async function listInstalled(targetDir) {
  const manifest = await readManifest(targetDir);
  const managedSlugs = new Set(manifest.installed.map(e => e.slug));
  const groups = { baseline: [], remote: [], custom: [] };
  for (const entry of manifest.installed) {
    (groups[entry.kind === 'baseline' ? 'baseline' : 'remote']).push(entry);
  }

  let entries;
  try {
    entries = await readdir(targetDir, { withFileTypes: true });
  } catch {
    return groups;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (managedSlugs.has(entry.name)) continue;
    const skillFile = join(targetDir, entry.name, 'SKILL.md');
    let description = '';
    try {
      const text = await readFile(skillFile, 'utf8');
      const m = text.match(/^description:\s*(.+)$/m);
      description = m?.[1]?.trim() || '';
    } catch {
      continue; // not a skill dir
    }
    groups.custom.push({ slug: entry.name, kind: 'custom', description });
  }
  return groups;
}

// Diff a current manifest against a freshly-recommended skill set.
// Returns { add: [], remove: [], unchanged: [] }. Custom skills are never affected.
export function diffManifest(manifest, recommended) {
  const recByKey = new Map(recommended.map(s => [
    s.kind === 'baseline' ? `baseline:${sanitizeSlug(s.name)}` : `${s.source}/${s.name}`,
    s,
  ]));
  const installedByKey = new Map(manifest.installed.map(e => [entryKey(e), e]));

  const add = [];
  const remove = [];
  const unchanged = [];

  for (const [key, skill] of recByKey) {
    if (installedByKey.has(key)) {
      unchanged.push(skill);
    } else {
      add.push(skill);
    }
  }
  for (const [key, entry] of installedByKey) {
    if (entry.kind === 'baseline') continue; // baseline always stays
    if (!recByKey.has(key)) remove.push(entry);
  }
  return { add, remove, unchanged };
}

function sanitizeSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

// Extract the `review_mode` field from a SKILL.md's frontmatter.
//
// Contract (from the v0.6 plan, option D-unified):
//   - `shared`    → the skill loads alongside other shared skills in ONE
//                   Claude call. Bug-finding baselines + most skills.sh
//                   contributions live here; they benefit from cross-
//                   correlation (an evidence-based finding flagged for
//                   critical-issues-only also gets the convention check).
//   - `dedicated` → the skill gets its OWN focused Claude call. Reserved
//                   for domain-specific skills (brand voice, compliance,
//                   API-contract) where attention dilution at high skill
//                   counts is the real failure mode.
//   - Missing field → default to `shared`. Conservative: the skill loads,
//                   no surprise per-skill API cost. Users opt skills INTO
//                   `dedicated` by authoring the field.
//
// The CLI runtime (v0.5.9) honors this via prompt restructuring inside a
// single claude-code-action call. The v0.6 GitHub App will use the same
// field to route to literal parallel API calls. Single source of truth.
export function readReviewMode(skillContent) {
  if (typeof skillContent !== 'string') return 'shared';
  // Scope to the YAML frontmatter block (between the first two `---` lines).
  // A `review_mode:` line in the body is documentation, not configuration.
  const fm = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return 'shared';
  const m = fm[1].match(/^review_mode:\s*(\S+)\s*$/m);
  if (!m) return 'shared';
  // Strip optional YAML string-quotes — `review_mode: "dedicated"` and
  // `review_mode: 'dedicated'` are both valid YAML, but the (\S+) capture
  // grabs the quotes too. Without this, quoted forms silently fell back
  // to `shared` even though the author clearly meant dedicated.
  const value = m[1].toLowerCase().replace(/^["']|["']$/g, '');
  return value === 'dedicated' ? 'dedicated' : 'shared';
}

// Partition a set of loaded skills into {shared, dedicated} buckets per
// each skill's review_mode frontmatter. Expects skills with a `content`
// field (SKILL.md text). Skills without content default to `shared`.
//
// Shape: input is the same skill objects produced by loadBaseline /
// writeSkills / listInstalled. Output is two arrays of the same shape;
// caller decides what to do with each bucket.
export function partitionByReviewMode(skills) {
  const shared = [];
  const dedicated = [];
  for (const skill of skills) {
    const mode = readReviewMode(skill?.content);
    (mode === 'dedicated' ? dedicated : shared).push(skill);
  }
  return { shared, dedicated };
}

// Pull the line for `skillName` from a clud-bug review's `### Per-skill scan`
// block. The block format (set by the v3+ prompt) is one line per loaded skill:
//
//   ### Per-skill scan
//   - [critical-issues-only]: scanned all paths. 2 critical findings below.
//   - [brand-voice-review]: scanned 3 microcopy changes. 1 finding (below).
//   - [pii-and-compliance]: scanned analytics + logging. 0 findings.
//
// Returns the OUTCOME portion (everything after the `- [name]: ` prefix), with
// trailing whitespace stripped. Returns null if the skill isn't mentioned, the
// comment has no Per-skill scan block, or `comment` is empty.
//
// The brackets in the line prefix anchor the match so a partial-name collision
// (e.g. `brand-voice` finding `brand-voice-review`) is impossible.
export function extractPerSkillLine(comment, skillName) {
  if (typeof comment !== 'string' || !comment) return null;
  if (typeof skillName !== 'string' || !skillName) return null;
  // Escape regex metacharacters in the skill name. A skill name with a `.` or
  // `+` would otherwise alter the match. Skills are conventionally kebab-case,
  // but defense in depth is cheap.
  const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchor on the bracket-prefix; tolerate optional leading whitespace and
  // dash. The OUTCOME is everything from after `]:` to end-of-line.
  const re = new RegExp(`^\\s*-\\s*\\[${escaped}\\]:\\s*(.+?)\\s*$`, 'm');
  const m = comment.match(re);
  return m ? m[1] : null;
}

// Find the latest clud-bug review header line from a list of PR comments.
// Source of truth for the v0.5.x strict-mode-gate header selection — the
// composite action shells out to node + this helper rather than parsing
// in bash, so the gate has unit-test coverage and the v0.6 App can reuse
// the same logic.
//
// Contract (called by .github/actions/strict-mode-gate/action.yml):
//   - Walk `comments` (newest-first per gh api ?sort=created&direction=desc).
//   - Skip comments not authored by `botLogin`.
//   - For each remaining comment, find the FIRST line starting with the
//     H2 sentinel `## 🐛 Clud Bug review`. If present, return that line.
//   - Return null if no matching comment exists.
//
// Why this isn't `comments.find(c => c.body.startsWith("## 🐛 Clud Bug review"))`:
// claude-code-action prepends a `**Claude finished @user's task in Nm Ns**`
// preamble to every bot comment, so the H2 review header never appears at
// body position 0. The pre-v0.5.12 composite used `.body | startswith(...)`
// in jq and matched ZERO comments in practice — silently disabling strict
// mode on every install with strictMode: true. Caught when this repo
// dogfooded BB.3 on PR #60: bot wrote "— critical findings" header, gate
// passed anyway.
//
// The line-anchored extraction preserves the original "don't trip on
// quoted sentinels in body text" property: a comment that mentions the
// strict-mode header in prose (inline-code, blockquote) won't match
// because the quoted version isn't at start-of-line.
export function selectReviewHeader(comments, botLogin) {
  if (!Array.isArray(comments)) return null;
  if (typeof botLogin !== 'string' || !botLogin) return null;
  for (const c of comments) {
    if (!c || typeof c !== 'object') continue;
    const author = c.user?.login;
    const body = c.body;
    if (author !== botLogin || typeof body !== 'string') continue;
    const headerLine = extractFirstReviewHeaderLine(body);
    if (headerLine) return headerLine;
  }
  return null;
}

// Pull the FIRST line of `body` that starts with the H2 sentinel.
// Exported separately so callers can extract a header from a known body
// without re-running the comment filter (useful in tests + the v0.6 App).
export function extractFirstReviewHeaderLine(body) {
  if (typeof body !== 'string') return null;
  const m = body.match(/^## 🐛 Clud Bug review[^\n]*/m);
  return m ? m[0] : null;
}

// Decide whether a review-header line is the strict-mode "critical findings"
// verdict that should fail the gate. Mirrors the v0.5.x bash predicate
// `grep -q "Clud Bug review — critical findings"`.
//
// Returns false for null/non-string input so a "no header found" path
// (selectReviewHeader returning null) safely falls through to the gate
// passing — which is the right posture: if the bot didn't post a review
// with the strict-mode header, there's nothing for the gate to fail on.
// "Loud failure for missing manifest" is handled upstream in the composite.
export function isCriticalReviewHeader(headerLine) {
  if (typeof headerLine !== 'string') return false;
  return /Clud Bug review — critical findings/.test(headerLine);
}

// Classify a Per-skill scan outcome line into the check-run conclusion the
// composite action will emit for that skill. Source of truth for the BB.3
// gate decision — the v0.5.10 composite shells out to node + this helper
// rather than parsing in bash, so the gate has unit-test coverage and the
// v0.6 App can reuse the same classification when it routes its own
// parallel calls.
//
// Contract:
//   - `null` (skill not mentioned in the review) → 'failure'
//   - line contains "0 findings" / "0 finding" as a STANDALONE TOKEN → 'success'
//   - line contains "n/a" as a standalone token → 'success'
//   - empty line (bot emitted "- [name]:" with no outcome) → 'failure'
//   - otherwise (typically "N finding" / "N findings" with N>0) → 'failure'
//
// Why null → failure (not neutral): GitHub's branch-protection contract
// treats `conclusion: neutral` as PASSING for required status checks —
// only `failure`, `cancelled`, `timed_out`, `action_required` block merge.
// A strictSkills entry that doesn't appear in the per-skill scan block
// (typo, prompt regression, mid-review race) emitting `neutral` would
// silently pass branch protection, defeating the gate the user opted into.
// Failing loud is the right posture for a gate that ships with "strict" in
// its name; the cost is a re-run if a bot mid-review somehow drops a skill.
//
// The "0 findings" match is anchored on a leading word boundary so "10
// findings" / "100 findings" don't substring-match to success — the exact
// bug that v0.5.10's first revision had, caught by clud-bug-review + claude-
// review on PR #57.
export function classifyPerSkillOutcome(outcomeLine) {
  if (outcomeLine == null) return 'failure';
  const text = String(outcomeLine);
  // 0 findings / 0 finding — anchored: NOT preceded by a digit. So "10 findings"
  // doesn't match (the `0 findings` substring has `1` before it), and "0
  // findings" / " 0 findings." both match.
  if (/(^|[^0-9])0\s+findings?\b/i.test(text)) return 'success';
  // n/a — anchored on word boundaries either side (so "n/a." at sentence end
  // matches but "diagnostics" would not contain a matching n/a).
  if (/\bn\/a\b/i.test(text)) return 'success';
  return 'failure';
}

export const _internal = { normalizeList, sanitizeSlug, entryKey, MAX_SKILLS, API_BASE, MANIFEST_FILE };
