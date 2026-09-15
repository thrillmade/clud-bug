// CLI skill helpers — install/update commands that touch the filesystem.
//
// Split from lib/skills.js during the v0.7.0 TS migration. Pure helpers
// (SkillsClient, rankAndCap, partition/extract/select functions) live in
// src/core/skills.ts so the App can consume them without dragging
// node:fs into a serverless bundle.
//
// `_internal` debug-export removed: `sanitizeSlug`, `entryKey`,
// `MANIFEST_FILE` (the CLI-side pieces previously hidden under
// `_internal.X`) are now first-class named exports of this module.

import { mkdir, open, rename, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  SkillsClient,
  parseFrontmatter,
  type RankableSkill,
  type SkillDescriptor,
} from '../core/skills.js';

export const MANIFEST_FILE = '.clud-bug.json';
export const MANIFEST_VERSION = 1;

// Canonical home for clud-bug's baseline skills.
// PINNED TO A COMMIT SHA, NOT `main`. This re-couples the trust boundary
// to clud-bug releases: a compromised commit on agent-skills@main cannot
// silently land in users' Claude review skills mid-cycle. To roll new
// skill content, bump BASELINE_SKILLS_REF below in the same clud-bug PR
// that ships the corresponding bundled fallback update.
// See thrillmade/agent-skills — skills.sh `skills/<name>/SKILL.md` layout.
const BASELINE_SKILLS_REF = '1bec3149c54826bf58711b16a15754547ffc84bf';
const AGENT_SKILLS_BASE =
  process.env['CLUD_BUG_AGENT_SKILLS_BASE'] ??
  `https://raw.githubusercontent.com/thrillmade/agent-skills/${BASELINE_SKILLS_REF}/skills`;
const SKILL_FETCH_TIMEOUT_MS = 5000;
const SKILL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function sanitizeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function entryKey(entry: ManifestEntry): string {
  // Baseline skills have no source; key by slug. Remote skills key by source/name.
  return entry.kind === 'baseline'
    ? `baseline:${entry.slug}`
    : `${entry.source}/${entry.name || entry.slug}`;
}

// A baseline skill, as enumerated from the bundled npm-package directory.
// `content` is the raw SKILL.md text; `_source` is populated by loadBaseline
// to tell the CLI which provenance won (cached/remote agent-skills vs
// shipped bundled). Other consumers can ignore `_source`.
export interface BaselineSkill {
  source: string;
  name: string;
  description: string;
  installs: number;
  kind: string;
  content: string;
  _source?: 'agent-skills' | 'bundled';
}

export interface LoadBaselineOptions {
  fetch?: typeof globalThis.fetch | undefined;
  // `cacheDir: null` disables the on-disk cache; `undefined` uses the
  // default at ~/.cache/clud-bug/skills. exactOptionalPropertyTypes
  // requires the explicit `| undefined`.
  cacheDir?: string | null | undefined;
}

// Loads the baseline skills, preferring the pinned thrillmade/agent-skills
// commit and falling back to the bundled npm-package copy on any fetch failure.
// Returns the same shape as before, plus a `_source` of either 'agent-skills'
// or 'bundled' so the CLI can report which path was used.
//
// Options:
//   - fetch     — injectable for tests (defaults to globalThis.fetch)
//   - cacheDir  — where to cache fetched SKILL.md files (defaults to
//                 ~/.cache/clud-bug/skills/, skipped if null)
export async function loadBaseline(
  baselineDir: string,
  opts: LoadBaselineOptions = {},
): Promise<BaselineSkill[]> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const cacheDir =
    opts.cacheDir === null ? null : (opts.cacheDir ?? join(homedir(), '.cache', 'clud-bug', 'skills'));

  // First, enumerate the bundled baseline skills (source of truth for which
  // names exist). Then fetch each in parallel — sequential awaits would
  // stack timeouts (3 baselines × 5s = 15s before fallback when offline).
  const bundled = await readBundled(baselineDir);
  const remotes = await Promise.all(
    bundled.map((s) => tryFetchSkill(s.name, fetchImpl, cacheDir)),
  );
  return bundled.map((skill, i) => {
    const remote = remotes[i];
    return remote
      ? { ...skill, content: remote, _source: 'agent-skills' as const }
      : { ...skill, _source: 'bundled' as const };
  });
}

// Reads the bundled baseline from the npm-package directory.
async function readBundled(baselineDir: string): Promise<BaselineSkill[]> {
  const skills: BaselineSkill[] = [];
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

/**
 * Reads the bundled design-kit skills from the npm-package directory. Unlike
 * `loadBaseline`, these are first-party and **bundled-only** — no skills.sh
 * fetch (there's no upstream for them). Stamped `kind: 'design'` + `source:
 * 'clud-bug-design'` so `diffManifest` / `refresh` never drop them.
 */
export async function loadDesignKit(designDir: string): Promise<WritableSkill[]> {
  const skills: WritableSkill[] = [];
  let entries;
  try {
    entries = await readdir(designDir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const content = await readFile(join(designDir, entry.name), 'utf8');
    const fallbackName = entry.name.replace(/\.md$/, '');
    let name = fallbackName;
    let description = '(design kit)';
    try {
      const fm = parseFrontmatter(content);
      if (fm.name) name = fm.name;
      if (fm.description) description = fm.description;
    } catch {
      // Malformed frontmatter on a first-party file — fall back to the filename.
    }
    skills.push({ source: 'clud-bug-design', name, description, installs: 0, kind: 'design', content });
  }
  return skills;
}

// Try to read from cache, then fall back to network. Returns the SKILL.md
// content string on success, null on any failure (caller falls back to bundled).
async function tryFetchSkill(
  name: string,
  fetchImpl: typeof globalThis.fetch,
  cacheDir: string | null,
): Promise<string | null> {
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

async function readFromCache(cacheDir: string, name: string): Promise<string | null> {
  const path = cachePath(cacheDir, name);
  try {
    const st = await stat(path);
    if (Date.now() - st.mtimeMs > SKILL_CACHE_TTL_MS) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function writeToCache(cacheDir: string, name: string, content: string): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath(cacheDir, name), content);
  } catch {
    // Cache write failures are non-fatal — we already have the content.
  }
}

function cachePath(cacheDir: string, name: string): string {
  // Include AGENT_SKILLS_BASE in the hash so different upstream URLs (e.g.
  // a fork via CLUD_BUG_AGENT_SKILLS_BASE, or a different pinned SHA after
  // a clud-bug release) get different cache entries. Otherwise switching
  // bases would silently return the previously-cached content from a
  // different upstream — cross-base cache poisoning.
  const hash = createHash('sha256')
    .update(`${AGENT_SKILLS_BASE}\n${name}`)
    .digest('hex')
    .slice(0, 16);
  return join(cacheDir, `${hash}.md`);
}

// A skill ready for write: must have a name and source (or a baseline-style
// `kind: 'baseline'`). Either pre-bundled `content`, or omit and let
// SkillsClient.getContent fetch from skills.sh. The `content` field is
// inherited from RankableSkill / SkillDescriptor; no redeclaration here
// (exactOptionalPropertyTypes treats `content?: string` and
// `content?: string | undefined` as incompatible).
export type WritableSkill = RankableSkill;

// One row of the per-repo manifest at .claude/skills/.clud-bug.json.
export interface ManifestEntry {
  slug: string;
  name: string;
  source: string;
  kind: string;
  description: string;
}

export interface Manifest {
  version: number;
  installed: ManifestEntry[];
  // Phase ZP2: explicit repo opt-out of the default-on notary. `false` means
  // "self-attest, never notarize"; absent/anything else defers to
  // `readNotaryConfig`'s env-var-then-default resolution. Declared here (not
  // just read ad hoc) so the manifest shape documents the field.
  notary?: boolean;
  // #319 — SPEC 2.0 §6.7's declaration: the command the pre-push hook's
  // mechanical check runs, or the literal "none". Written by `clud-bug init`
  // (which asks — §6.7: "Setup MUST ask, and MUST NOT complete without an
  // answer") and read by `buildPrePushHookScript` FROM THE DEFAULT BRANCH,
  // never from this file in the working tree (§6.3). Declared here so the
  // manifest shape documents the field the way `notary` above does.
  tests?: string;
  // Caller-set fields (pinVersion, lastUpdate, lastUpdateVersion) survive
  // merges via spread; type as an open record to keep extensibility.
  [key: string]: unknown;
}

export async function writeSkills(
  targetDir: string,
  skills: WritableSkill[],
  client: SkillsClient,
): Promise<ManifestEntry[]> {
  await mkdir(targetDir, { recursive: true });
  const written: ManifestEntry[] = [];
  for (const skill of skills) {
    const entry = await writeSkill(targetDir, skill, client);
    written.push(entry);
  }
  await writeManifest(targetDir, mergeManifest(await readManifest(targetDir), written));
  return written;
}

export async function writeSkill(
  targetDir: string,
  skill: WritableSkill,
  client: SkillsClient,
): Promise<ManifestEntry> {
  await mkdir(targetDir, { recursive: true });
  const slug = sanitizeSlug(skill.name);
  const skillDir = join(targetDir, slug);
  await mkdir(skillDir, { recursive: true });
  const content = skill.content ?? (await client.getContent(skill.source, skill.name));
  await writeFile(join(skillDir, 'SKILL.md'), content);
  return {
    slug,
    name: skill.name,
    source: skill.source,
    kind: skill.kind || 'remote',
    description: skill.description || '',
  };
}

// #271: the tolerant read below is what every READER wants (SPEC §1.6:243 —
// a file a consumer cannot make sense of must not fail the review). It is
// wrong for a WRITER: a swallowed parse error returns a FRESH EMPTY manifest,
// and the `writeManifest` that follows then deletes the repository's whole
// configuration over a stray comma. `{ strict: true }` is for the write paths
// — it distinguishes "no file yet" (still the empty manifest; that is how a
// first install looks) from "a file I could not parse, or could not even read"
// (throw, write nothing).
export interface ReadManifestOptions {
  strict?: boolean;
}

export async function readManifest(
  targetDir: string,
  options: ReadManifestOptions = {},
): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(join(targetDir, MANIFEST_FILE), 'utf8');
  } catch (err) {
    // ENOENT is the only read failure that means "no file yet". A write path
    // must not read EACCES/EIO as absence either — the empty manifest it
    // returns is what `writeManifest` would then persist over the real one.
    if (options.strict && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `${join(targetDir, MANIFEST_FILE)} could not be read (${(err as Error).message}). ` +
        'Nothing was written — fix the file by hand, then run this again.',
      );
    }
    return { version: MANIFEST_VERSION, installed: [] };
  }
  try {
    const data = JSON.parse(text) as Partial<Manifest> & Record<string, unknown>;
    return {
      ...data,
      version: data.version || MANIFEST_VERSION,
      installed: Array.isArray(data.installed) ? data.installed : [],
    };
  } catch (err) {
    if (options.strict) {
      throw new Error(
        `${join(targetDir, MANIFEST_FILE)} is not valid JSON (${(err as Error).message}). ` +
        'Nothing was written — fix the file by hand, then run this again.',
      );
    }
    return { version: MANIFEST_VERSION, installed: [] };
  }
}

// The on-disk byte format, in one place: two-space JSON and a trailing
// newline. `clud-bug config` serializes through this too, so the file a
// `config set` leaves behind and the file `init` writes are the same shape.
export function serializeManifest(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

// #271 — the one way the manifest bytes are replaced. `writeFile` truncates
// and then writes, so a reader arriving mid-write (the pre-push hook, a
// concurrent `config get`) gets a file that is valid JSON only by luck; the
// concurrency test for `config set` reproduced exactly that, reporting
// "Unexpected end of JSON input" on a file nobody had corrupted. A rename over
// the target cannot be observed half-done.
export async function writeManifestBytes(
  targetDir: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, MANIFEST_FILE);
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, serializeManifest(manifest));
  try {
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function writeManifest(targetDir: string, manifest: Manifest): Promise<void> {
  // Preserve any additional fields callers want to stamp (e.g. lastUpdate,
  // lastUpdateVersion, pinVersion). Only `version` and `installed` are normalized.
  const out: Manifest = {
    ...manifest,
    version: manifest.version || MANIFEST_VERSION,
    installed: manifest.installed || [],
  };
  await writeManifestBytes(targetDir, out as unknown as Record<string, unknown>);
}

// #271 — a `config set` is a read, a decision, and a write, and three of them
// racing lost whole keys: each read the same bytes and each wrote its own
// one-key edit over them, at exit 0. Serializing them is what scales past two
// — the compare in `writeManifestFile` (config.ts) can only refuse, and three
// commands refusing each other is a worse answer than three that wait.
const LOCK_FILE = `${MANIFEST_FILE}.lock`;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 15;
// A lock older than this whose owner is gone is a crash, not a slow write.
const LOCK_STALE_MS = 60_000;

/**
 * Run `fn` serialized against every other holder of this lock in `targetDir`,
 * across processes.
 *
 * Today that is `clud-bug config set` and `config unset`, and nothing else:
 * `init`, `update`, `add` and `remove` replace the manifest atomically through
 * `writeManifestBytes` but do not take the lock. What the lock buys is that
 * two invocations of the command cannot lose each other's writes.
 *
 * Against those four, the command compares the bytes it read before it writes
 * (`writeManifestFile` in config.ts), so one of them landing in its window is
 * a refusal rather than a silent drop. The reverse is still open: any of the
 * four reads, does its work, and writes its own object back over a `config
 * set` that landed meanwhile — that setting is gone, and nothing says so.
 * Closing it means this lock around their read-to-write spans too.
 *
 * The lock is a file created with `wx` — one syscall, and the loser of the
 * race gets EEXIST rather than a second lock. It holds the owning pid so a
 * lock left by a process that died is recognised as stale immediately, rather
 * than wedging every later write for as long as the timeout.
 */
export async function withManifestLock<T>(
  targetDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(targetDir, { recursive: true });
  const path = join(targetDir, LOCK_FILE);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(`${process.pid}\n`);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (await lockIsStale(path)) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `${join(targetDir, MANIFEST_FILE)} is being written by another clud-bug ` +
          `(${path}). Nothing was written — run it again once that one has finished, or ` +
          'delete that lock file if no clud-bug is running.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(path, { force: true });
  }
}

/** A lock whose owner is gone, or one older than any real write. */
async function lockIsStale(path: string): Promise<boolean> {
  let owner: number | null = null;
  let age = 0;
  try {
    const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const pid = Number.parseInt(text.trim(), 10);
    owner = Number.isInteger(pid) && pid > 0 ? pid : null;
    age = Date.now() - stats.mtimeMs;
  } catch {
    // Gone between the EEXIST and here — the holder released it. Not stale;
    // the next acquire attempt is the one that matters.
    return false;
  }
  if (owner !== null && owner !== process.pid) {
    try {
      // Signal 0 tests for the process without touching it. ESRCH means the
      // holder is gone; EPERM means it is alive and someone else's.
      process.kill(owner, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
  }
  return age > LOCK_STALE_MS;
}

export function mergeManifest(existing: Manifest, newEntries: ManifestEntry[]): Manifest {
  const byKey = new Map<string, ManifestEntry>();
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

export async function removeSkill(targetDir: string, slug: string): Promise<ManifestEntry> {
  const manifest = await readManifest(targetDir);
  const entry = manifest.installed.find((e) => e.slug === slug);
  if (!entry) {
    throw new Error(
      `'${slug}' is not in the clud-bug manifest. If it's a custom skill, delete it manually with: rm -rf .claude/skills/${slug}`,
    );
  }
  await rm(join(targetDir, slug), { recursive: true, force: true });
  manifest.installed = manifest.installed.filter((e) => e.slug !== slug);
  await writeManifest(targetDir, manifest);
  return entry;
}

export interface InstalledGroups {
  baseline: ManifestEntry[];
  remote: ManifestEntry[];
  custom: Array<{ slug: string; kind: 'custom'; description: string }>;
}

export async function listInstalled(targetDir: string): Promise<InstalledGroups> {
  const manifest = await readManifest(targetDir);
  const managedSlugs = new Set(manifest.installed.map((e) => e.slug));
  const groups: InstalledGroups = { baseline: [], remote: [], custom: [] };
  for (const entry of manifest.installed) {
    if (entry.kind === 'baseline') {
      groups.baseline.push(entry);
    } else {
      groups.remote.push(entry);
    }
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

export interface ManifestDiff {
  add: RankableSkill[];
  remove: ManifestEntry[];
  unchanged: RankableSkill[];
}

// Diff a current manifest against a freshly-recommended skill set.
// Returns { add: [], remove: [], unchanged: [] }. Custom skills are never affected.
export function diffManifest(manifest: Manifest, recommended: RankableSkill[]): ManifestDiff {
  const recByKey = new Map<string, RankableSkill>(
    recommended.map((s) => [
      s.kind === 'baseline' ? `baseline:${sanitizeSlug(s.name)}` : `${s.source}/${s.name}`,
      s,
    ]),
  );
  const installedByKey = new Map<string, ManifestEntry>(
    manifest.installed.map((e) => [entryKey(e), e]),
  );

  const add: RankableSkill[] = [];
  const remove: ManifestEntry[] = [];
  const unchanged: RankableSkill[] = [];

  for (const [key, skill] of recByKey) {
    if (installedByKey.has(key)) {
      unchanged.push(skill);
    } else {
      add.push(skill);
    }
  }
  for (const [key, entry] of installedByKey) {
    // Baseline + design-kit skills are first-party opt-ins, not skills.sh
    // recommendations — `refresh` must never drop them just because they're
    // absent from the recommended set.
    if (entry.kind === 'baseline' || entry.kind === 'design') continue;
    if (!recByKey.has(key)) remove.push(entry);
  }
  return { add, remove, unchanged };
}

// Re-export for callers that previously imported SkillDescriptor through
// lib/skills.js (the type lived alongside the value exports). This keeps
// the v0.6.x consumer ergonomics intact during the migration.
export type { SkillDescriptor };
