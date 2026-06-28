// Wave 5b — D.2.6 auto-resolve fidelity, npm-workflow flavor.
//
// On every fix-push (`pull_request.synchronize`), for each open thread
// posted by the bot on a prior pass, decide whether the new commit
// addressed the original concern, and act accordingly:
//
//   ADDRESSED      → resolve the thread + post "Auto-resolved (verified)"
//   NOT_ADDRESSED  → keep open + post "Re-review found this still applies"
//                    + flag REQUEST_CHANGES intent if 🔴 critical
//   UNCERTAIN + 🟡 → keep open + post "human review recommended"
//   UNCERTAIN + 🔴 → keep open + flag REQUEST_CHANGES + escalate. NEVER dismiss.
//
// This module owns the pure rule tables + config merge + marker
// rendering. The CLI verb in `src/cli/main.ts::runResolveThreads` owns
// the IO: fetching threads via `gh api graphql`, calling Anthropic
// Messages API for the verifier, applying these actions via REST/
// GraphQL mutations.
//
// Ported from `clud-bug-app/lib/auto-resolve.ts` (and the marker
// helpers from `clud-bug-app/lib/comment.ts`). Differences from the
// App impl:
//   - DROP `aggregateMultiPassVerdicts` — OSS workflow is single-pass.
//   - DROP heuristic fallback (`heuristicAction`) — OSS supports only
//     `mode: 'verified' | 'off'` for now; heuristic adds complexity
//     without a customer ask. Future Wave 5c can add it back if the
//     App migrates to consume from core.
//   - DROP per-PR budget gate — OSS workflow uses the customer's own
//     `ANTHROPIC_API_KEY`; spend-cap is their concern, not ours.

import { createHash } from 'node:crypto';

import type { Severity } from './inline-threads.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration for `autoResolve` in `.clud-bug.json`. */
export interface AutoResolveConfig {
  /**
   * Which mode the install opted into.
   * - 'verified' (default): call the verifier per thread.
   * - 'off': do nothing — all threads stay open, no verifier calls.
   */
  mode: 'verified' | 'off';
  /**
   * Action to take when the verifier returns UNCERTAIN + the original
   * finding was 🔴 critical.
   *
   * - 'request_changes' (default): keep open + flag REQUEST_CHANGES.
   * - 'leave_open': keep open with a milder marker, no escalation.
   */
  uncertain_critical_action: 'request_changes' | 'leave_open';
}

export const DEFAULT_AUTO_RESOLVE_CONFIG: AutoResolveConfig = {
  mode: 'verified',
  uncertain_critical_action: 'request_changes',
};

/**
 * One open thread from a prior review pass, plus enough state to verify
 * it. The CLI verb hands these to `runAutoResolve` after parsing the
 * GraphQL response + the bot's comment-body markers.
 */
export interface PriorThread {
  /** GitHub review-thread node ID (GraphQL ID). Used to resolve the thread. */
  threadId: string;
  /** The prior finding the thread anchors. */
  finding: PriorFinding;
  /** Code at the finding anchor BEFORE the fix-push. */
  codeBefore: string;
  /** Code at the finding anchor AFTER the fix-push. */
  codeAfter: string;
  /** Diff hunk at the anchor (optional). */
  diffAtAnchor?: string;
}

/**
 * The minimal shape `applyResolutionRules` + the verifier need to
 * describe a prior finding. The CLI reconstructs this from
 * `parseThreadBody(comment.body)` + the GraphQL `path`/`line` fields.
 */
export interface PriorFinding {
  severity: Severity;
  /** The summary line + (optional) reasoning, joined for the verifier prompt. */
  body: string;
  /** The skill slug that raised the finding. */
  skill: string;
  /** Repo-relative path. */
  file: string;
  /** Optional 1-indexed line number. */
  line?: number;
}

/** What the CLI verb should do with the thread. */
export type ThreadAction =
  | { kind: 'resolve'; markerBody: string; verdict: VerifyOutcome }
  | { kind: 'keep_open'; markerBody: string; verdict: VerifyOutcome }
  | {
      kind: 'keep_open_request_changes';
      markerBody: string;
      verdict: VerifyOutcome;
      /** True when triggered by UNCERTAIN+🔴 escalation. */
      escalated: boolean;
    }
  | {
      kind: 'skipped';
      reason: 'off';
      thread?: PriorThread;
    };

/** Verdict shape — re-exported from resolve-verifier for ergonomics. */
export interface VerifyOutcome {
  verdict: 'ADDRESSED' | 'NOT_ADDRESSED' | 'UNCERTAIN';
  rationale: string;
  source: 'model' | 'api-error';
}

export interface AutoResolveInput {
  /** Open threads from prior review passes. May be empty. */
  priorThreads: PriorThread[];
  /** Resolved config (after precedence merge). */
  config: AutoResolveConfig;
  /**
   * Whether the caller can actually resolve threads (a dedicated PAT is
   * present). Drives the addressed-marker wording: PAT → "Auto-resolved";
   * no-PAT → "Verified fixed — not auto-closed". Defaults to true (the App
   * path / unit tests, where the App token can resolve).
   */
  canResolve?: boolean;
  /** Verifier callback. Tests inject a stub; CLI provides real Anthropic-call fn. */
  verifier: (args: {
    finding: PriorFinding;
    codeBefore: string;
    codeAfter: string;
    diffAtAnchor?: string;
  }) => Promise<VerifyOutcome>;
}

export interface AutoResolveResult {
  /** One action per input thread, in input order. */
  actions: ThreadAction[];
  /** Total verifier calls made. */
  verifierCallCount: number;
  /**
   * True when any action is `keep_open_request_changes`. The CLI verb /
   * workflow uses this to decide whether to flip the formal review to
   * REQUEST_CHANGES (one transition covers all flagged threads).
   */
  shouldRequestChanges: boolean;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/**
 * Reads `autoResolve` from a `.clud-bug.json` payload + merges with
 * built-in defaults. Returns a fully-resolved `AutoResolveConfig`.
 *
 * Unknown fields tolerated (forward compat). Invalid values fall back
 * to the default for that key + log a warning. NEVER throws — a
 * config-validation throw on the fix-push hot path would degrade the
 * whole step to a fail.
 */
export function resolveAutoResolveConfig(
  raw: unknown,
  onWarn: (msg: string) => void = () => {},
): AutoResolveConfig {
  const defaults = DEFAULT_AUTO_RESOLVE_CONFIG;
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, unknown>;

  let mode: AutoResolveConfig['mode'] = defaults.mode;
  if (typeof obj.mode === 'string') {
    if (obj.mode === 'verified' || obj.mode === 'off') {
      mode = obj.mode;
    } else {
      onWarn(
        `autoResolve.mode = ${JSON.stringify(obj.mode)} is invalid; falling back to "${defaults.mode}". Valid: verified, off.`,
      );
    }
  }

  let uncertainCritical: AutoResolveConfig['uncertain_critical_action'] =
    defaults.uncertain_critical_action;
  if (typeof obj.uncertain_critical_action === 'string') {
    if (
      obj.uncertain_critical_action === 'request_changes' ||
      obj.uncertain_critical_action === 'leave_open'
    ) {
      uncertainCritical = obj.uncertain_critical_action;
    } else {
      onWarn(
        `autoResolve.uncertain_critical_action = ${JSON.stringify(obj.uncertain_critical_action)} is invalid; falling back to "${defaults.uncertain_critical_action}".`,
      );
    }
  }

  return {
    mode,
    uncertain_critical_action: uncertainCritical,
  };
}

/**
 * Convenience: extracts the `autoResolve` block from a top-level
 * `.clud-bug.json` config blob.
 */
export function readAutoResolveConfigFromCludBug(
  config: { autoResolve?: unknown } | null | undefined,
  onWarn?: (msg: string) => void,
): AutoResolveConfig {
  if (!config) return DEFAULT_AUTO_RESOLVE_CONFIG;
  return resolveAutoResolveConfig(config.autoResolve, onWarn);
}

// ---------------------------------------------------------------------------
// Main entry point — pure orchestration with injected verifier
// ---------------------------------------------------------------------------

/**
 * For each prior thread, call the injected verifier + apply the
 * resolution rules. Returns one action per input thread, plus
 * aggregate stats.
 *
 * The CLI verb executes the returned actions (GraphQL mutations);
 * this function is pure modulo the verifier callback.
 */
export async function runAutoResolve(
  input: AutoResolveInput,
): Promise<AutoResolveResult> {
  if (input.config.mode === 'off') {
    return {
      actions: input.priorThreads.map((thread) => ({
        kind: 'skipped' as const,
        reason: 'off' as const,
        thread,
      })),
      verifierCallCount: 0,
      shouldRequestChanges: false,
    };
  }

  const actions: ThreadAction[] = [];
  let verifierCallCount = 0;
  let shouldRequestChanges = false;

  for (const thread of input.priorThreads) {
    // Conditionally include `diffAtAnchor` only when present so the
    // narrowed `verifier` callback type (which forbids `undefined`
    // under `exactOptionalPropertyTypes`) stays satisfied.
    const verifierArgs: Parameters<typeof input.verifier>[0] = {
      finding: thread.finding,
      codeBefore: thread.codeBefore,
      codeAfter: thread.codeAfter,
      ...(thread.diffAtAnchor !== undefined
        ? { diffAtAnchor: thread.diffAtAnchor }
        : {}),
    };
    const verdict = await input.verifier(verifierArgs);
    verifierCallCount++;
    const action = applyResolutionRules({
      thread,
      verdict,
      config: input.config,
      canResolve: input.canResolve !== false,
    });
    actions.push(action);
    if (action.kind === 'keep_open_request_changes') shouldRequestChanges = true;
  }

  return { actions, verifierCallCount, shouldRequestChanges };
}

// ---------------------------------------------------------------------------
// Rule table — pure function from (verdict, finding, config) → action
// ---------------------------------------------------------------------------

/**
 * Maps a verifier verdict + the thread context to the action the CLI
 * verb should take. Pure function, no I/O.
 *
 * Resolution table:
 *   ADDRESSED, any         → resolve, "Auto-resolved (verified)"
 *   NOT_ADDRESSED, 🔴      → keep_open_request_changes (escalated=false)
 *   NOT_ADDRESSED, 🟡      → keep_open, "Re-review found this still applies"
 *   UNCERTAIN, 🔴, request → keep_open_request_changes (escalated=true)
 *   UNCERTAIN, 🔴, leave   → keep_open, "Auto-resolve uncertain — human review recommended"
 *   UNCERTAIN, 🟡          → keep_open, "human review recommended"
 */
export function applyResolutionRules(args: {
  thread: PriorThread;
  verdict: VerifyOutcome;
  config: AutoResolveConfig;
  /** Whether the resolve mutation is available (PAT present). Defaults true. */
  canResolve?: boolean;
}): ThreadAction {
  const { verdict, thread, config } = args;
  const canResolve = args.canResolve !== false;
  const severity = thread.finding.severity;

  if (verdict.verdict === 'ADDRESSED') {
    return {
      kind: 'resolve',
      markerBody: renderAutoResolveMarker({
        kind: 'verified-addressed',
        rationale: verdict.rationale,
        resolved: canResolve,
      }),
      verdict,
    };
  }

  if (verdict.verdict === 'NOT_ADDRESSED') {
    const markerBody = renderAutoResolveMarker({
      kind: 'verified-not-addressed',
      rationale: verdict.rationale,
    });
    if (severity === 'critical') {
      return {
        kind: 'keep_open_request_changes',
        markerBody,
        verdict,
        escalated: false,
      };
    }
    return { kind: 'keep_open', markerBody, verdict };
  }

  // UNCERTAIN.
  const markerBody = renderAutoResolveMarker({
    kind: 'verified-uncertain',
    rationale: verdict.rationale,
    severity,
  });
  if (
    severity === 'critical' &&
    config.uncertain_critical_action === 'request_changes'
  ) {
    return {
      kind: 'keep_open_request_changes',
      markerBody,
      verdict,
      escalated: true,
    };
  }
  return { kind: 'keep_open', markerBody, verdict };
}

// ---------------------------------------------------------------------------
// Marker rendering — ported from clud-bug-app/lib/comment.ts
// ---------------------------------------------------------------------------

type AutoResolveMarkerInput =
  | { kind: 'verified-addressed'; rationale?: string; resolved?: boolean }
  | { kind: 'verified-not-addressed'; rationale?: string }
  | { kind: 'verified-uncertain'; rationale?: string; severity: Severity };

/**
 * Renders the comment body the CLI verb posts as a reply on the
 * thread before resolving (or alongside keep-open). Wording mirrors
 * the App's `renderAutoResolveMarker` so both consumers emit a
 * uniform audit trail.
 */
export function renderAutoResolveMarker(input: AutoResolveMarkerInput): string {
  const tail = input.rationale ? `: ${input.rationale.trim()}` : '.';
  switch (input.kind) {
    case 'verified-addressed':
      // No PAT → we did NOT resolve the thread, so don't claim "Auto-resolved".
      // Post an accurate "verified fixed" badge + the manual-Resolve hint.
      if (input.resolved === false) {
        return (
          `**✅ Verified fixed — not auto-closed**${tail} ` +
          `_The Actions \`GITHUB_TOKEN\` can't resolve review threads; click ` +
          `**Resolve conversation** to dismiss, or add a \`CLUD_BUG_RESOLVE_PAT\` ` +
          `secret to auto-close (see README)._`
        );
      }
      return `**✓ Auto-resolved (verified by D.2.6 fix-check)**${tail}`;
    case 'verified-not-addressed':
      return `**❌ Re-review found this still applies**${tail}`;
    case 'verified-uncertain':
      if (input.severity === 'critical') {
        return `**⚠ Auto-resolve uncertain on a 🔴 critical — escalated, never silently dismissed**${tail}`;
      }
      return `**⚠ Auto-resolve uncertain — human review recommended**${tail}`;
  }
}

// ---------------------------------------------------------------------------
// Wave 5b.1 (rc.9) — graceful PAT-or-fallback resolve + idempotency
// ---------------------------------------------------------------------------

/** Which token the resolve mutation should use, and whether it's a dedicated PAT. */
export interface ResolveAuth {
  token: string;
  source: 'pat' | 'gh_token';
  hasDedicatedPat: boolean;
}

/**
 * Picks the token for the `resolveReviewThread` GraphQL mutation. A dedicated
 * fine-grained PAT (`CLUD_BUG_RESOLVE_PAT`, or the `RESOLVE_PAT` alias) is
 * preferred — the Actions `GITHUB_TOKEN` can't resolve review threads
 * ("Resource not accessible by integration"). With no PAT the verb keeps using
 * `GH_TOKEN` for the other gh calls and skips the resolve mutation entirely.
 *
 * Empty / whitespace-only values are treated as absent — GitHub renders an
 * unset secret as the empty string, so `CLUD_BUG_RESOLVE_PAT=''` must NOT
 * shadow a hand-set `RESOLVE_PAT` alias.
 */
export function selectResolveAuth(env: {
  CLUD_BUG_RESOLVE_PAT?: string;
  RESOLVE_PAT?: string;
  GH_TOKEN?: string;
}): ResolveAuth {
  const pat =
    [env.CLUD_BUG_RESOLVE_PAT, env.RESOLVE_PAT]
      .map((v) => (v ?? '').trim())
      .find((v) => v !== '') ?? '';
  if (pat) return { token: pat, source: 'pat', hasDedicatedPat: true };
  return { token: (env.GH_TOKEN ?? '').trim(), source: 'gh_token', hasDedicatedPat: false };
}

/** Verifier verdict, as embedded in the idempotency marker. */
export type ResolveVerdict = 'ADDRESSED' | 'NOT_ADDRESSED' | 'UNCERTAIN';

const RESOLVE_MARKER_RE =
  /<!--\s*clud-bug-resolve\s+v=(ADDRESSED|NOT_ADDRESSED|UNCERTAIN)\s+sig=([a-f0-9]{16})\s*-->/;

/**
 * Hidden HTML-comment marker appended to each auto-resolve reply so a later
 * fix-push can tell whether it already replied to this thread for the current
 * (verdict, anchor) — making the reply idempotent instead of one-per-push.
 */
export function renderResolveMarkerTag(verdict: ResolveVerdict, sig: string): string {
  return `<!-- clud-bug-resolve v=${verdict} sig=${sig} -->`;
}

/** Parses the hidden marker out of a comment body. Null when absent / malformed. */
export function parseResolveMarkerTag(
  body: string,
): { verdict: ResolveVerdict; sig: string } | null {
  const m = body.match(RESOLVE_MARKER_RE);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { verdict: m[1] as ResolveVerdict, sig: m[2] };
}

/**
 * 8-hex-char signature of a finding's post-fix anchor. Stable while the anchor
 * is unchanged, changes when `codeAfter` changes — lets the verb skip
 * re-verifying + re-replying to a thread whose anchor hasn't moved.
 */
export function anchorSignature(
  finding: { file?: string; line?: number },
  codeAfter: string,
): string {
  const file = finding.file ?? '<no-file>';
  const line = finding.line ?? 0;
  // 16 hex chars (64-bit), matching `findingId`'s convention — wide enough
  // that a collision can't suppress a re-review marker.
  return createHash('sha256').update(`${file}:${line}:${codeAfter}`).digest('hex').slice(0, 16);
}

/**
 * Scans a thread's comments (oldest→newest, as GraphQL returns them) for the
 * most-recent bot-authored reply carrying a resolve marker. Returns its
 * `{verdict, sig}` or null. Only bot-authored comments count, so a user pasting
 * a marker can't spoof the idempotency state.
 */
export function latestResolveMarker(
  comments: Array<
    { author?: { login?: string | null } | null; body?: string | null } | null | undefined
  >,
  botAuthors: Set<string>,
): { verdict: ResolveVerdict; sig: string } | null {
  let latest: { verdict: ResolveVerdict; sig: string } | null = null;
  for (const c of comments) {
    if (!c) continue;
    const login = c.author?.login ?? '';
    if (!botAuthors.has(login)) continue;
    const tag = parseResolveMarkerTag(c.body ?? '');
    if (tag) latest = tag;
  }
  return latest;
}
