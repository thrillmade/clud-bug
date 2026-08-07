// The single source of truth for the SkDD SPEC version this tool implements.
//
// SPEC §7.3 ("What a tool declares"): "A tool states which version of this
// document it implements, and which areas of the loop it participates in, so a
// change to the contract can be routed to the tools it affects rather than
// announced to everyone."
//
// SPEC §4.3 ("What a review emits") requires the review comment to carry
//   <!-- spec-version: <version> -->
// and defines it as "the version of this document the producer implements".
//
// Before this module there were two disagreeing literals — `PROTOCOL_VERSION`
// ('0.1.0') in review-writeback and `NOTARY_PROTOCOL_VERSION` ('1.2.0') in
// notary-bundle — and neither matched the document. Both now derive from here,
// so "every place the version appears MUST agree" (§7.1) is structural rather
// than a thing someone has to remember. See clud-bug#277.

/**
 * The SPEC version this build implements.
 *
 * Bump in lockstep with `thrillmade/protocol` `SPEC.md` per §7.1's scheme:
 * major = a surface removed/renamed/narrowed/redefined, minor = additions
 * only, patch = editorial. §7.4 additionally requires that a major version
 * is not declared final until every first-party tool has released support,
 * so this constant moving is what "clud-bug supports it" means.
 */
export const SPEC_VERSION = '2.0.0';

/**
 * The areas of the loop clud-bug participates in, for the §7.3 declaration.
 *
 * The vocabulary is fixed by §7.3 — `orient`, `work`, `record`, `review`,
 * `propagate`, `gates`, `versioning` — and "a tool claims an area when it
 * implements any part of it". Ordered as the SPEC lists them so two tools'
 * declarations are comparable by eye.
 *
 * Why each is claimed (every one is code, not aspiration):
 *
 *   orient     §1.1 — `src/cli/agents-md.ts` owns a clud-bug section inside
 *                     AGENTS.md / CLAUDE.md.
 *              §1.6 — reads `.claude/skills/.clud-bug.json`.
 *              §1.7 — discovers `.claude/skills/<name>/SKILL.md` and honours
 *                     `installed[]` (`src/cli/skills.ts`, `src/core/skills.ts`).
 *   work       §2.7 — the quiet contract, `CLUD_BUG_QUIET=1` / `--quiet`.
 *              §2.8 — the truncation marker, `... (N bytes omitted)`
 *                     (`src/core/prompt-builder.ts`).
 *   review     §4    — the product: what a review examines, emits, and claims.
 *   propagate  §5.1 — pins skill copies from a catalog (`add <source/name>`).
 *              §5.2 — seeds the shipped baseline on `init` and stamps every
 *                     installed artifact with an owner+version marker.
 *   gates      §6.1 — `applyCanonicalRuleset` in `src/core/configure-github.ts`.
 *              §6.2 — posts the `clud-bug-review` check (`post-check-run`).
 *              §6.7 — the local gate, the commit/pre-push review hook.
 *
 * Deliberately NOT claimed:
 *
 *   record     §3 — clud-bug writes no decision record; that is logmind's.
 *                   It installs and coexists with logmind but installing a
 *                   tool is not implementing its area.
 *   versioning §7 — emitting this declaration is satisfying §7.3, not
 *                   implementing the area. §7.3's own worked example is
 *                   `logmind ... areas: orient, record, gates` — a tool that
 *                   by construction emits the declaration and still does not
 *                   claim `versioning`. If emitting it counted, every
 *                   conformant tool would claim the area and the word would
 *                   carry no routing information at all.
 *
 * §7.3 settles the close calls in favour of claiming: "Over-routing is a cheap
 * failure … Under-routing is silent, and silence is the failure mode this
 * document exists to prevent."
 */
export const SPEC_AREAS = [
  'orient',
  'work',
  'review',
  'propagate',
  'gates',
] as const;

/** The fixed §7.3 vocabulary, in the order the SPEC lists it. */
export const SPEC_AREA_VOCABULARY = [
  'orient',
  'work',
  'record',
  'review',
  'propagate',
  'gates',
  'versioning',
] as const;

export type SpecArea = (typeof SPEC_AREA_VOCABULARY)[number];

/**
 * Render the §7.3 two-line declaration.
 *
 * §7.3: "The first line's format is exactly `<tool-name> <tool-semver> (spec
 * <spec-semver>)`. A single trailing newline is REQUIRED." The second line
 * "names areas, not rules."
 *
 * Returns the full payload including that trailing newline, so a caller writes
 * it to stdout unmodified rather than re-deriving the line discipline.
 */
export function renderVersionDeclaration(input: {
  toolName: string;
  toolVersion: string;
  specVersion?: string;
  areas?: readonly string[];
}): string {
  const spec = input.specVersion ?? SPEC_VERSION;
  const areas = input.areas ?? SPEC_AREAS;
  return `${input.toolName} ${input.toolVersion} (spec ${spec})\nareas: ${areas.join(', ')}\n`;
}
