// Design-critic lens config + gate (Track B, rc.15).
//
// The design-critic is an OPTIONAL, off-by-default visual review pass that
// renders the changed UI (light + dark) and critiques it against `kind: design`
// skills. It is gated tightly so it only ever runs — and only ever costs — when
// a repo has explicitly opted in. This module is the shared, pure brain: the
// local recipe (`review-prompt`) and the hosted bot both resolve the config and
// the run-gate here so the policy can't fork (SPEC §11.5 / §12).

import type { ReviewTrigger } from './plan-review.js';

/** How design findings interact with the merge gate. */
export type DesignGate = 'advisory' | 'strict';

/** Resolved `.clud-bug.json` `design` block (defaults applied). */
export interface DesignConfig {
  /** Master switch. Default OFF — the design pass never runs unless this is true. */
  enabled: boolean;
  /**
   * `advisory` (default) — design findings post as comments, never block merge.
   * `strict` — a design `critical` turns the check RED (opt-in).
   */
  gate: DesignGate;
  /** Themes to render + critique. Default both. */
  themes: string[];
  /** Viewports to render. Default a single desktop viewport. */
  viewports: string[];
}

/** Off-by-default builtin — the cost-control floor. */
export const BUILTIN_DESIGN_CONFIG: DesignConfig = {
  enabled: false,
  gate: 'advisory',
  themes: ['light', 'dark'],
  viewports: ['desktop'],
};

/**
 * Read + normalize the `design` block from a parsed `.clud-bug.json` manifest.
 * Tolerant: a missing/malformed block resolves to the off-by-default builtin,
 * so a typo can never silently *enable* the (cost-bearing) pass.
 */
export function readDesignConfig(manifest: unknown): DesignConfig {
  const raw = (manifest as { design?: unknown } | null | undefined)?.design;
  if (!raw || typeof raw !== 'object') return { ...BUILTIN_DESIGN_CONFIG };
  const d = raw as Record<string, unknown>;
  const strArr = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) && v.length > 0 ? v.map(String) : [...fallback];
  return {
    enabled: d['enabled'] === true,
    gate: d['gate'] === 'strict' ? 'strict' : 'advisory',
    themes: strArr(d['themes'], BUILTIN_DESIGN_CONFIG.themes),
    viewports: strArr(d['viewports'], BUILTIN_DESIGN_CONFIG.viewports),
  };
}

/**
 * Consumer-agnostic run-gate for the design-critic. Pure.
 *
 * True only when the repo opted in (`enabled`), at least one `kind: design`
 * skill applies, and this is a PR-level review (the pass is too expensive for
 * per-commit / per-push triggers). Consumers layer their own runtime
 * preconditions on top: the local recipe defers the deploy-preview-URL check to
 * the agent; the hosted bot additionally requires a paying tier + a resolved
 * preview URL before it spends a render.
 */
export function shouldRunDesign(
  config: DesignConfig,
  designSkillCount: number,
  trigger: ReviewTrigger,
): boolean {
  return config.enabled && designSkillCount > 0 && trigger === 'pr';
}
