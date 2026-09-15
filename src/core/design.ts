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

export interface ReadDesignConfigOptions {
  /**
   * The manifest as it stands on the pull request's BASE ref, where the
   * consumer has it. `gate` — and only `gate` — is then read from there.
   *
   * SPEC §6.3: "Anything that decides whether a change may merge … MUST be
   * read from the pull request's base ref. Never from the head ref, and never
   * from a workspace populated with the pull request's content." §4.8 makes
   * this field one of those: "because it changes whether something blocks, it
   * is a person's to set, never an agent's."
   *
   * Omit it where there is no base ref to read (a local `commit`/`push`
   * review), and resolution is unchanged.
   */
  baseRefManifest?: unknown;
}

/**
 * Read + normalize the `design` block from a parsed `.clud-bug.json` manifest.
 * Tolerant: a missing/malformed block resolves to the off-by-default builtin,
 * so a typo can never silently *enable* the (cost-bearing) pass.
 *
 * `themes` and `viewports` always come from the manifest passed first: they
 * decide what a run renders, not whether anything blocks, so the working
 * tree is allowed to say. `enabled` normally comes from there too — it is a
 * cost knob, §4.8's agent-owned half — EXCEPT once `gate` has resolved
 * `strict`: from that point the pass running at all is what the strict gate
 * has to block on, so `enabled` switches to the same trusted source as
 * `gate` (§6.3). Without that, a head-ref `enabled: false` would silently
 * defeat a base-ref `gate: strict` by starving it of anything to find —
 * disabling the pass is exactly as effective as disabling the gate, and the
 * head ref MUST NOT be able to do either once the base ref has gone strict.
 */
export function readDesignConfig(
  manifest: unknown,
  options: ReadDesignConfigOptions = {},
): DesignConfig {
  const gateSource = 'baseRefManifest' in options ? options.baseRefManifest : manifest;
  const gateBlock = readDesignBlock(gateSource);
  const gate: DesignGate = gateBlock?.['gate'] === 'strict' ? 'strict' : 'advisory';

  const raw = readDesignBlock(manifest);
  if (!raw) return { ...BUILTIN_DESIGN_CONFIG, gate };
  const strArr = (v: unknown, fallback: string[]): string[] =>
    Array.isArray(v) && v.length > 0 ? v.map(String) : [...fallback];
  return {
    enabled: gate === 'strict' ? gateBlock?.['enabled'] === true : raw['enabled'] === true,
    gate,
    themes: strArr(raw['themes'], BUILTIN_DESIGN_CONFIG.themes),
    viewports: strArr(raw['viewports'], BUILTIN_DESIGN_CONFIG.viewports),
  };
}

function readDesignBlock(manifest: unknown): Record<string, unknown> | null {
  const raw = (manifest as { design?: unknown } | null | undefined)?.design;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
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
