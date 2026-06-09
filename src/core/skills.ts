// Pure skill helpers — no FS, only the network via injectable fetch.
//
// Split from lib/skills.js during the v0.7.0 TS migration. The App
// (clud-bug-app) consumes these for review-time skill routing without
// pulling node:fs into the serverless bundle. CLI-only install/update
// helpers live in src/cli/skills.ts.
//
// The `_internal` debug-export pattern from lib/skills.js is removed
// here: every helper that needed test access has been promoted to a
// direct named export. Constants (`MAX_SKILLS`, `API_BASE`) and the
// shape normaliser (`normalizeList`) are now first-class core exports.

export const API_BASE = 'https://skills.sh/api/v1';
export const MAX_SKILLS = 8;

// Skill descriptors as returned by skills.sh after normaliseList()
// massages the API shape. The CLI install path adds further fields
// (`kind`, `content`) before passing to writeSkill — we type the
// result loosely with optional fields so a single shape works for
// both core (search results, ranking) and cli (write+manifest) sites.
export interface SkillDescriptor {
  source: string;
  name: string;
  description: string;
  installs: number;
  kind?: string;
  content?: string;
}

// Raw shape coming back from skills.sh. Tolerant: some endpoints return
// { skills: [...] }, some a bare array, some { results: [...] }, and
// individual items may use `source` or `repo`, `name` or `slug`.
type RawSkillItem = {
  source?: string;
  repo?: string;
  name?: string;
  slug?: string;
  description?: string;
  summary?: string;
  installs?: number;
  installCount?: number;
};

type RawSkillListResponse =
  | RawSkillItem[]
  | { skills?: RawSkillItem[]; results?: RawSkillItem[] }
  | unknown;

export function normalizeList(data: RawSkillListResponse): SkillDescriptor[] {
  // Tolerate either { skills: [...] } or a bare array.
  const list: RawSkillItem[] = Array.isArray(data)
    ? data
    : ((data as { skills?: RawSkillItem[]; results?: RawSkillItem[] } | null)?.skills
        || (data as { results?: RawSkillItem[] } | null)?.results
        || []);
  return list
    .map((item) => ({
      source: item.source || item.repo || '',
      name: item.name || item.slug || '',
      description: item.description || item.summary || '',
      installs: item.installs || item.installCount || 0,
    }))
    .filter((s) => s.source && s.name);
}

interface SkillsClientOptions {
  fetch?: typeof globalThis.fetch;
  base?: string;
  userAgent?: string;
}

export class SkillsClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly base: string;
  private readonly userAgent: string;

  constructor({ fetch = globalThis.fetch, base, userAgent = 'clud-bug' }: SkillsClientOptions = {}) {
    this.fetch = fetch;
    this.base = base ?? process.env['CLUD_BUG_SKILLS_SH_BASE'] ?? API_BASE;
    this.userAgent = userAgent;
  }

  async #json(path: string): Promise<unknown> {
    const res = await this.fetch(`${this.base}${path}`, {
      headers: { 'User-Agent': this.userAgent, accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`skills.sh ${path} → ${res.status}`);
    }
    return res.json();
  }

  async search(terms: string[]): Promise<SkillDescriptor[]> {
    const q = terms.filter(Boolean).join(' ').trim();
    if (!q) return [];
    const data = await this.#json(`/skills/search?q=${encodeURIComponent(q)}`);
    return normalizeList(data);
  }

  async curated(): Promise<SkillDescriptor[]> {
    const data = await this.#json('/skills/curated');
    return normalizeList(data);
  }

  async getContent(source: string, name: string): Promise<string> {
    const data = (await this.#json(
      `/skills/${encodeURIComponent(source)}/${encodeURIComponent(name)}`,
    )) as { content?: unknown; body?: unknown; files?: Array<{ content?: unknown }> } | null;
    // The API may return content as `body`, `content`, or under `files[0].content`.
    // Try the documented shapes in order; fail loudly if none match so we know
    // the API contract changed.
    if (typeof data?.content === 'string') return data.content;
    if (typeof data?.body === 'string') return data.body;
    const first = data?.files?.[0]?.content;
    if (typeof first === 'string') return first;
    throw new Error(`skills.sh response for ${source}/${name} had no content field`);
  }
}

// Used by rankAndCap input. Allows mixing baseline skills (which carry a
// `kind: 'baseline'`) with remote ones. Matches the cli-side shape too.
export interface RankableSkill extends SkillDescriptor {
  kind?: string;
}

// Deduplicates by source/name and caps at MAX_SKILLS, preferring curated then by install count.
export function rankAndCap(
  curated: RankableSkill[],
  searched: RankableSkill[],
  baseline: RankableSkill[],
  cap: number = MAX_SKILLS,
): RankableSkill[] {
  const seen = new Set(baseline.map((b) => `local:${b.name}`));
  const out: RankableSkill[] = [...baseline];
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
export function readReviewMode(skillContent: unknown): 'shared' | 'dedicated' {
  if (typeof skillContent !== 'string') return 'shared';
  // Scope to the YAML frontmatter block (between the first two `---` lines).
  // A `review_mode:` line in the body is documentation, not configuration.
  const fm = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return 'shared';
  const m = (fm[1] as string).match(/^review_mode:\s*(\S+)\s*$/m);
  if (!m) return 'shared';
  // Strip optional YAML string-quotes — `review_mode: "dedicated"` and
  // `review_mode: 'dedicated'` are both valid YAML, but the (\S+) capture
  // grabs the quotes too. Without this, quoted forms silently fell back
  // to `shared` even though the author clearly meant dedicated.
  const value = (m[1] as string).toLowerCase().replace(/^["']|["']$/g, '');
  return value === 'dedicated' ? 'dedicated' : 'shared';
}

export interface AppliesToRule {
  paths: string[];
  extensions: string[];
}

// 0.0.K (v0.6.21): parse the optional `applies_to:` frontmatter block.
//
// Schema:
//   applies_to:
//     paths:
//       - "src/ui/**"
//       - "lib/components/**"
//     extensions: [".tsx", ".jsx"]
//
// Returns `{paths: string[], extensions: string[]}` if the field is
// present (either sub-list optional, both default to empty array), or
// `null` if absent. Skills without applies_to are scope-universal —
// the caller should treat null as "load unconditionally."
//
// Hand-rolled YAML parser scoped to this exact shape. The frontmatter
// is otherwise opaque (review_mode is parsed elsewhere with a similar
// single-key regex), so pulling in a YAML dep would be overkill.
export function readAppliesTo(skillContent: unknown): AppliesToRule | null {
  if (typeof skillContent !== 'string') return null;
  const fm = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const block = fm[1] as string;
  // Anchor on `applies_to:` at start of line (the body of a SKILL.md
  // could mention the term in prose; only the frontmatter key fires).
  const head = block.match(/^applies_to:\s*$/m);
  if (!head) return null;
  // Slice from after the `applies_to:` line; the block ends at the
  // next top-level key (a line starting with a word character + `:`)
  // OR end-of-block.
  // `head.index` is defined here because String.prototype.match returns
  // a RegExpMatchArray with `index` set when the regex is non-global.
  const startIdx = (head.index as number) + head[0].length;
  const rest = block.slice(startIdx);
  const stop = rest.search(/^\w[\w-]*:/m);
  const scoped = stop === -1 ? rest : rest.slice(0, stop);
  const paths = parseYamlList(scoped, 'paths');
  const extensions = parseYamlList(scoped, 'extensions');
  if (paths.length === 0 && extensions.length === 0) return null;
  return { paths, extensions };
}

// Parse a YAML list under `<key>:`, handling both the inline-array
// form (`extensions: [".tsx", ".jsx"]`) and the block form
// (`paths:` followed by `  - "src/ui/**"` lines).
function parseYamlList(block: string, key: string): string[] {
  const inline = block.match(new RegExp(`^\\s{2}${key}:\\s*\\[(.*?)\\]\\s*$`, 'm'));
  if (inline) {
    return (inline[1] as string)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  const headerRe = new RegExp(`^\\s{2}${key}:\\s*$`, 'm');
  const head = block.match(headerRe);
  if (!head) return [];
  const after = block.slice((head.index as number) + head[0].length);
  const items: string[] = [];
  for (const line of after.split('\n')) {
    const item = line.match(/^\s{4,}-\s*(.+?)\s*$/);
    if (item) {
      items.push((item[1] as string).replace(/^["']|["']$/g, ''));
      continue;
    }
    // Anything that isn't a list item (or blank) ends the list.
    if (line.trim() !== '' && !item) break;
  }
  return items;
}

// 0.0.K: does `prPaths` contain at least one file matching the skill's
// applies_to? Skills without applies_to ALWAYS apply (back-compat).
//
// `prPaths` is the list of changed files in the PR (e.g. from
// `gh pr diff --name-only`). Match semantics:
//   - paths: any glob in `paths` matches any of `prPaths`
//   - extensions: any extension in `extensions` matches any of `prPaths`
//   - paths OR extensions (NOT AND) — a single hit is enough
//
// Skill `paths` use the minimal glob set logmind already uses
// (`*` matches non-slash, `**` matches across slashes, `?` single
// char). Anything fancier would need a real glob lib.
export function appliesToPr(skillContent: unknown, prPaths: unknown): boolean {
  const rule = readAppliesTo(skillContent);
  if (rule === null) return true; // back-compat: no rule → applies
  if (!Array.isArray(prPaths)) return true; // be permissive on bad input
  for (const path of prPaths) {
    if (typeof path !== 'string') continue;
    for (const ext of rule.extensions) {
      if (path.endsWith(ext)) return true;
    }
    for (const glob of rule.paths) {
      if (globMatch(glob, path)) return true;
    }
  }
  return false;
}

// Minimal glob → regex: `**` → `.*`, `*` → `[^/]*`, `?` → `.`,
// everything else escaped. Anchored full-string match.
function globMatch(glob: string, path: string): boolean {
  const escaped = glob
    .replace(/([.+^${}()|[\]\\])/g, '\\$1')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(path);
}

// Loose shape of a "skill" object as it flows through the runtime. Caller
// may attach `content` (the SKILL.md text) for partitioning decisions.
export interface SkillWithOptionalContent {
  content?: unknown;
  [key: string]: unknown;
}

// Partition a set of loaded skills into {shared, dedicated} buckets per
// each skill's review_mode frontmatter. Expects skills with a `content`
// field (SKILL.md text). Skills without content default to `shared`.
//
// Shape: input is the same skill objects produced by loadBaseline /
// writeSkills / listInstalled. Output is two arrays of the same shape;
// caller decides what to do with each bucket.
export function partitionByReviewMode<T extends SkillWithOptionalContent>(
  skills: T[],
): { shared: T[]; dedicated: T[] } {
  const shared: T[] = [];
  const dedicated: T[] = [];
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
export function extractPerSkillLine(comment: unknown, skillName: unknown): string | null {
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
  return m ? (m[1] as string) : null;
}

// Minimal shape of a PR comment (subset of GitHub's REST schema) used by
// selectReviewHeader / selectReviewBody. `body` and `user.login` are
// the only fields we actually read; `created_at` is used for sorting.
export interface PrComment {
  body?: unknown;
  user?: { login?: unknown };
  created_at?: unknown;
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
export function selectReviewHeader(comments: unknown, botLogin: unknown): string | null {
  if (!Array.isArray(comments)) return null;
  if (typeof botLogin !== 'string' || !botLogin) return null;
  // Sort newest-first by created_at. The composite passes the result of
  // `gh api .../comments?sort=created&direction=desc` — but GitHub's
  // REST issue-comments endpoint ignores `direction=desc` and returns
  // ascending (oldest first) regardless. PR #64 caught this: the gate
  // was selecting the OLDER "— critical findings" comment instead of
  // the newer "— clean" follow-up, so fix-push reviews that resolved
  // critical findings still failed the gate. Explicit sort here makes
  // selection deterministic regardless of upstream API quirks.
  const sorted: PrComment[] = [...(comments as PrComment[])].sort((a, b) => {
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

// Pull the FIRST line of `body` that starts with the H2 sentinel.
// Exported separately so callers can extract a header from a known body
// without re-running the comment filter (useful in tests + the v0.6 App).
export function extractFirstReviewHeaderLine(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  const m = body.match(/^## 🐛 Clud Bug review[^\n]*/m);
  return m ? m[0] : null;
}

// Companion to selectReviewHeader: returns the FULL BODY of the latest
// clud-bug review comment from `botLogin`, not just its header line.
// Same filter contract (line-anchored H2 sentinel, claude-code-action
// preamble tolerated). Used by the BB.3 per-skill check-runs step,
// which needs the body to extract per-skill outcome lines from the
// "### Per-skill scan" block — the header alone isn't enough.
//
// Returns null if no matching comment exists. The composite action
// treats null as "no review yet; emit no check-runs" (the same posture
// that pre-v0.5.12 bash code intended via the `[ -z "$LATEST" ]` branch,
// only now actually reachable instead of always-fires-due-to-bug).
//
// Same-bug fix as selectReviewHeader: PR #61 caught that BB.3 step 2
// of the composite still used the broken `.body | startswith(...)` jq
// filter even after step 1 was refactored, leaving per-skill check-runs
// silently disabled on every install with strictSkills since v0.5.10.
export function selectReviewBody(comments: unknown, botLogin: unknown): string | null {
  if (!Array.isArray(comments)) return null;
  if (typeof botLogin !== 'string' || !botLogin) return null;
  // Same explicit newest-first sort as selectReviewHeader — gh api
  // ignores direction=desc on issue-comments and returns ascending,
  // so without this BB.3 was parsing per-skill outcomes from the
  // OLDEST review comment, not the latest. See selectReviewHeader.
  const sorted: PrComment[] = [...(comments as PrComment[])].sort((a, b) => {
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

export interface ReviewStatsHeader {
  important: number;
  nit: number;
  preExisting: number;
}

// Extract the v0.6.5+ stats header line "Found: N 🔴 / N 🟡 / N 🟣"
// from a review comment body. Returns {important, nit, preExisting} when
// found, null otherwise. The header lets agents reading the comment on a
// re-review triage at a glance — on the common zero-findings case, the
// header IS the entire substantive payload, so an ingest can short-circuit
// without parsing the body.
//
// The match is intentionally permissive on whitespace around the slashes
// and tolerates 1+ digits for each count. Severity emoji are matched
// literally — a future bot revision that changes the emoji would break
// this parser loudly, which is the intended behavior (catches drift).
export function extractStatsHeader(comment: unknown): ReviewStatsHeader | null {
  if (typeof comment !== 'string' || !comment) return null;
  const re = /Found:\s*(\d+)\s*🔴\s*\/\s*(\d+)\s*🟡\s*\/\s*(\d+)\s*🟣/u;
  const m = comment.match(re);
  if (!m) return null;
  return {
    important: parseInt(m[1] as string, 10),
    nit: parseInt(m[2] as string, 10),
    preExisting: parseInt(m[3] as string, 10),
  };
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
export function isCriticalReviewHeader(headerLine: unknown): boolean {
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
export function classifyPerSkillOutcome(outcomeLine: unknown): 'failure' | 'success' {
  if (outcomeLine == null) return 'failure';
  const text = String(outcomeLine);

  // HARD-FAILURE OVERRIDE: any positive finding count → failure.
  // `\b[1-9]\d*\s+(?:\w+\s+){0,3}finding` matches "1 finding",
  // "2 critical findings", "10 findings", "100 minor findings below".
  // Up to 3 intermediate words allow modifiers like "critical"/"minor".
  // The `\b[1-9]` anchor (vs `[0-9]`) excludes `0` — so this never
  // shadows the "0 findings" success case below. Also: "10 findings"
  // is correctly classified failure because `\b1` matches at the
  // word boundary before `1`, then `\d*` consumes `0`.
  if (/\b[1-9]\d*\s+(?:\w+\s+){0,3}finding/i.test(text)) return 'failure';

  // SUCCESS PATTERNS — broadened in v0.5.16 to handle natural bot
  // phrasings without enumerating every synonym. The bot's review
  // prompt encourages canonical "0 findings" wording but variance
  // is real (e.g. "no findings to anchor", "0 critical findings").

  // (1) Zero-finding count, optionally with up to 3 modifier words.
  //     Matches: "0 findings", "0 critical findings", "no findings",
  //     "zero performance findings", "no findings to anchor".
  //     Does NOT match: "10 findings" (handled above), "all findings",
  //     "applied to all findings".
  if (/\b(?:0|no|zero)\s+(?:\S+\s+){0,3}finding/i.test(text)) return 'success';

  // (2) n/a — word-bounded. Matches "n/a.", "n/a — no surface here",
  //     " n/a " surrounded by anything. Excludes "diagnostics" etc.
  if (/\bn\/a\b/i.test(text)) return 'success';

  // (3) "not applicable" — explicit phrase.
  if (/\bnot\s+applicable\b/i.test(text)) return 'success';

  // (4) Checkmark (✓) as the bot's universal clean signal. Anchored on
  //     whitespace/punctuation on both sides so accidental ✓ inside
  //     other content (e.g. quoting a checkbox list) doesn't trip it.
  //     Matches "applied to all findings. ✓ all anchored." but not
  //     "see ✓item-marker in unicode" or similar.
  if (/(?:^|\s)✓(?:\s|$|[.,;:])/.test(text)) return 'success';

  // Skill-specific vocabulary like "0 pattern fights" (no `finding` word)
  // falls through to failure here. Skill authors should prefer the
  // canonical "0 findings" wording in their per-skill scan lines so
  // this classifier doesn't need per-skill vocabulary knowledge.
  return 'failure';
}

// ---------------------------------------------------------------------------
// SKILL.md frontmatter parser (ported from clud-bug-app/lib/skills-loader.ts).
//
// The App's `loadSkillsFromBaseRef` Octokit fetcher stays App-side (depends
// on Octokit). The PURE parser belongs in core so both the App and any
// future CLI runtime that wants to read SKILL.md frontmatter without an
// Octokit dependency can use it. SPEC §1.10 is the frontmatter contract.
// ---------------------------------------------------------------------------

/** Source provenance for an installed skill (see SPEC §1.10). */
export type SkillSource =
  | 'manual'
  | 'logmind-derived'
  | 'skills-sh'
  | 'clud-bug-baseline';

export type SkillReviewMode = 'shared' | 'dedicated';

/**
 * Parsed SKILL.md frontmatter. The App uses this shape (see
 * `clud-bug-app/lib/skills-loader.ts:40`); the prompt builder's
 * `PromptSkillFrontmatter` is a narrower subset (name + description +
 * applies_to) so we keep the full shape here.
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  source: SkillSource | string; // string fallback for forward-compat
  review_mode: SkillReviewMode;
  applies_to?: {
    paths?: string[];
    extensions?: string[];
  };
}

/**
 * Minimal YAML frontmatter parser. Handles:
 *   - `key: value`            (scalar)
 *   - `key: [a, b, c]`        (inline list)
 *   - `key:\n  subkey: value` (one-level nesting — applies_to)
 *
 * Throws on malformed input; the App's `loadSkillsFromBaseRef` catches
 * and skips the skill (a bad SKILL.md doesn't take down the whole review).
 *
 * Deliberately NOT a general-purpose YAML parser — SPEC §1.10 fixes the
 * frontmatter schema to a handful of fields. If the schema grows beyond
 * what this hand-rolled parser handles, swap to `js-yaml` — the boundary
 * is this function.
 */
export function parseFrontmatter(raw: string): SkillFrontmatter {
  // Frontmatter MUST be the literal `---\n...\n---\n` at the file head.
  // We tolerate a leading BOM and trailing whitespace.
  const trimmed = raw.replace(/^﻿/, '');
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error('missing YAML frontmatter');
  }
  const body = match[1] ?? '';
  const lines = body.split(/\r?\n/);

  const out: Record<string, unknown> = {};
  let currentNested: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    // Comment line; YAML allows '#' as a comment marker at column 0.
    if (line.trim().startsWith('#')) continue;

    // Nested-block lines start with whitespace (e.g. "  paths: [...]").
    const isIndented = /^\s/.test(line);
    if (isIndented && currentNested) {
      const nested = out[currentNested] as Record<string, unknown> | undefined;
      if (!nested) continue;
      const trimmedLine = line.trim();
      const colon = trimmedLine.indexOf(':');
      if (colon === -1) continue;
      const key = trimmedLine.slice(0, colon).trim();
      const value = trimmedLine.slice(colon + 1).trim();
      nested[key] = parseScalarOrList(value);
      continue;
    }

    // Top-level key.
    currentNested = null;
    const colon = line.indexOf(':');
    if (colon === -1) {
      throw new Error(`malformed frontmatter line: ${line}`);
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    if (value === '') {
      // Block — next indented lines populate this key as a nested map.
      out[key] = {};
      currentNested = key;
      continue;
    }
    out[key] = parseScalarOrList(value);
  }

  // Validate the SPEC-required fields are present and apply documented
  // defaults for optional ones.
  const name = String(out['name'] ?? '').trim();
  if (!name) throw new Error('frontmatter.name is required');
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) {
    throw new Error(`frontmatter.name is not a valid kebab-case slug: ${name}`);
  }
  const description = String(out['description'] ?? '').trim();
  if (!description) throw new Error('frontmatter.description is required');

  const source = String(out['source'] ?? 'manual').trim();
  const reviewMode: SkillReviewMode =
    out['review_mode'] === 'dedicated' ? 'dedicated' : 'shared';

  const appliesToRaw = out['applies_to'] as
    | { paths?: unknown; extensions?: unknown }
    | undefined;
  let appliesTo: SkillFrontmatter['applies_to'] | undefined;
  if (appliesToRaw) {
    const paths = Array.isArray(appliesToRaw.paths)
      ? appliesToRaw.paths.map(String)
      : undefined;
    const extensions = Array.isArray(appliesToRaw.extensions)
      ? appliesToRaw.extensions.map(String)
      : undefined;
    appliesTo = {
      ...(paths !== undefined ? { paths } : {}),
      ...(extensions !== undefined ? { extensions } : {}),
    };
  }

  return {
    name,
    description,
    source,
    review_mode: reviewMode,
    ...(appliesTo !== undefined ? { applies_to: appliesTo } : {}),
  };
}

function parseScalarOrList(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    // Inline list: [a, "b", 'c'] → ['a', 'b', 'c']
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  // Strip surrounding quotes; YAML allows both ' and ".
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Strip the leading `---\n...\n---\n` from a SKILL.md file. Returns the
 * markdown body (the part the LLM actually reads).
 *
 * Ported from `clud-bug-app/lib/skills-loader.ts:269` so callers don't have
 * to re-implement the regex.
 */
export function stripFrontmatter(raw: string): string {
  const trimmed = raw.replace(/^﻿/, '');
  const match = trimmed.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return trimmed;
  return trimmed.slice(match[0].length);
}
