// SPEC §7 canonical-ruleset applier — pure core half of `configure-github`.
//
// `configure-github` is the one-stop repo-setup command. It does two things,
// in order, for the selected PRESET:
//   1. Repo conveniences (universal hygiene, ALL presets): squash-only merges,
//      auto-merge + delete-branch-on-merge on, PR title/body as the squash
//      commit message. These live on the REPOSITORY (v2 rulesets can't express
//      them), so they're diffed + PATCHed via repos.get / repos.update.
//   2. The canonical branch RULESET for the chosen preset.
//
// Presets are the purpose-named taxonomy vendored from reporulez (the canonical
// source) into `data/rulesets/<name>.json`:
//   - baseline      structural hygiene only (no required checks)
//   - clud-bug      baseline + the `clud-bug-review` merge-gate check
//   - skdd          clud-bug + SkDD derived-docs checks  (DEFAULT)
//   - public-guard  stricter posture: 1 approval + code-owner + last-push
//
// External users installing the App expect "best practice branch protection"
// applied automatically. This module diffs the current GitHub state against
// the selected preset (bundled under `data/rulesets/`) and emits the minimal
// set of repo-settings + rulesets-API calls to converge.
//
// v2 (SPEC §7): the canonical migrated from the RETIRED classic
// branch-protection API (`PUT …/branches/{b}/protection`, 1 required approval,
// a required `test` status context) to GitHub's RULESETS API
// (`GET/POST/PUT …/repos/{o}/{r}/rulesets`, 0 approvals, the `clud-bug-review`
// check as the merge gate). Rulesets layer, are org-portable, and are the
// modern mechanism; classic protection is legacy. The reference applier is
// reporulez `bin/apply.sh` (list existing rulesets → find by name →
// create-if-absent / update-if-present).
//
// Architectural shape mirrors `formal-review.ts` and `review-writeback.ts`:
// the pure rule-table + diff logic lives in core (no Octokit dep at compile
// time — clud-bug-app already has `@octokit/rest` and passes its instance;
// the CLI side wraps `gh api` in a tiny adapter that satisfies the same
// structural interface). Core stays npm-side single-source-of-truth per the
// Bug 9 / Phase 2-4 architectural lock.
//
// Idempotent contract (HARD GUARANTEE):
//
//   const a = await applyCanonicalRuleset(octokit, params);
//   const b = await applyCanonicalRuleset(octokit, params);
//   // b.alreadyCanonical === true; b.changes.length === 0
//
// A second `apply()` call against a freshly-converged repo MUST produce
// `alreadyCanonical: true` with `changes: []` and zero create/update calls.
// This lets external automation (CI, dispatch loops, dashboard probes) call
// `apply()` defensively without rate-limiting itself out of the API.
//
// SPEC pins honored here (SPEC §7.4):
//   - The canonical ruleset is sourced from `canonical-v1.json` (frozen at
//     `version: v2`; the filename is a stable fetch path, the `version` field
//     is the authority). Tools MUST NOT redefine the ruleset in-tool.
//   - `required_status_checks` contexts are TREATED AS A SUPERSET: if the
//     repo already requires MORE contexts than the canonical list, we leave
//     them alone (a repo that runs additional CI gates legitimately needs
//     them in the required set). We only ADD the canonical contexts that
//     are missing.
//   - `required_approving_review_count`: canonical is 0 (the `clud-bug-review`
//     CHECK is the gate). Owners MAY raise it; tools MUST NOT raise it by
//     default and MUST NOT lower an owner-raised floor. We treat it as a
//     floor of the canonical value (only ever raise, never lower).
//   - `bypass_actors`: the Repository-admin bypass (always) is the self-mod
//     escape hatch. Treated as a superset — extra bypass actors the repo
//     already has are preserved.
//
// Offline-resilient bundling: the preset rulesets ship in `data/rulesets/` at
// the package root (alongside `bin/`, `templates/`, etc., per package.json
// `files`). We read them at runtime via fs.readFile so the build stays out
// of TypeScript's `rootDir` constraint, and so callers that re-bundle
// clud-bug into a single file can override the ruleset by passing one
// explicitly to `applyCanonicalRuleset({ ruleset })` (or a preset name via
// `{ preset }`).

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A single rule inside the ruleset's `rules` array (GitHub rulesets shape). */
export interface CanonicalRulesetRule {
  type: string;
  parameters?: Record<string, unknown>;
}

/** Ruleset targeting conditions (which refs the ruleset applies to). */
export interface CanonicalRulesetConditions {
  ref_name: { include: string[]; exclude: string[] };
}

/** An actor allowed to bypass the ruleset (e.g. the Repository-admin role). */
export interface CanonicalRulesetBypassActor {
  actor_type: string;
  actor_id: number;
  bypass_mode: string;
}

/**
 * The vendored ruleset structure (GitHub v2 rulesets shape). The reporulez
 * presets under `data/rulesets/` are vendored verbatim — they carry `name`,
 * `target`, `enforcement`, `conditions`, `bypass_actors`, `rules`, and a
 * `$comment` header (consumer-ignored). `version` / `spec_version` are
 * OPTIONAL: only the legacy metadata-rich `canonical-v1.json` alias carried
 * them; the vendored presets omit them. `$comment` / `$notes` are OPTIONAL
 * and consumer-ignored (not modeled here). Major schema bumps require
 * coordinated tool releases.
 */
export interface CanonicalRuleset {
  version?: 'v2';
  spec_version?: string;
  name: string;
  target: string;
  enforcement: string;
  conditions: CanonicalRulesetConditions;
  bypass_actors: CanonicalRulesetBypassActor[];
  rules: CanonicalRulesetRule[];
}

/**
 * Resolves the package root from this file's URL. After tsc the file lives
 * at `<pkg>/dist/core/configure-github.js`; three dirname() climbs land on
 * `<pkg>`, parallel to the package.json `files` map entry for `data`.
 */
const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * The purpose-named preset taxonomy, vendored from reporulez (the canonical
 * source) into `data/rulesets/<name>.json`. Ordered least → most strict.
 */
export const PRESET_NAMES = [
  'baseline',
  'clud-bug',
  'skdd',
  'public-guard',
] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

/**
 * Default preset — `skdd` (the four-check SkDD ruleset). Preserves the prior
 * single-canonical behavior when `--preset` isn't passed.
 */
export const DEFAULT_PRESET: PresetName = 'skdd';

/** Type guard: is `name` one of the known presets? */
export function isPresetName(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name);
}

/** Memoized presets — each variant loaded at most once per process. */
const PRESET_CACHE = new Map<PresetName, CanonicalRuleset>();

/**
 * Loads a vendored ruleset preset from `data/rulesets/<name>.json`. The four
 * variants (baseline · clud-bug · skdd · public-guard) are vendored verbatim
 * from reporulez (the canonical source); consumers ignore the `$comment`
 * header. Memoized per-name so repeated calls don't re-hit the filesystem.
 *
 * Throws a wrapped error if the name is unknown or the JSON is missing —
 * an unknown preset is a caller bug; a missing file is an install-time
 * defect (package.json `files` excluded `data/`). Both surface loudly.
 */
export async function loadPreset(name: PresetName): Promise<CanonicalRuleset> {
  if (!isPresetName(name)) {
    throw new Error(
      `configure-github: unknown preset "${name}" (valid: ${PRESET_NAMES.join(', ')})`,
    );
  }
  const cached = PRESET_CACHE.get(name);
  if (cached) return cached;
  const path = join(PKG_ROOT, 'data', 'rulesets', `${name}.json`);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as CanonicalRuleset;
    PRESET_CACHE.set(name, parsed);
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `configure-github: failed to load ruleset preset "${name}" at ${path}: ${msg}`,
    );
  }
}

/**
 * Back-compat alias: the historical `loadCanonicalV1()` entry point now
 * resolves the DEFAULT (`skdd`) preset. `data/canonical-v1.json` is retained
 * on disk as a copy of the skdd preset for the stable external fetch path,
 * but the loader reads `data/rulesets/skdd.json`.
 */
export async function loadCanonicalV1(): Promise<CanonicalRuleset> {
  return loadPreset(DEFAULT_PRESET);
}

/**
 * Repo-level "conveniences" — merge hygiene that lives on the REPOSITORY,
 * not the ruleset (v2 rulesets can't express these). Applied for EVERY
 * preset as universal hygiene: squash-only merges, auto-merge + branch
 * cleanup on, PR title/body as the squash commit message.
 */
export interface RepoConveniences {
  delete_branch_on_merge: boolean;
  allow_auto_merge: boolean;
  allow_squash_merge: boolean;
  allow_merge_commit: boolean;
  allow_rebase_merge: boolean;
  squash_merge_commit_title: string;
  squash_merge_commit_message: string;
}

/** The canonical repo-conveniences every preset converges the repo to. */
export const CANONICAL_REPO_CONVENIENCES: RepoConveniences = {
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
};

/** A ruleset as returned by GitHub's list endpoint (summary — id + name). */
export interface RepoRulesetSummary {
  id: number;
  name: string;
}

/** A ruleset as returned by GitHub's get-by-id endpoint (full definition). */
export interface RepoRulesetFull {
  id: number;
  name: string;
  target?: string;
  enforcement?: string;
  conditions?: { ref_name?: { include?: string[]; exclude?: string[] } } | null;
  bypass_actors?: Array<{
    actor_type?: string;
    actor_id?: number;
    bypass_mode?: string;
  }> | null;
  rules?: CanonicalRulesetRule[] | null;
}

/** The body sent to POST/PUT `…/rulesets` (the metadata-stripped payload). */
export interface RulesetWritePayload {
  name: string;
  target: string;
  enforcement: string;
  bypass_actors: CanonicalRulesetBypassActor[];
  conditions: CanonicalRulesetConditions;
  rules: CanonicalRulesetRule[];
}

/**
 * Minimal structural Octokit interface — only the rulesets methods we call.
 *
 * We intentionally don't import `@octokit/rest` types: that would force
 * every consumer (App, CLI, future tools) to install Octokit at runtime
 * even when they pass a `gh`-CLI-backed adapter. Keeping the shape
 * structural lets the CLI's `gh`-wrapping adapter satisfy it without
 * pulling in a 200KB dep. The method names mirror `@octokit/rest`'s
 * `repos.*` rulesets surface so a real Octokit instance satisfies it too.
 */
export interface OctokitLike {
  repos: {
    /** List the repo's rulesets (summaries). `includes_parents:false` scopes to repo-level. */
    getRepoRulesets(params: {
      owner: string;
      repo: string;
      includes_parents?: boolean;
    }): Promise<{ data: RepoRulesetSummary[] }>;
    /** Fetch a single ruleset by id (full rules/conditions/bypass_actors). */
    getRepoRuleset(params: {
      owner: string;
      repo: string;
      ruleset_id: number;
    }): Promise<{ data: RepoRulesetFull }>;
    /** Create a ruleset (POST). */
    createRepoRuleset(
      params: { owner: string; repo: string } & RulesetWritePayload,
    ): Promise<{ data: RepoRulesetFull }>;
    /** Update an existing ruleset by id (PUT). */
    updateRepoRuleset(
      params: {
        owner: string;
        repo: string;
        ruleset_id: number;
      } & RulesetWritePayload,
    ): Promise<{ data: RepoRulesetFull }>;
    /**
     * Read repo-level settings (the conveniences: merge methods + squash
     * commit shape + branch-cleanup toggles). Backs the universal-hygiene
     * PATCH; mirrors `@octokit/rest`'s `repos.get`.
     */
    get(params: {
      owner: string;
      repo: string;
    }): Promise<{ data: Partial<RepoConveniences> }>;
    /** PATCH repo-level settings (the conveniences payload). `repos.update`. */
    update(
      params: { owner: string; repo: string } & Partial<RepoConveniences>,
    ): Promise<unknown>;
  };
}

export interface ApplyCanonicalRulesetParams {
  owner: string;
  repo: string;
  /**
   * Target branch (default: `main`). The canonical ruleset targets the repo's
   * default branch via the `~DEFAULT_BRANCH` sentinel; passing an explicit
   * non-`main` branch narrows the ruleset to `refs/heads/<branch>` instead.
   */
  branch?: string;
  /**
   * The ruleset to apply. When absent, resolved from `preset` (or the
   * DEFAULT `skdd` preset). Callers may pass an explicit ruleset; the type
   * system pins the shape. Takes precedence over `preset`.
   */
  ruleset?: CanonicalRuleset;
  /**
   * Named preset to load when `ruleset` isn't passed explicitly. One of
   * baseline · clud-bug · skdd · public-guard. Defaults to `skdd`.
   */
  preset?: PresetName;
  /**
   * If true, compute diff only and skip all create/update calls. The result
   * still reports `changes: string[]` so the CLI can render the human-readable
   * diff before applying.
   */
  dryRun?: boolean;
}

export interface ApplyResult {
  /** Human-readable diff lines, one per detected difference. Empty when alreadyCanonical. */
  changes: string[];
  /** True when the live ruleset already satisfies every canonical setting. */
  alreadyCanonical: boolean;
  /** Schema-family identifier applied (the `canonical-v1.json` fetch path). */
  ruleset: 'canonical-v1';
}

/**
 * Applies the selected preset to a GitHub repo: repo conveniences FIRST
 * (universal hygiene for every preset), then the canonical ruleset via the
 * rulesets API.
 *
 * Conveniences: diffs repo-level settings (squash-only merges, auto-merge,
 * delete-branch-on-merge, PR title/body squash message) and PATCHes only
 * what drifted (`repos.update`), before the ruleset write.
 *
 * Ruleset: lists the repo's rulesets, finds the canonical one by name, and:
 *   - creates it (POST) if absent, or
 *   - diffs the existing one against canonical and updates it (PUT) only
 *     when it doesn't already satisfy the canonical contract.
 * Idempotent: a second call against a converged repo returns
 * `alreadyCanonical: true` with no repo-update / create / update side effects.
 *
 * Behavior on partial mismatch (SPEC §7.4):
 *   - `required_status_checks` contexts: canonical contexts that are missing
 *     get added; extra contexts on the repo are preserved (superset contract).
 *   - `required_approving_review_count`: treated as a floor (only raise, never
 *     lower an owner-raised value).
 *   - `bypass_actors`: superset — extra actors the repo already has survive.
 *   - repo conveniences + everything else converge to the canonical value.
 *
 * Throws on Octokit transport failure (auth, network, 403). The CLI wraps
 * these with a friendly error message.
 */
export async function applyCanonicalRuleset(
  octokit: OctokitLike,
  params: ApplyCanonicalRulesetParams,
): Promise<ApplyResult> {
  const { owner, repo, branch = 'main', dryRun = false } = params;
  const ruleset =
    params.ruleset ?? (await loadPreset(params.preset ?? DEFAULT_PRESET));

  const desired = toRulesetWritePayload(ruleset, branch);

  // ----- Repo conveniences (universal hygiene — every preset) -----------
  // These live on the REPOSITORY, not the ruleset. Diff first so a repo
  // that already matches is a true no-op (idempotency contract); the PATCH
  // below fires BEFORE the ruleset write.
  const repoResp = await octokit.repos.get({ owner, repo });
  const conveniences = diffRepoConveniences(
    repoResp.data ?? {},
    CANONICAL_REPO_CONVENIENCES,
  );

  // ----- Read current rulesets ------------------------------------------
  // The list endpoint returns 200 with `[]` for a repo that has no rulesets
  // (no 404 to special-case). Transport errors (403/network) bubble up.
  // `includes_parents:false` keeps us to repo-level rulesets so we don't
  // mistake an inherited org ruleset (which we can't update at repo level)
  // for ours.
  const listResp = await octokit.repos.getRepoRulesets({
    owner,
    repo,
    includes_parents: false,
  });
  const existingSummary =
    (listResp.data ?? []).find((r) => r.name === desired.name) ?? null;

  let rulesetChanges: string[];
  let existingFull: RepoRulesetFull | null = null;
  if (existingSummary) {
    const fullResp = await octokit.repos.getRepoRuleset({
      owner,
      repo,
      ruleset_id: existingSummary.id,
    });
    existingFull = fullResp.data;
    rulesetChanges = diffExistingRuleset(existingFull, desired);
  } else {
    rulesetChanges = describeCreate(desired);
  }

  // Conveniences reported first (they're applied first).
  const changes = [...conveniences.changes, ...rulesetChanges];
  const alreadyCanonical = changes.length === 0;
  if (alreadyCanonical || dryRun) {
    return { changes, alreadyCanonical, ruleset: 'canonical-v1' };
  }

  // ----- Apply conveniences FIRST (before the ruleset write) ------------
  if (conveniences.needsPatch) {
    await octokit.repos.update({ owner, repo, ...conveniences.patch });
  }

  // ----- Apply ruleset (only when the ruleset itself drifted) -----------
  // Gate on `rulesetChanges`, not the combined `changes`: a repo whose
  // ruleset is already canonical but whose conveniences drifted must NOT
  // incur a spurious ruleset PUT (idempotency at the ruleset layer).
  if (rulesetChanges.length > 0) {
    if (existingSummary && existingFull) {
      // PUT: merge to preserve the repo's extras (superset contexts / bypass
      // actors / owner-raised approval floor) instead of clobbering them.
      const merged = mergeForPut(existingFull, desired);
      await octokit.repos.updateRepoRuleset({
        owner,
        repo,
        ruleset_id: existingSummary.id,
        ...merged,
      });
    } else {
      await octokit.repos.createRepoRuleset({ owner, repo, ...desired });
    }
  }

  return { changes, alreadyCanonical: false, ruleset: 'canonical-v1' };
}

/**
 * Diffs the repo's current conveniences against the canonical set. Returns
 * one human-readable line per drifted field plus the minimal PATCH body.
 * `needsPatch` is false when the repo already matches (idempotency contract).
 * Only keys present in `desired` are compared, so extra repo settings GitHub
 * echoes back never produce a spurious diff.
 */
function diffRepoConveniences(
  current: Partial<RepoConveniences>,
  desired: RepoConveniences,
): { changes: string[]; patch: Partial<RepoConveniences>; needsPatch: boolean } {
  const changes: string[] = [];
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(desired) as (keyof RepoConveniences)[]) {
    const want = desired[key];
    const have = current[key] ?? (typeof want === 'boolean' ? false : '');
    if (have !== want) {
      changes.push(`${key}: ${have === '' ? '(unset)' : have} → ${want}`);
      patch[key] = want;
    }
  }
  return {
    changes,
    patch: patch as Partial<RepoConveniences>,
    needsPatch: changes.length > 0,
  };
}

/**
 * Builds the GitHub rulesets write payload from the canonical file, stripping
 * the vendored-only metadata (`$comment`, `$notes`, `version`, `spec_version`)
 * that the rulesets API doesn't accept. When an explicit non-default branch
 * is requested, narrows the ref condition to `refs/heads/<branch>` (the
 * canonical otherwise targets the repo default branch via `~DEFAULT_BRANCH`).
 */
function toRulesetWritePayload(
  ruleset: CanonicalRuleset,
  branch: string,
): RulesetWritePayload {
  const conditions: CanonicalRulesetConditions =
    branch && branch !== 'main'
      ? { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } }
      : ruleset.conditions;
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    bypass_actors: ruleset.bypass_actors,
    conditions,
    rules: ruleset.rules,
  };
}

/** Human-readable change lines for the create (no existing ruleset) path. */
function describeCreate(desired: RulesetWritePayload): string[] {
  const changes = [
    `ruleset "${desired.name}": create (target=${desired.target}, enforcement=${desired.enforcement})`,
  ];
  for (const rule of desired.rules) changes.push(`+ rule ${summarizeRule(rule)}`);
  return changes;
}

/** One-line summary of a rule for human-readable diff output. */
function summarizeRule(rule: CanonicalRulesetRule): string {
  const p = rule.parameters ?? {};
  if (rule.type === 'pull_request') {
    return `pull_request (approvals=${p.required_approving_review_count}, thread_resolution=${p.required_review_thread_resolution}, merge=${JSON.stringify(p.allowed_merge_methods)})`;
  }
  if (rule.type === 'required_status_checks') {
    const contexts = statusCheckContexts(p);
    return `required_status_checks (strict=${p.strict_required_status_checks_policy}, contexts=${JSON.stringify(contexts)})`;
  }
  return rule.type;
}

/** Extracts the `context` strings from a required_status_checks params blob. */
function statusCheckContexts(params: Record<string, unknown>): string[] {
  const list = params.required_status_checks;
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => (c && typeof c === 'object' ? (c as { context?: string }).context : undefined))
    .filter((c): c is string => typeof c === 'string');
}

/** One required-status-check entry: the context plus its optional App pin. */
interface StatusCheckEntry {
  context: string;
  integration_id?: number;
}

/**
 * Like `statusCheckContexts`, but preserves each entry's `integration_id`.
 *
 * SPEC §10.3.3 point 2 pins `clud-bug-review` to the clud-bug App's own
 * `integration_id`. Without the pin the context name is just a string: ANY
 * actor with checks:write — including the PR author — can post a check run
 * named `clud-bug-review`, and GitHub's latest-run-wins semantics let that
 * forged run satisfy the gate over the App's real verdict.
 *
 * The string-only `statusCheckContexts` above is still correct for the
 * places that genuinely only need names (human-readable diff labels), but
 * anything that ROUND-TRIPS entries back to the API must use this instead —
 * rebuilding entries as bare `{ context }` silently drops the pin.
 */
function statusCheckEntries(params: Record<string, unknown>): StatusCheckEntry[] {
  const list = params.required_status_checks;
  if (!Array.isArray(list)) return [];
  const out: StatusCheckEntry[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const { context, integration_id: pin } = c as StatusCheckEntry;
    if (typeof context !== 'string') continue;
    out.push(typeof pin === 'number' ? { context, integration_id: pin } : { context });
  }
  return out;
}

/**
 * Diffs an existing ruleset against the canonical desired payload. Returns
 * one human-readable line per difference the apply path would fix; an empty
 * array means the existing ruleset already satisfies the canonical (no-op).
 */
function diffExistingRuleset(
  existing: RepoRulesetFull,
  desired: RulesetWritePayload,
): string[] {
  const changes: string[] = [];

  if ((existing.enforcement ?? '') !== desired.enforcement) {
    changes.push(
      `enforcement: ${existing.enforcement ?? '(unset)'} → ${desired.enforcement}`,
    );
  }
  if ((existing.target ?? '') !== desired.target) {
    changes.push(`target: ${existing.target ?? '(unset)'} → ${desired.target}`);
  }

  // conditions: the desired ref-includes must all be present on the existing.
  const existingInclude = new Set(existing.conditions?.ref_name?.include ?? []);
  const missingInclude = desired.conditions.ref_name.include.filter(
    (r) => !existingInclude.has(r),
  );
  if (missingInclude.length > 0) {
    changes.push(
      `conditions.ref_name.include: add ${JSON.stringify(missingInclude)}`,
    );
  }

  // bypass_actors: superset — report only actors the existing set lacks.
  const missingActors = desired.bypass_actors.filter(
    (d) =>
      !(existing.bypass_actors ?? []).some(
        (e) =>
          e.actor_type === d.actor_type &&
          e.actor_id === d.actor_id &&
          e.bypass_mode === d.bypass_mode,
      ),
  );
  if (missingActors.length > 0) {
    changes.push(`bypass_actors: add ${JSON.stringify(missingActors)}`);
  }

  // rules: for each desired rule, ensure the existing set has a matching one.
  const existingByType = new Map<string, CanonicalRulesetRule>();
  for (const r of existing.rules ?? []) existingByType.set(r.type, r);
  for (const rule of desired.rules) {
    const ex = existingByType.get(rule.type);
    if (!ex) {
      changes.push(`rules: add "${rule.type}"`);
      continue;
    }
    if (rule.parameters) {
      changes.push(
        ...diffRuleParams(rule.type, ex.parameters ?? {}, rule.parameters),
      );
    }
  }
  return changes;
}

/**
 * Diffs a single rule's parameters (existing vs desired). Applies the SPEC
 * §7.4 semantics per parameter:
 *   - `required_status_checks` (array of {context}): superset — only report
 *     the canonical contexts the existing set is missing.
 *   - `required_approving_review_count`: floor — only report when the existing
 *     is BELOW the canonical (never lower an owner-raised value).
 *   - array params (e.g. `allowed_merge_methods`): set-equality.
 *   - scalars/booleans: exact match.
 * Only keys present in `desired` are compared, so GitHub echoing extra
 * default parameters never produces a spurious diff.
 */
function diffRuleParams(
  type: string,
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
): string[] {
  const changes: string[] = [];
  for (const [key, want] of Object.entries(desired)) {
    if (key === 'required_status_checks') {
      const wantEntries = statusCheckEntries({ required_status_checks: want });
      const haveByContext = new Map(
        statusCheckEntries({ required_status_checks: existing[key] }).map((e) => [
          e.context,
          e,
        ]),
      );
      const missing = wantEntries
        .filter((e) => !haveByContext.has(e.context))
        .map((e) => e.context);
      if (missing.length > 0) {
        changes.push(`${type}.required_status_checks: add ${JSON.stringify(missing)}`);
      }
      // An UNPINNED (or wrong-pin) context that we ship pinned is drift, not
      // a no-op. Without this the gate reports "already canonical" while the
      // check name remains forgeable — the repo looks configured and isn't.
      for (const wantEntry of wantEntries) {
        if (wantEntry.integration_id === undefined) continue;
        const have = haveByContext.get(wantEntry.context);
        if (!have) continue; // already reported as missing above
        if (have.integration_id !== wantEntry.integration_id) {
          changes.push(
            `${type}.required_status_checks["${wantEntry.context}"].integration_id: ` +
              `${have.integration_id ?? '(unpinned)'} → ${wantEntry.integration_id}`,
          );
        }
      }
      continue;
    }
    if (key === 'required_approving_review_count') {
      const have = Number(existing[key] ?? 0);
      const eff = Math.max(have, Number(want));
      if (eff !== have) {
        changes.push(`${type}.required_approving_review_count: ${have} → ${eff}`);
      }
      continue;
    }
    if (Array.isArray(want)) {
      if (!arraysEqualAsSet(want, existing[key])) {
        changes.push(
          `${type}.${key}: ${JSON.stringify(existing[key])} → ${JSON.stringify(want)}`,
        );
      }
      continue;
    }
    if (existing[key] !== want) {
      changes.push(`${type}.${key}: ${existing[key] ?? '(unset)'} → ${want}`);
    }
  }
  return changes;
}

/**
 * Builds the PUT payload for an update, preserving the repo's legitimate
 * extras rather than clobbering them:
 *   - union the existing + canonical bypass_actors,
 *   - union the existing + canonical required_status_checks contexts,
 *   - keep the higher of the existing / canonical approving-review count.
 * Every other parameter converges to the canonical value.
 */
function mergeForPut(
  existing: RepoRulesetFull,
  desired: RulesetWritePayload,
): RulesetWritePayload {
  // Union bypass_actors by (actor_type, actor_id).
  const bypass: CanonicalRulesetBypassActor[] = [...desired.bypass_actors];
  for (const e of existing.bypass_actors ?? []) {
    const already = bypass.some(
      (d) => d.actor_type === e.actor_type && d.actor_id === e.actor_id,
    );
    if (!already && e.actor_type && typeof e.actor_id === 'number' && e.bypass_mode) {
      bypass.push({
        actor_type: e.actor_type,
        actor_id: e.actor_id,
        bypass_mode: e.bypass_mode,
      });
    }
  }

  const existingByType = new Map<string, CanonicalRulesetRule>();
  for (const r of existing.rules ?? []) existingByType.set(r.type, r);

  const rules = desired.rules.map((rule) => {
    const ex = existingByType.get(rule.type);
    if (rule.type === 'required_status_checks' && rule.parameters) {
      // Union by context, PRESERVING each entry's `integration_id`.
      //
      // This previously rebuilt every entry as a bare `{ context }`, which
      // silently dropped the SPEC §10.3.3 App pin on every apply — including
      // one an operator had set by hand in the GitHub UI. A pinless context
      // is a forgeable gate (see `statusCheckEntries`), so the strip turned
      // a correctly-configured repo back into an insecure one on the next
      // `configure-github` run.
      //
      // Precedence: OUR entry wins for contexts we ship (so the canonical pin
      // is applied and cannot be downgraded); the repo's own extra contexts
      // are carried through verbatim, keeping any pin their owner chose.
      const desiredEntries = statusCheckEntries(rule.parameters);
      const desiredByContext = new Map(desiredEntries.map((e) => [e.context, e]));
      const mergedEntries: StatusCheckEntry[] = [...desiredEntries];
      for (const existingEntry of statusCheckEntries(ex?.parameters ?? {})) {
        if (!desiredByContext.has(existingEntry.context)) {
          mergedEntries.push(existingEntry);
        }
      }
      return {
        ...rule,
        parameters: {
          ...rule.parameters,
          required_status_checks: mergedEntries,
        },
      };
    }
    if (rule.type === 'pull_request' && rule.parameters) {
      const have = Number(ex?.parameters?.required_approving_review_count ?? 0);
      const want = Number(rule.parameters.required_approving_review_count ?? 0);
      return {
        ...rule,
        parameters: {
          ...rule.parameters,
          required_approving_review_count: Math.max(have, want),
        },
      };
    }
    return rule;
  });

  return {
    name: desired.name,
    target: desired.target,
    enforcement: desired.enforcement,
    bypass_actors: bypass,
    conditions: desired.conditions,
    rules,
  };
}

// `unionContexts` (string-only union) removed: `mergeForPut` now unions
// entries via `statusCheckEntries` so the `integration_id` pin survives.
// Leaving a string-only union in place invites the same strip to be
// reintroduced by a future edit that reaches for the convenient helper.

/** Compares two values as sets (order-insensitive). Non-arrays fall back to ===. */
function arraysEqualAsSet(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  const sa = a.map((x) => JSON.stringify(x)).sort();
  const sb = b.map((x) => JSON.stringify(x)).sort();
  return sa.every((v, i) => v === sb[i]);
}
