import type { SkillFrontmatter } from './skills.js';

/**
 * Multi-pass review config resolution.
 *
 * Each skill carries an effective `{ count, mode }` pair that drives how many
 * AI calls the reviewer makes for that skill and how the orchestrator
 * aggregates findings.
 *
 * Resolution precedence (highest → lowest):
 *   1. `.clud-bug.json` `reviewPasses.perSkill[<slug>]`           — per-skill consumer override
 *   2. SKILL.md frontmatter `review_passes` (parsed from base ref) — skill author intent
 *   3. `.clud-bug.json` `reviewPasses.default` / top-level fields  — repo default
 *   4. Hard-coded built-in `{ count: 1, mode: "cross-check" }`     — D.2.5 baseline
 *
 * Hard cap: `count` is clamped to `MAX_PASSES = 3`. The plan calls this a
 * brick wall — there is no escape hatch via config. Anything above gets
 * silently clamped + logged. Three Claude calls per skill per review is the
 * outer envelope before cost becomes user-hostile.
 *
 * The orchestrator uses the resolved entry to:
 *   - decide how many passes to run per skill (or per shared-skill bundle when
 *     `applyTo === "shared-only"`)
 *   - pass the right role / model to `runStructuredReview`
 *   - hand the aggregator the right mode
 *
 * SKILL.md frontmatter is read by the App's skills loader. We don't bake the
 * parsing into the loader to keep that module simple — instead, the loader
 * surfaces `frontmatter.review_passes` as opaque and we coerce it here. The
 * loader is unchanged for D.2.5 — it just preserves any `review_passes` block
 * verbatim through `stripFrontmatter` → body, which we never need to touch.
 *
 * NOTE: The loader currently only validates well-known fields. SKILL.md
 * `review_passes` arrives via a NEW frontmatter pass we expose here as
 * `extractSkillReviewPassesOverride` — the loader's `parseFrontmatter` doesn't
 * preserve unknown top-level keys, but this helper re-parses the raw
 * frontmatter on the side, so D.2.5 is additive (no breaking change to
 * D.2.0 callers / tests).
 *
 * Decoupled from the App's `LoadedSkill` on the port to `clud-bug/core`:
 * `resolveReviewPasses` accepts the minimal `{ slug, frontmatter }` shape
 * (where `frontmatter` is the core `SkillFrontmatter`) so the engine has no
 * dependency on the App's skills loader.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The three review modes. See module doc for semantics. */
export type ReviewPassMode = 'cross-check' | 'consensus' | 'independent';

export const REVIEW_PASS_MODES: readonly ReviewPassMode[] = [
  'cross-check',
  'consensus',
  'independent',
] as const;

/** Apply scope. `shared-only` restricts multi-pass to shared (default) skills. */
export type ApplyTo = 'all' | 'shared-only';

/** The smallest config unit per skill. */
export interface ReviewPassesEntry {
  /** Number of independent passes (1..MAX_PASSES). Always positive. */
  count: number;
  /** Aggregation mode. Only meaningful when count >= 2. */
  mode: ReviewPassMode;
}

/**
 * Reviewer-role tier abstraction. The orchestrator keys on the tier (not the
 * display `name`) when it needs to reason about reviewer strength
 * independent of the human-facing label:
 *   - `beetle`  → fast first-pass reviewer (Sonnet-class).
 *   - `wasp`    → deeper cross-check / consensus reviewer (Opus-class).
 *   - `mantis`  → arbiter / third-pass reviewer (Opus-class).
 *
 * `name` + `model` stay for back-compat (inline attribution + AI-Gateway
 * routing); `tier` is additive and optional so config-supplied roles that
 * omit it still validate.
 */
export type ReviewRoleTier = 'beetle' | 'wasp' | 'mantis';

/** One role definition; pairs a label ("Beetle") with a model slug. */
export interface ReviewRole {
  /** Display name. Surfaced inline in the comment per the spec. */
  name: string;
  /** AI Gateway model slug, e.g. `anthropic/claude-sonnet-4.6`. */
  model: string;
  /** Optional reviewer tier. See ReviewRoleTier. */
  tier?: ReviewRoleTier;
}

/** Full resolved per-skill config exposed to the orchestrator. */
export interface ResolvedReviewPasses {
  /** The skill slug this entry applies to. */
  slug: string;
  /** Number of passes to run for this skill. Always >= 1. */
  count: number;
  /** Aggregation mode. */
  mode: ReviewPassMode;
  /** Roles, in pass order. May have fewer entries than `count`; we recycle. */
  roles: ReviewRole[];
  /**
   * Provenance — which precedence layer produced the chosen count.
   * Useful in tests + logs to verify the precedence chain.
   */
  source:
    | 'perSkill'
    | 'frontmatter'
    | 'repoDefault'
    | 'builtin';
}

/**
 * Shape of `reviewPasses` in `.clud-bug.json`.
 *
 * We accept two layouts (per the plan):
 *
 *   // (A) flat — repo-wide single setting
 *   "reviewPasses": {
 *     "count": 2,
 *     "mode": "cross-check",
 *     "applyTo": "all",
 *     "roles": [{ "name": "Beetle", "model": "..." }]
 *   }
 *
 *   // (B) split — default + perSkill overrides
 *   "reviewPasses": {
 *     "default": { "count": 1, "mode": "cross-check" },
 *     "perSkill": { "security-audit": { "count": 3 } },
 *     "roles": [...]
 *   }
 *
 * (B) supersedes (A) when both are present; the flat keys are read as the
 * `default` block. Roles are read from the outer object regardless.
 */
export interface ReviewPassesConfig {
  count?: number;
  mode?: ReviewPassMode;
  applyTo?: ApplyTo;
  roles?: ReviewRole[];
  default?: Partial<ReviewPassesEntry>;
  perSkill?: Record<string, Partial<ReviewPassesEntry>>;
}

/** Frontmatter shape (subset) — only the bit D.2.5 cares about. */
export interface SkillReviewPassesFrontmatter {
  count?: number;
  mode?: ReviewPassMode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap, enforced silently. Plan: count > 3 is brand-damaging cost. */
export const MAX_PASSES = 3;

/** Floor, enforced silently. Negative / zero / non-integer collapses to 1. */
export const MIN_PASSES = 1;

/** Built-in defaults — pre-config bottom of the precedence stack. */
export const BUILTIN_DEFAULT: ReviewPassesEntry = {
  count: 1,
  mode: 'cross-check',
};

/** Built-in roles, in order. Used when config omits the `roles` array. */
export const BUILTIN_ROLES: ReviewRole[] = [
  { name: 'Beetle', model: 'anthropic/claude-sonnet-4.6', tier: 'beetle' },
  { name: 'Wasp', model: 'anthropic/claude-opus-4.7', tier: 'wasp' },
  { name: 'Mantis', model: 'anthropic/claude-opus-4.7', tier: 'mantis' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a `count` to `[MIN_PASSES, MAX_PASSES]`. NaN / negative → MIN. */
function clampCount(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MIN_PASSES;
  const truncated = Math.trunc(raw);
  if (truncated < MIN_PASSES) return MIN_PASSES;
  if (truncated > MAX_PASSES) return MAX_PASSES;
  return truncated;
}

/** Returns the input mode if valid, else undefined. */
function asMode(raw: unknown): ReviewPassMode | undefined {
  if (typeof raw !== 'string') return undefined;
  return (REVIEW_PASS_MODES as readonly string[]).includes(raw)
    ? (raw as ReviewPassMode)
    : undefined;
}

/**
 * Coerces an arbitrary fragment into a partial entry. Unknown fields and
 * invalid types collapse to `undefined` so downstream merging is honest about
 * which fields the layer actually supplied.
 */
function coerceEntry(raw: unknown): Partial<ReviewPassesEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<ReviewPassesEntry> = {};
  if (typeof r.count === 'number') {
    out.count = clampCount(r.count);
  }
  const mode = asMode(r.mode);
  if (mode) out.mode = mode;
  return out;
}

/**
 * Reads top-level `reviewPasses` from a parsed `.clud-bug.json` object.
 * Tolerates absence + invalid types.
 */
export function readReviewPassesConfig(
  parsedJson: unknown,
): ReviewPassesConfig | null {
  if (!parsedJson || typeof parsedJson !== 'object') return null;
  const root = parsedJson as Record<string, unknown>;
  const raw = root.reviewPasses;
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;
  const cfg: ReviewPassesConfig = {};

  if (typeof obj.count === 'number') cfg.count = clampCount(obj.count);
  const flatMode = asMode(obj.mode);
  if (flatMode) cfg.mode = flatMode;

  if (obj.applyTo === 'all' || obj.applyTo === 'shared-only') {
    cfg.applyTo = obj.applyTo;
  }

  if (Array.isArray(obj.roles)) {
    cfg.roles = obj.roles
      .map((entry) => coerceRole(entry))
      .filter((r): r is ReviewRole => r !== null);
  }

  if (obj.default && typeof obj.default === 'object') {
    cfg.default = coerceEntry(obj.default);
  }

  if (obj.perSkill && typeof obj.perSkill === 'object') {
    const out: Record<string, Partial<ReviewPassesEntry>> = {};
    for (const [slug, value] of Object.entries(
      obj.perSkill as Record<string, unknown>,
    )) {
      out[slug] = coerceEntry(value);
    }
    cfg.perSkill = out;
  }

  return cfg;
}

function coerceRole(raw: unknown): ReviewRole | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.model !== 'string') return null;
  if (!r.name.trim() || !r.model.trim()) return null;
  return { name: r.name.trim(), model: r.model.trim() };
}

/**
 * Re-parses raw SKILL.md frontmatter to extract the (optional)
 * `review_passes` block. Returns null when the block is absent / malformed.
 *
 * We can't reuse the App skills-loader's `parseFrontmatter` — it strips
 * unknown nested keys for security/forward-compat. This helper is scoped to
 * one block: it tolerates `count` + `mode` inline scalars and nothing else.
 *
 * Raw frontmatter is whatever sits between the leading `---\n` and the
 * matching `---\n` in the SKILL.md file. The caller (orchestrator) already
 * has the parsed `body`/frontmatter from the skills loader; what we need here
 * is the RAW source so we can pluck `review_passes` out.
 */
export function extractSkillReviewPassesOverride(
  rawSkillMd: string,
): SkillReviewPassesFrontmatter | null {
  const trimmed = rawSkillMd.replace(/^﻿/, '');
  const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const block = match[1] ?? '';
  // We want the `review_passes:` top-level key + its indented children
  // (count, mode). Anything outside this block is ignored.
  const lines = block.split(/\r?\n/);
  let inBlock = false;
  const out: SkillReviewPassesFrontmatter = {};
  for (const line of lines) {
    if (!inBlock) {
      // Top-level key match: `review_passes:` with no value (block start).
      if (/^review_passes\s*:\s*$/.test(line)) {
        inBlock = true;
      }
      continue;
    }
    // Inside the block: keep going while the line is indented OR blank.
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      // De-dent → block ended.
      break;
    }
    const inner = line.trim();
    const colon = inner.indexOf(':');
    if (colon === -1) continue;
    const key = inner.slice(0, colon).trim();
    const value = inner.slice(colon + 1).trim();
    if (key === 'count') {
      const n = Number(value);
      if (Number.isFinite(n)) out.count = clampCount(n);
    } else if (key === 'mode') {
      // Strip surrounding quotes.
      const m = asMode(value.replace(/^['"]|['"]$/g, ''));
      if (m) out.mode = m;
    }
  }
  // Return null when neither field landed — keeps the precedence resolver's
  // "frontmatter layer supplied nothing" branch honest.
  if (out.count === undefined && out.mode === undefined) return null;
  return out;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/** Minimal skill shape the resolver needs — decoupled from the App loader. */
export interface ReviewPlanSkill {
  /** Skill slug (catalog identity). */
  slug: string;
  /** Parsed SKILL.md frontmatter (core shape). Only `review_mode` is read. */
  frontmatter: SkillFrontmatter;
}

export interface ResolveReviewPassesInput {
  /** Loaded skills, in catalog order. */
  skills: ReviewPlanSkill[];
  /**
   * Raw SKILL.md text per slug (for the frontmatter `review_passes` block).
   * Optional — when omitted, frontmatter override is treated as absent.
   * Map key = slug; value = raw SKILL.md including the leading `---` block.
   */
  rawSkillMd?: Record<string, string>;
  /** Parsed `.clud-bug.json` `reviewPasses` block. May be null/empty. */
  config: ReviewPassesConfig | null;
}

export interface ResolveReviewPassesResult {
  /** Resolved entry per skill, in input order. */
  perSkill: ResolvedReviewPasses[];
  /**
   * Effective roles list — falls back to BUILTIN_ROLES when config omits.
   * The aggregator + writeback use this for inline attribution.
   */
  roles: ReviewRole[];
  /**
   * `applyTo` scope. When `shared-only`, the orchestrator only multi-passes
   * skills with `review_mode === 'shared'`. Defaults to `all`.
   */
  applyTo: ApplyTo;
}

/**
 * Walks the precedence stack and produces an effective `{ count, mode }` per
 * skill plus the resolved roles + apply scope.
 *
 * Pure function; no I/O. The orchestrator handles the actual fetch ordering
 * upstream (config from the skills loader, raw SKILL.md from a separate fetch
 * in D.2.5 — the loader returns `body` with frontmatter stripped, so the
 * orchestrator passes the un-stripped source on the side).
 */
export function resolveReviewPasses(
  input: ResolveReviewPassesInput,
): ResolveReviewPassesResult {
  const { skills, rawSkillMd = {}, config } = input;

  // 1. Repo-level default — collapses the two .clud-bug.json layouts.
  const repoDefault: Partial<ReviewPassesEntry> = (() => {
    if (!config) return {};
    const flat: Partial<ReviewPassesEntry> = {};
    if (config.count !== undefined) flat.count = clampCount(config.count);
    if (config.mode) flat.mode = config.mode;
    const explicit = config.default ?? {};
    // `default` wins over flat — explicit always beats inferred.
    return { ...flat, ...explicit };
  })();

  // 2. Roles + applyTo carry over uniformly.
  const roles =
    config?.roles && config.roles.length > 0 ? config.roles : BUILTIN_ROLES;
  const applyTo: ApplyTo = config?.applyTo === 'shared-only' ? 'shared-only' : 'all';

  const perSkill: ResolvedReviewPasses[] = skills.map((skill) => {
    const fromPerSkill = config?.perSkill?.[skill.slug] ?? {};
    const fromFrontmatter =
      rawSkillMd[skill.slug] !== undefined
        ? extractSkillReviewPassesOverride(rawSkillMd[skill.slug] ?? '') ?? {}
        : {};

    // 3. shared-only scope clamps non-shared skills to count = 1.
    //    Apply BEFORE precedence merging so even a perSkill override can't
    //    re-enable multi-pass for a dedicated skill in shared-only mode.
    const sharedOnlyClamp: { count?: number } =
      applyTo === 'shared-only' && skill.frontmatter.review_mode !== 'shared'
        ? { count: 1 }
        : {};

    // Precedence: perSkill → frontmatter → repoDefault → builtin
    const merged: ReviewPassesEntry = {
      count:
        sharedOnlyClamp.count ??
        fromPerSkill.count ??
        fromFrontmatter.count ??
        repoDefault.count ??
        BUILTIN_DEFAULT.count,
      mode:
        fromPerSkill.mode ??
        fromFrontmatter.mode ??
        repoDefault.mode ??
        BUILTIN_DEFAULT.mode,
    };

    // Provenance — which precedence layer SUPPLIED count.
    const source: ResolvedReviewPasses['source'] =
      sharedOnlyClamp.count !== undefined
        ? 'repoDefault' // applyTo lives at the repo layer
        : fromPerSkill.count !== undefined
          ? 'perSkill'
          : fromFrontmatter.count !== undefined
            ? 'frontmatter'
            : repoDefault.count !== undefined
              ? 'repoDefault'
              : 'builtin';

    return {
      slug: skill.slug,
      count: clampCount(merged.count),
      mode: merged.mode,
      roles,
      source,
    };
  });

  return { perSkill, roles, applyTo };
}

/**
 * Returns the role for a given pass index, recycling when `roles.length` is
 * smaller than the pass count. Pass 1 → roles[0], pass 2 → roles[1], etc.
 * Empty roles array → synthesized `Pass N` / requested model fallback.
 *
 * The orchestrator calls this for every (skill, passIndex) combination.
 */
export function roleForPass(
  roles: ReviewRole[],
  passIndex: number,
  fallbackModel: string,
): ReviewRole {
  if (roles.length === 0) {
    return { name: `Pass ${passIndex + 1}`, model: fallbackModel };
  }
  const i = passIndex % roles.length;
  return roles[i] as ReviewRole;
}

/**
 * Truthy when ANY resolved skill needs more than one pass. Used by the
 * orchestrator to decide whether to invoke the aggregator at all (single-pass
 * results render via the D.2.0 path verbatim).
 */
export function anyMultiPass(resolved: ResolvedReviewPasses[]): boolean {
  return resolved.some((r) => r.count > 1);
}

/**
 * Total pass count across every skill — the cost-gate input. Used by
 * `./budget-plan.ts`'s Layer-1 estimator.
 */
export function totalPassCount(resolved: ResolvedReviewPasses[]): number {
  return resolved.reduce((sum, r) => sum + r.count, 0);
}
