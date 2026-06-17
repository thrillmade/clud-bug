// SPEC §7 canonical-ruleset applier — pure core half of `configure-github`.
//
// External users installing the App expect "best practice branch protection"
// applied automatically. This module diffs the current GitHub state against
// the canonical ruleset (bundled at `data/canonical-v1.json`) and emits the
// minimal set of PATCH calls to converge.
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
// `alreadyCanonical: true` with `changes: []` and zero PATCH calls. This
// lets external automation (CI, dispatch loops, dashboard probes) call
// `apply()` defensively without rate-limiting itself out of the API.
//
// SPEC pins honored here:
//   - canonical-v1.json schema (frozen at v1; major bumps require coordinated
//     tool releases per the `$comment` field).
//   - `required_status_checks.contexts` are TREATED AS A SUPERSET: if the
//     repo already requires MORE contexts than the canonical list, we leave
//     them alone (a repo that runs additional CI gates legitimately needs
//     them in the required set). We only ADD the canonical contexts that
//     are missing.
//   - `required_approving_review_count`: canonical floor is 1. If the repo
//     already requires MORE than 1, we leave it alone (only raise to floor).
//
// Offline-resilient bundling: the canonical ruleset ships in `data/` at
// the package root (alongside `bin/`, `templates/`, etc., per package.json
// `files`). We read it at runtime via fs.readFile so the build stays out
// of TypeScript's `rootDir` constraint, and so callers that re-bundle
// clud-bug into a single file can override the ruleset by passing one
// explicitly to `applyCanonicalRuleset({ ruleset })`.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The canonical-v1.json structure. Frozen at v1; major bumps require
 * coordinated tool releases per the protocol repo's `$comment` field.
 */
export interface CanonicalRuleset {
  version: 'v1';
  spec_version: string;
  branch_protection: {
    required_status_checks: {
      strict: boolean;
      contexts: string[];
    };
    required_pull_request_reviews: {
      required_approving_review_count: number;
      dismiss_stale_reviews: boolean;
      require_code_owner_reviews: boolean;
    };
    required_conversation_resolution: boolean;
    enforce_admins: boolean;
    allow_force_pushes: boolean;
    allow_deletions: boolean;
    required_linear_history: boolean;
    allow_auto_merge: boolean;
    delete_branch_on_merge: boolean;
    squash_merge_commit_title: string;
    squash_merge_commit_message: string;
  };
}

/**
 * Resolves the package root from this file's URL. After tsc the file lives
 * at `<pkg>/dist/core/configure-github.js`; three dirname() climbs land on
 * `<pkg>`, parallel to the package.json `files` map entry for `data`.
 */
const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Memoized canonical ruleset — loaded once per process. */
let CANONICAL_V1_CACHE: CanonicalRuleset | null = null;

/**
 * Loads the bundled canonical-v1 ruleset from `data/canonical-v1.json`.
 * Memoized so repeated calls don't re-hit the filesystem.
 *
 * Throws a wrapped error if the JSON file is missing — that's an
 * install-time defect (package.json `files` excluded `data/`), not a
 * runtime concern, and the loud failure surfaces it immediately.
 */
export async function loadCanonicalV1(): Promise<CanonicalRuleset> {
  if (CANONICAL_V1_CACHE) return CANONICAL_V1_CACHE;
  const path = join(PKG_ROOT, 'data', 'canonical-v1.json');
  try {
    const raw = await readFile(path, 'utf-8');
    CANONICAL_V1_CACHE = JSON.parse(raw) as CanonicalRuleset;
    return CANONICAL_V1_CACHE;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `configure-github: failed to load bundled canonical-v1.json at ${path}: ${msg}`,
    );
  }
}

/**
 * Minimal structural Octokit interface — only the methods we actually call.
 *
 * We intentionally don't import `@octokit/rest` types: that would force
 * every consumer (App, CLI, future tools) to install Octokit at runtime
 * even when they pass a `gh`-CLI-backed adapter. Keeping the shape
 * structural lets the CLI's `gh`-wrapping adapter satisfy it without
 * pulling in a 200KB dep.
 *
 * If `@octokit/rest`'s real method shapes ever drift, the adapter +
 * runtime call sites are the only files that need updating; the rule
 * table here stays Octokit-version-agnostic.
 */
export interface OctokitLike {
  repos: {
    /** Read branch protection state. Throws on 404 (no protection rule). */
    getBranchProtection(params: {
      owner: string;
      repo: string;
      branch: string;
    }): Promise<{
      data: {
        required_status_checks?:
          | { strict?: boolean; contexts?: string[] }
          | null;
        required_pull_request_reviews?:
          | {
              required_approving_review_count?: number;
              dismiss_stale_reviews?: boolean;
              require_code_owner_reviews?: boolean;
            }
          | null;
        required_conversation_resolution?: { enabled?: boolean } | null;
        enforce_admins?: { enabled?: boolean } | null;
        allow_force_pushes?: { enabled?: boolean } | null;
        allow_deletions?: { enabled?: boolean } | null;
        required_linear_history?: { enabled?: boolean } | null;
      };
    }>;
    /** PUT branch protection (the REST API does NOT support PATCH). */
    updateBranchProtection(params: {
      owner: string;
      repo: string;
      branch: string;
      required_status_checks: { strict: boolean; contexts: string[] } | null;
      enforce_admins: boolean | null;
      required_pull_request_reviews: {
        required_approving_review_count: number;
        dismiss_stale_reviews: boolean;
        require_code_owner_reviews: boolean;
      } | null;
      restrictions: null;
      required_conversation_resolution?: boolean;
      required_linear_history?: boolean;
      allow_force_pushes?: boolean;
      allow_deletions?: boolean;
    }): Promise<unknown>;
    /** Read repo-level settings (delete_branch_on_merge, allow_auto_merge, etc). */
    get(params: { owner: string; repo: string }): Promise<{
      data: {
        delete_branch_on_merge?: boolean;
        allow_auto_merge?: boolean;
        squash_merge_commit_title?: string;
        squash_merge_commit_message?: string;
      };
    }>;
    /** PATCH repo-level settings. */
    update(params: {
      owner: string;
      repo: string;
      delete_branch_on_merge?: boolean;
      allow_auto_merge?: boolean;
      squash_merge_commit_title?: string;
      squash_merge_commit_message?: string;
    }): Promise<unknown>;
  };
}

export interface ApplyCanonicalRulesetParams {
  owner: string;
  repo: string;
  /**
   * Target branch (default: `main`). Most consumers will use `main`; this
   * is exposed for downstream tools that converge non-`main` defaults.
   */
  branch?: string;
  /**
   * The ruleset to apply. Defaults to the bundled `canonical-v1.json`
   * (loaded via `loadCanonicalV1()` if absent). Future v2 callers pass
   * an explicit ruleset; the type system pins the shape.
   */
  ruleset?: CanonicalRuleset;
  /**
   * If true, compute diff only and skip all PATCH calls. The result still
   * reports `changes: string[]` so the CLI can render the human-readable
   * diff before applying.
   */
  dryRun?: boolean;
}

export interface ApplyResult {
  /** Human-readable diff lines, one per detected difference. Empty when alreadyCanonical. */
  changes: string[];
  /** True when the live state already matches every canonical setting. */
  alreadyCanonical: boolean;
  /** Schema version applied (always 'canonical-v1' for this build). */
  ruleset: 'canonical-v1';
}

/**
 * Applies the canonical ruleset to a GitHub repo. Reads current state via
 * the Octokit-like instance, diffs against `ruleset` (default
 * `CANONICAL_V1`), and PATCHes only what differs. Idempotent: second call
 * returns `alreadyCanonical: true` with no PATCH side effects.
 *
 * Behavior on partial mismatch:
 *
 *   - `required_status_checks.contexts`: canonical contexts that are
 *     missing get added; extra contexts on the repo are preserved (superset
 *     contract — a repo that runs more CI gates legitimately needs them).
 *   - `required_approving_review_count`: canonical floor is 1; if the repo
 *     already requires more, we don't lower (raise-only contract).
 *   - All booleans (allow_force_pushes, allow_deletions, etc.): converge
 *     to the canonical value exactly.
 *
 * Throws on Octokit transport failure (auth, network, 403). The CLI
 * wraps these with a friendly error message.
 */
export async function applyCanonicalRuleset(
  octokit: OctokitLike,
  params: ApplyCanonicalRulesetParams,
): Promise<ApplyResult> {
  const {
    owner,
    repo,
    branch = 'main',
    dryRun = false,
  } = params;
  const ruleset = params.ruleset ?? (await loadCanonicalV1());

  const target = ruleset.branch_protection;
  const changes: string[] = [];

  // ----- Read current branch protection state ---------------------------
  // 404 → no base protection rule. We treat that as "every canonical
  // setting differs" so the apply path creates the rule. Other errors
  // bubble up — callers can't recover from a 403.
  let current: Awaited<
    ReturnType<OctokitLike['repos']['getBranchProtection']>
  >['data'] = {};
  let hasBaseProtection = true;
  try {
    const resp = await octokit.repos.getBranchProtection({
      owner,
      repo,
      branch,
    });
    current = resp.data;
  } catch (err) {
    if (isBranchNotProtected(err)) {
      hasBaseProtection = false;
    } else {
      throw err;
    }
  }

  // ----- Diff: required_status_checks -----------------------------------
  // Behavior: contexts are a SUPERSET. Strict mode must match exactly.
  const currentChecks = current.required_status_checks ?? null;
  const currentContexts = new Set(currentChecks?.contexts ?? []);
  const targetContexts = new Set(target.required_status_checks.contexts);
  const missingContexts = [...targetContexts].filter(
    (c) => !currentContexts.has(c),
  );
  const strictMismatch =
    (currentChecks?.strict ?? false) !== target.required_status_checks.strict;
  let needsChecksPatch = !hasBaseProtection;
  if (missingContexts.length > 0) {
    changes.push(
      `required_status_checks.contexts: add ${JSON.stringify(missingContexts)}`,
    );
    needsChecksPatch = true;
  }
  if (strictMismatch) {
    changes.push(
      `required_status_checks.strict: ${currentChecks?.strict ?? false} → ${target.required_status_checks.strict}`,
    );
    needsChecksPatch = true;
  }
  // The merged context list: keep extras the repo already required.
  const mergedContexts = [
    ...new Set([
      ...(currentChecks?.contexts ?? []),
      ...target.required_status_checks.contexts,
    ]),
  ];

  // ----- Diff: required_pull_request_reviews ----------------------------
  // Behavior: approving_review_count is a FLOOR (only raise). Booleans
  // converge exactly.
  const currentReviews = current.required_pull_request_reviews ?? null;
  const currentCount = currentReviews?.required_approving_review_count ?? 0;
  const targetCount =
    target.required_pull_request_reviews.required_approving_review_count;
  const effectiveCount = Math.max(currentCount, targetCount);
  const targetDismiss =
    target.required_pull_request_reviews.dismiss_stale_reviews;
  const targetCodeOwner =
    target.required_pull_request_reviews.require_code_owner_reviews;
  let needsReviewsPatch = !hasBaseProtection;
  if (effectiveCount !== currentCount) {
    changes.push(
      `required_pull_request_reviews.required_approving_review_count: ${currentCount} → ${effectiveCount}`,
    );
    needsReviewsPatch = true;
  }
  if ((currentReviews?.dismiss_stale_reviews ?? false) !== targetDismiss) {
    changes.push(
      `required_pull_request_reviews.dismiss_stale_reviews: ${currentReviews?.dismiss_stale_reviews ?? false} → ${targetDismiss}`,
    );
    needsReviewsPatch = true;
  }
  if (
    (currentReviews?.require_code_owner_reviews ?? false) !== targetCodeOwner
  ) {
    changes.push(
      `required_pull_request_reviews.require_code_owner_reviews: ${currentReviews?.require_code_owner_reviews ?? false} → ${targetCodeOwner}`,
    );
    needsReviewsPatch = true;
  }

  // ----- Diff: single-flag branch protection booleans -------------------
  const conv =
    current.required_conversation_resolution?.enabled ?? false;
  const enforceAdmins = current.enforce_admins?.enabled ?? false;
  const allowFP = current.allow_force_pushes?.enabled ?? false;
  const allowDel = current.allow_deletions?.enabled ?? false;
  const linearHistory = current.required_linear_history?.enabled ?? false;
  if (conv !== target.required_conversation_resolution) {
    changes.push(
      `required_conversation_resolution: ${conv} → ${target.required_conversation_resolution}`,
    );
  }
  if (enforceAdmins !== target.enforce_admins) {
    changes.push(
      `enforce_admins: ${enforceAdmins} → ${target.enforce_admins}`,
    );
  }
  if (allowFP !== target.allow_force_pushes) {
    changes.push(
      `allow_force_pushes: ${allowFP} → ${target.allow_force_pushes}`,
    );
  }
  if (allowDel !== target.allow_deletions) {
    changes.push(
      `allow_deletions: ${allowDel} → ${target.allow_deletions}`,
    );
  }
  if (linearHistory !== target.required_linear_history) {
    changes.push(
      `required_linear_history: ${linearHistory} → ${target.required_linear_history}`,
    );
  }

  // ----- Diff: repo-level settings --------------------------------------
  // delete_branch_on_merge / allow_auto_merge / squash commit shape live
  // on the REPO, not the branch protection rule. Fetched separately.
  const repoResp = await octokit.repos.get({ owner, repo });
  const repoData = repoResp.data;
  const repoPatch: Parameters<OctokitLike['repos']['update']>[0] = {
    owner,
    repo,
  };
  let needsRepoPatch = false;
  if (
    (repoData.delete_branch_on_merge ?? false) !== target.delete_branch_on_merge
  ) {
    changes.push(
      `delete_branch_on_merge: ${repoData.delete_branch_on_merge ?? false} → ${target.delete_branch_on_merge}`,
    );
    repoPatch.delete_branch_on_merge = target.delete_branch_on_merge;
    needsRepoPatch = true;
  }
  if ((repoData.allow_auto_merge ?? false) !== target.allow_auto_merge) {
    changes.push(
      `allow_auto_merge: ${repoData.allow_auto_merge ?? false} → ${target.allow_auto_merge}`,
    );
    repoPatch.allow_auto_merge = target.allow_auto_merge;
    needsRepoPatch = true;
  }
  if (
    (repoData.squash_merge_commit_title ?? '') !==
    target.squash_merge_commit_title
  ) {
    changes.push(
      `squash_merge_commit_title: ${repoData.squash_merge_commit_title ?? '(unset)'} → ${target.squash_merge_commit_title}`,
    );
    repoPatch.squash_merge_commit_title = target.squash_merge_commit_title;
    needsRepoPatch = true;
  }
  if (
    (repoData.squash_merge_commit_message ?? '') !==
    target.squash_merge_commit_message
  ) {
    changes.push(
      `squash_merge_commit_message: ${repoData.squash_merge_commit_message ?? '(unset)'} → ${target.squash_merge_commit_message}`,
    );
    repoPatch.squash_merge_commit_message = target.squash_merge_commit_message;
    needsRepoPatch = true;
  }

  const alreadyCanonical = changes.length === 0;

  if (alreadyCanonical || dryRun) {
    return {
      changes,
      alreadyCanonical,
      ruleset: 'canonical-v1',
    };
  }

  // ----- Apply: branch protection ---------------------------------------
  // The REST API requires a PUT (not PATCH) with the full settings object.
  // We always send a complete envelope; the diff above gates whether we
  // call PUT at all.
  if (needsChecksPatch || needsReviewsPatch || !hasBaseProtection || hasBranchProtectionLevelDiff(changes)) {
    await octokit.repos.updateBranchProtection({
      owner,
      repo,
      branch,
      required_status_checks: {
        strict: target.required_status_checks.strict,
        contexts: mergedContexts,
      },
      enforce_admins: target.enforce_admins,
      required_pull_request_reviews: {
        required_approving_review_count: effectiveCount,
        dismiss_stale_reviews: targetDismiss,
        require_code_owner_reviews: targetCodeOwner,
      },
      restrictions: null,
      required_conversation_resolution: target.required_conversation_resolution,
      required_linear_history: target.required_linear_history,
      allow_force_pushes: target.allow_force_pushes,
      allow_deletions: target.allow_deletions,
    });
  }

  // ----- Apply: repo-level settings -------------------------------------
  if (needsRepoPatch) {
    await octokit.repos.update(repoPatch);
  }

  return {
    changes,
    alreadyCanonical: false,
    ruleset: 'canonical-v1',
  };
}

/**
 * Octokit (and gh's wrapping adapter) report a missing branch protection
 * rule as a 404. We catch on the structural shape of the error so the
 * downstream Octokit version doesn't matter.
 */
function isBranchNotProtected(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 404) return true;
  if (typeof e.message === 'string') {
    return /Branch not protected|Not Found|404/i.test(e.message);
  }
  return false;
}

/**
 * Detect whether any of the per-branch protection settings (conversation
 * resolution / force-pushes / deletions / linear-history / enforce-admins)
 * appeared in the change list. Used to decide whether the branch protection
 * PUT needs to fire when status_checks + reviews are both in sync.
 */
function hasBranchProtectionLevelDiff(changes: string[]): boolean {
  return changes.some((c) =>
    /^(required_conversation_resolution|enforce_admins|allow_force_pushes|allow_deletions|required_linear_history):/.test(
      c,
    ),
  );
}
