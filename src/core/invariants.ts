// Executable-probe invariants: config + run-gate (Phase R / clud-bug-app #87).
//
// An INVARIANT is a repo-declared behavioral property paired with an executable
// PROBE: a shell command that exits non-zero (RED) when the property is violated.
// Unlike a prose `reviewContext` instruction — which is checked *statically*
// against the diff and so can never fire on a bug that lives in no single changed
// line — a probe is *run*, so it can ground the emergent / combinatorial /
// cross-cutting bugs the "quote-the-line" gate structurally misses. A finding
// fires only when a probe runs RED; RED output is trusted machine evidence, equal
// in standing to a quoted diff line.
//
// This module is the shared, pure brain (like `design.ts`): every surface resolves
// config + the in-scope gate here so policy can't fork. Whether a probe can
// actually be *executed* differs per surface (local/max: full shell; hosted
// serverless: static-degrade, no checkout; Action: a separate CI job outside the
// allowlist-sandboxed reviewer) — that is a consumer concern. This module only
// decides *whether* probes are in scope for a given diff + trigger.

import type { ReviewTrigger } from './plan-review.js';

/** A repo-declared behavioral property with an executable probe. */
export interface Invariant {
  /** Human name, shown in the probe-results block + any resulting finding. */
  name: string;
  /** Glob(s) over changed paths; the probe is in scope only when the diff hits one. */
  appliesTo: string[];
  /** Shell command; a non-zero exit is RED (the property is violated). */
  probe: string;
  /** Optional expected-output / golden reference, surfaced in the prompt + transcript. */
  expect?: string;
}

/** Resolved `.clud-bug.json` `invariants` config (defaults applied). */
export interface InvariantsConfig {
  /** Master switch. Default OFF — probes never run unless this is true. */
  enabled: boolean;
  /** The validated invariant set (malformed entries dropped). */
  invariants: Invariant[];
}

/** Off-by-default builtin — the cost-control floor (probes build+run, so they cost). */
export const BUILTIN_INVARIANTS_CONFIG: InvariantsConfig = {
  enabled: false,
  invariants: [],
};

/** Parse + validate one raw invariant entry. Tolerant; returns null if unusable. */
function parseInvariant(raw: unknown): Invariant | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const name = typeof o['name'] === 'string' && o['name'].trim() ? o['name'] : null;
  const probe = typeof o['probe'] === 'string' && o['probe'].trim() ? o['probe'] : null;
  if (!name || !probe) return null;

  // appliesTo: accept a single glob string or an array of them; drop empties.
  let appliesTo: string[] = [];
  if (typeof o['appliesTo'] === 'string' && o['appliesTo'].trim()) {
    appliesTo = [o['appliesTo']];
  } else if (Array.isArray(o['appliesTo'])) {
    appliesTo = o['appliesTo'].filter((g): g is string => typeof g === 'string' && g.trim().length > 0);
  }
  if (appliesTo.length === 0) return null; // no globs → cannot cost-gate → unusable

  const invariant: Invariant = { name, appliesTo, probe };
  if (typeof o['expect'] === 'string') invariant.expect = o['expect'];
  return invariant;
}

/**
 * Read + normalize the `invariants` config from a parsed `.clud-bug.json` manifest.
 *
 * Accepts two authoring forms (tolerant, mirroring `readReviewPassesConfig`):
 *   - a bare array:      `"invariants": [ { name, appliesTo, probe, expect? }, … ]`
 *   - a wrapper object:  `"invariants": { "enabled": false, "list": [ … ] }`  (a
 *     kill-switch that retains the config while turning probes off)
 *
 * A missing/malformed block, or one with zero *valid* invariants, resolves to the
 * off-by-default builtin — a typo can never silently enable the cost-bearing probe
 * run. Declaring at least one valid invariant is the explicit opt-in.
 */
export function readInvariantsConfig(manifest: unknown): InvariantsConfig {
  const raw = (manifest as { invariants?: unknown } | null | undefined)?.invariants;

  let list: unknown;
  let enabledOverride: boolean | undefined;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    list = o['list'] ?? o['invariants'];
    if (typeof o['enabled'] === 'boolean') enabledOverride = o['enabled'];
  } else {
    return { enabled: false, invariants: [] };
  }

  const invariants = Array.isArray(list)
    ? list.map(parseInvariant).filter((i): i is Invariant => i !== null)
    : [];

  // Default ON when invariants are present; an explicit `enabled: false` disables
  // while retaining them (kill-switch). Never enabled with zero valid invariants.
  const enabled = (enabledOverride ?? true) && invariants.length > 0;
  return { enabled, invariants };
}

/**
 * Consumer-agnostic in-scope gate for the probe run. Pure.
 *
 * True only when the repo opted in (`enabled`), at least one invariant's
 * `appliesTo` matched the changed paths (`applicableCount`, computed by the caller
 * with the existing glob matcher), and this is a PR-level review — build+run is
 * too expensive for the per-commit / per-push triggers. Consumers layer their own
 * runtime preconditions on top (local: a shell + toolchain present; hosted:
 * static-degrade; Action: a dedicated CI job).
 */
export function shouldRunProbes(
  config: InvariantsConfig,
  applicableCount: number,
  trigger: ReviewTrigger,
): boolean {
  return config.enabled && applicableCount > 0 && trigger === 'pr';
}
