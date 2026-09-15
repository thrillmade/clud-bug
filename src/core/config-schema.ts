// The configuration schema — one owner for what a setting is called, where it
// lives on disk, what it may hold, and who may write it (clud-bug#271,
// SPEC 2.0 §1.6).
//
// SPEC §1.6:260: "**Every named setting MUST be settable by a command, and
// nobody should need to hand-edit the file.** A tool offers `<tool> config get
// <key>` and `<tool> config set <key> <value>`, refusing a value the setting
// cannot take and saying what it can."
//
// Two vocabularies meet here and the mapping lives in exactly one place:
//
//   - the SPEC's names (`review.strict_mode`), which are what a person types
//     and what §1.6's table, §4.7 and §4.8 point at. §1.6:258: "Keys are
//     `snake_case`, and a dot means a nested object rather than a literal
//     dotted name";
//   - the on-disk keys in `.claude/skills/.clud-bug.json` (`strictMode`),
//     which are camelCase because they already are — the file lives in
//     customer repositories the deployed App reads at runtime, so renaming it
//     is a dual-read deprecation, not an edit.
//
// `owner` is the §1.6:262 rule made data rather than a rule twelve call sites
// remember: "A setting that decides whether something blocks is a person's to
// change. `review.strict_mode`, `git.enforce_commits` and `review.auto_fix`
// MUST NOT be written by an agent — not through the command, not by editing
// the file. A tool asked to weaken one of these by an agent MUST refuse and
// say why." `guardWrite` is the single primitive every write of a SETTING
// routes through — `clud-bug config`'s as `writer: 'command'`, `init`'s own
// `stampSetting` as `writer: 'setup'`, which is what the two may do
// differently and all of it. The tool's own bookkeeping (`installed`,
// `lastUpdate`) is still stamped directly by add/remove/update — the one
// class of key `guardWrite` waves through for `writer: 'setup'` anyway. What
// the refusal does and does not buy is `HONEST_GUARANTEE`.
//
// Pure: no I/O, no process state. `src/cli/config.ts` owns the file and the
// exit codes.

import { z } from 'zod';

import { DEFAULT_AUTO_RESOLVE_CONFIG } from './auto-resolve.js';
import { BUILTIN_DESIGN_CONFIG } from './design.js';
import { BUILTIN_DEFAULT as BUILTIN_REVIEW_PASSES } from './review-plan.js';
import { MAX_REVIEW_CONTEXT_BYTES } from './review-context.js';

/**
 * Who may write a setting.
 *
 * - `human` — it decides whether something blocks (§1.6:262, §4.8). The
 *   command refuses, whoever is asking.
 * - `agent` — anyone may set it. §1.6:264: "Every other setting an agent MAY
 *   write through the command, because setup and registering a skill it just
 *   wrote are legitimate work and blocking them helps nobody."
 * - `tool` — clud-bug's own bookkeeping, unnamed by §1.6:247 ("Operator tuning
 *   knobs … stay the tool's own business"). Described here so the manifest has
 *   no key this module cannot account for, but not offered as a setting.
 */
export type ConfigOwner = 'human' | 'agent' | 'tool';

/**
 * Which write path is asking. Not who is at the keyboard — §1.6:260 makes the
 * command the same in a terminal and in a workflow, and nothing here reads an
 * agent marker.
 *
 * - `command` — `clud-bug config`. Settings only, and only the ones an agent
 *   may write.
 * - `setup` — `clud-bug init`/`update` stamping the file they create. May
 *   maintain the tool's own state (§1.6:247 leaves that to init/update), and
 *   may CREATE a human-owned setting only at the `setupDefault` the schema
 *   declares for it.
 */
export type ConfigWriter = 'command' | 'setup';

export interface ConfigKeyDef {
  /** Where the value lives in `.clud-bug.json`. A dot in the key name is one level here. */
  path: readonly string[];
  /** The value domain. `set` refuses anything this rejects. */
  schema: z.ZodType;
  /** What an absent key resolves to (§1.6:243). `null` where absence is itself the state. */
  default: unknown;
  owner: ConfigOwner;
  /**
   * For a `human`-owned setting, the one value `clud-bug init` may CREATE it
   * with, and only while the key is absent. Absent here means setup may not
   * write the key at all — which is every human-owned key but one.
   */
  setupDefault?: unknown;
  /**
   * The section that governs the behaviour this changes (§1.6:245), or `null`
   * where SPEC 2.0 describes no such mechanism. Printed wherever the setting
   * is: a section number a reader can open and find nothing about the setting
   * is worse than saying there is none.
   */
  spec: string | null;
  /** One line, in the docs table and in `config list`. */
  summary: string;
  /** What the setting can take, said in words — §1.6:260's "saying what it can". */
  domain: string;
}

/**
 * The sentence every surface that mentions the refusal must carry, so the
 * claim has one owner and cannot drift into an enforcement promise nobody can
 * keep. SPEC §1.6:266: "Two things make this hold even when the rule is
 * broken."
 */
export const HONEST_GUARANTEE =
  'This refusal only stops a tool that asks. Nothing stops an agent that writes the file ' +
  'directly — no local check can. What holds instead is the pair SPEC §1.6 names: a gate ' +
  "reads its settings from the pull request's base ref (§6.3), so an edit inside a pull " +
  'request has no effect on the gate judging it, and the edit is a hunk in a diff a review ' +
  'reads like any other.';

/** What every surface prints in place of a citation for a `spec: null` key. */
export const NOT_IN_SPEC = 'clud-bug-specific — SPEC 2.0 does not name it';

/** The citation, or the honest stand-in. One owner, so no surface invents its own. */
export function specLabel(def: ConfigKeyDef): string {
  return def.spec ?? NOT_IN_SPEC;
}

export const CONFIG_KEYS: Readonly<Record<string, ConfigKeyDef>> = {
  // ---- §1.6's table, in its order ----------------------------------------
  'review.strict_mode': {
    path: ['strictMode'],
    schema: z.boolean(),
    default: false,
    owner: 'human',
    // The one write `init` may make to a gate setting: §1.6:262 forbids an
    // agent WEAKENING one, and creating it at `true` on a manifest that has no
    // value is the opposite. Any other value, and any write over a value a
    // person already chose, is refused exactly as the command's is.
    setupDefault: true,
    // §1.6's own table cites §6.2 for this row — "whether a critical finding
    // blocks the merge" is §6.2's rule ("Blocking is the default for the
    // review check"), and §1.6 only says who may set it. Citing §1.6 here
    // would send a reader back to the section they are already reading.
    spec: '§6.2',
    summary: 'Whether a critical finding blocks the merge, or only advises.',
    domain: 'true or false',
  },
  'review.ci_checks': {
    path: ['ciChecks'],
    schema: z.array(z.string().min(1)),
    // §4.7: "Absent means every check." Not the empty list, which is the
    // deliberate opt-out — so absence and `[]` are different states and the
    // default cannot be written down as a value.
    default: null,
    owner: 'agent',
    spec: '§4.7',
    summary: 'Narrows which CI checks a review reads as evidence; absent means every check.',
    domain: 'a JSON array of check names, e.g. ["build","typecheck"] — [] reads none',
  },
  'review.trigger': {
    path: ['reviewTrigger'],
    schema: z.enum(['commit', 'push', 'both']),
    default: 'push',
    owner: 'agent',
    spec: '§4.1',
    summary: 'Whether the local review runs after a commit or before a push.',
    domain: 'commit, push, or both',
  },
  'review.auto_fix': {
    path: ['autoFix'],
    // Declared so the key is settable and refused to an agent (§1.6:260 /
    // :262 — this is one of the three keys §1.6:262 names outright), even
    // though no OSS code path reads it: pushing a fix to the head branch is
    // the hosted App's mechanism, under this same on-disk key. Shape and
    // default are the App's to define, not invented here — matching
    // `review.cost_cap_usd` below, this schema declares the key and stops,
    // rather than fabricating a round-cap field name it has no authority to
    // set. See the `review.auto_resolve` entry above for what §4.3 requires
    // of the OTHER thing §4.6 used to be conflated with here.
    schema: z.looseObject({}),
    default: {},
    owner: 'human',
    // §1.6's own table names this exact key humans-only ("`review.auto_fix`
    // … MUST NOT be written by an agent", §1.6:262) and cites §4.6 for what
    // it governs: "whether a reviewer may push a fix, and how many rounds."
    spec: '§4.6',
    summary:
      'Whether a reviewer may push a fix, and how many rounds. Read by the hosted App; the CLI ' +
      'does not push fixes.',
    domain: 'a JSON object — shape and default are the hosted App’s; the OSS CLI does not read it',
  },
  'review.passes': {
    path: ['reviewPasses'],
    schema: z.looseObject({}),
    default: BUILTIN_REVIEW_PASSES,
    owner: 'agent',
    spec: '§2.2',
    summary: 'Which passes run, how skills group within them, and the model each uses.',
    domain: 'a JSON object — {"count":2,"mode":"cross-check"} or {"default":…,"perSkill":…}',
  },
  'review.passes.blocking': {
    path: ['reviewPasses', 'blocking'],
    schema: z.array(z.string().min(1)),
    default: [],
    owner: 'human',
    spec: '§4.8',
    summary: 'Which passes turn the check red.',
    domain: 'a JSON array of pass names, e.g. ["design"]',
  },
  tests: {
    path: ['tests'],
    // Trimmed on the way IN, because both readers trim on the way out
    // (`readTestsDeclaration`, and the pre-push hook's own parser). Without
    // it, `"none "` is a value the §6.7 honesty check does not recognise and
    // every reader resolves back to `none`.
    schema: z.string().trim().min(1),
    default: null,
    owner: 'agent',
    spec: '§6.7',
    summary: 'The command that runs this repository’s tests before a push, or "none".',
    domain: 'a shell command, or the literal "none"',
  },

  // ---- Settings §1.6 does not name, but a person types (§1.6:247) ---------
  'review.auto_resolve': {
    path: ['autoResolve'],
    schema: z.looseObject({
      mode: z.enum(['verified', 'off']).optional(),
      uncertain_critical_action: z.enum(['request_changes', 'leave_open']).optional(),
    }),
    default: DEFAULT_AUTO_RESOLVE_CONFIG,
    owner: 'agent',
    // NOT the §4.6 setting §1.6's table names — that is `review.auto_fix`
    // above, and citing §4.6 here (as this key used to) claimed the whole of
    // §4.6 for a schema that only ever implemented the OTHER thing a
    // fix-push does: §4.3 governs it instead — "Where the reviewer opens an
    // inline thread, it MUST resolve the thread only when the flagged issue
    // is verifiably fixed … A verifier MUST resolve to *cannot tell* on any
    // failure rather than guessing, and a thread in that state MUST NOT be
    // resolved." `mode` and `uncertain_critical_action` are exactly that
    // decision, never whether a change may merge — which is why §1.6:262's
    // humans-only list does not name this key.
    spec: '§4.3',
    summary: 'Whether the reviewer resolves a thread it verified fixed, keeps it open, or escalates.',
    domain: '{"mode":"verified"|"off","uncertain_critical_action":"request_changes"|"leave_open"}',
  },
  // SPEC.md:825 (§4.1) spells this one without a dot — "the trusted half of
  // that model is `review_context` in the repository's configuration" — and
  // §1.6:258 makes a dot mean a nested object, so the dotted form would name
  // something else. The on-disk key stays `reviewContext`.
  review_context: {
    path: ['reviewContext'],
    // Bounded the same way `readReviewContext` bounds it on the way out
    // (`review-context.ts`'s own `MAX_REVIEW_CONTEXT_BYTES`) — a byte cap,
    // not a character cap, because the cost this bounds is prompt bytes.
    // Without this, `set` would happily write what the reader silently
    // truncates, so `get`/`list` would show a value nobody actually reviews
    // with in full.
    schema: z.union([
      z.string().refine(
        (s) => Buffer.byteLength(s, 'utf8') <= MAX_REVIEW_CONTEXT_BYTES,
        `exceeds the ${MAX_REVIEW_CONTEXT_BYTES}-byte review_context cap`,
      ),
      z.looseObject({
        instructions: z.string().refine(
          (s) => Buffer.byteLength(s, 'utf8') <= MAX_REVIEW_CONTEXT_BYTES,
          `exceeds the ${MAX_REVIEW_CONTEXT_BYTES}-byte review_context cap`,
        ),
      }),
    ]),
    default: '',
    owner: 'agent',
    spec: '§4.1',
    summary: 'Trusted standing instructions that focus every review.',
    domain: 'a string, or {"instructions":"…"} — capped at 4096 bytes',
  },
  'review.cost_cap_usd': {
    path: ['perPrCapUsd'],
    schema: z.number().positive(),
    // §4.9: "configurable per install and defaulting to unset — no ceiling
    // until someone chooses one, because a default cap silently truncates
    // reviews nobody asked to truncate."
    //
    // NOT ENFORCED YET: `budget-plan.ts` takes the ceiling as an input and
    // `planReview` forwards it, but no surface reads it off the manifest — the
    // only planReview call site (`cli/review-prompt.ts`) omits it. The key is
    // named here so the value has one spelling and one validator when §4.9's
    // ceiling is built; until then the summary says so rather than implying a
    // cap that never fires.
    default: null,
    owner: 'agent',
    spec: '§4.9',
    summary: 'Cumulative USD ceiling per pull request. Unset means no ceiling; not enforced yet.',
    domain: 'a positive number of US dollars, e.g. 5',
  },
  'review.strict_skills': {
    path: ['strictSkills'],
    schema: z.array(z.string().min(1)),
    default: [],
    owner: 'human',
    // §6.2 names four canonical checks and their outcomes; a per-skill check
    // is not among them and appears nowhere else in SPEC 2.0. It is still
    // humans-only — that comes from §1.6:262, which the refusal quotes.
    spec: null,
    summary: 'Skills that get their own required check-run; a critical there blocks.',
    domain: 'a JSON array of skill slugs',
  },
  'review.notary': {
    path: ['notary'],
    schema: z.boolean(),
    default: true,
    owner: 'agent',
    spec: '§4.5',
    summary: 'Whether a local review certifies through the notary, or self-attests.',
    domain: 'true or false',
  },
  'design.enabled': {
    path: ['design', 'enabled'],
    schema: z.boolean(),
    default: BUILTIN_DESIGN_CONFIG.enabled,
    owner: 'agent',
    spec: '§4.8',
    summary: 'Whether the visual design pass runs at all.',
    domain: 'true or false',
  },
  'design.gate': {
    path: ['design', 'gate'],
    schema: z.enum(['advisory', 'strict']),
    default: BUILTIN_DESIGN_CONFIG.gate,
    owner: 'human',
    spec: '§4.8',
    summary: 'Whether a design critical blocks the merge.',
    domain: 'advisory or strict',
  },
  'design.themes': {
    path: ['design', 'themes'],
    schema: z.array(z.string().min(1)),
    default: BUILTIN_DESIGN_CONFIG.themes,
    owner: 'agent',
    spec: '§4.8',
    summary: 'Themes the design pass renders.',
    domain: 'a JSON array, e.g. ["light","dark"]',
  },
  'design.viewports': {
    path: ['design', 'viewports'],
    schema: z.array(z.string().min(1)),
    default: BUILTIN_DESIGN_CONFIG.viewports,
    owner: 'agent',
    spec: '§4.8',
    summary: 'Viewports the design pass renders.',
    domain: 'a JSON array, e.g. ["desktop","mobile"]',
  },
  pin_version: {
    path: ['pinVersion'],
    schema: z.string().min(1),
    default: null,
    owner: 'agent',
    // Neither this nor the weekly self-update PR exists in SPEC 2.0 (§7.1 is
    // the SPEC document's own version header). A clud-bug mechanism.
    spec: null,
    summary: 'Pin clud-bug to one version and stop the weekly self-update PRs.',
    domain: 'a semver string, e.g. "0.7.0"',
  },
  excluded_baselines: {
    path: ['excludedBaselines'],
    schema: z.array(z.string().min(1)),
    default: [],
    owner: 'agent',
    // §5.1 is the catalog/placement-map subscription; a repository opting out
    // of a baseline skill is clud-bug's own, unnamed by SPEC 2.0.
    spec: null,
    summary: 'Baseline skills this repository has removed and does not want back.',
    domain: 'a JSON array of skill slugs',
  },

  // ---- The tool's own state (§1.6:247) -----------------------------------
  version: {
    path: ['version'],
    schema: z.number().int().positive(),
    default: 1,
    owner: 'tool',
    spec: '§1.6',
    summary: 'Manifest format version. Written by init/update.',
    domain: 'a positive integer',
  },
  installed: {
    path: ['installed'],
    schema: z.array(z.looseObject({})),
    default: [],
    owner: 'tool',
    spec: '§1.7',
    summary: 'The skills a review applies. Maintained by init/add/remove/refresh.',
    domain: 'an array of manifest entries',
  },
  last_update: {
    path: ['lastUpdate'],
    schema: z.string().min(1),
    default: null,
    owner: 'tool',
    spec: '§1.6',
    summary: 'When init/update last stamped this manifest.',
    domain: 'an ISO-8601 timestamp',
  },
  last_update_version: {
    path: ['lastUpdateVersion'],
    schema: z.string().min(1),
    default: null,
    owner: 'tool',
    spec: '§1.6',
    summary: 'The clud-bug version that last stamped this manifest.',
    domain: 'a semver string',
  },
  usage: {
    path: ['usage'],
    schema: z.looseObject({}),
    default: {},
    owner: 'tool',
    spec: '§1.6',
    summary: 'Per-skill usage counters. §1.6:245 — a counter never decrements.',
    domain: 'an object of per-skill counters',
  },
};

/** Every key, in declaration order — the order `config list` and the docs use. */
export const CONFIG_KEY_NAMES: readonly string[] = Object.keys(CONFIG_KEYS);

/** The keys a person is offered: §1.6:247's "settings a person edits are named here". */
export const NAMED_CONFIG_KEYS: readonly string[] = CONFIG_KEY_NAMES.filter(
  (name) => (CONFIG_KEYS[name] as ConfigKeyDef).owner !== 'tool',
);

export type ResolveKeyResult =
  | { ok: true; name: string; def: ConfigKeyDef }
  | { ok: false; name: string; suggestion?: string };

/**
 * Look a key up by its SPEC name. On a miss, offers the closest key within an
 * edit distance of three — the difference between a typo and a key this tool
 * has never heard of.
 *
 * NOTE this is `set`-side strictness only. §1.6:243 still binds every READER:
 * "An unrecognised key MUST NOT cause a failure, and any tool that rewrites
 * the file MUST round-trip that key unchanged."
 */
export function resolveKey(name: string): ResolveKeyResult {
  const trimmed = name.trim();
  const def = Object.prototype.hasOwnProperty.call(CONFIG_KEYS, trimmed)
    ? CONFIG_KEYS[trimmed]
    : undefined;
  if (def) return { ok: true, name: trimmed, def };

  let best: { name: string; distance: number } | undefined;
  for (const candidate of CONFIG_KEY_NAMES) {
    const distance = editDistance(trimmed.toLowerCase(), candidate.toLowerCase());
    if (distance <= 3 && (!best || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best ? { ok: false, name: trimmed, suggestion: best.name } : { ok: false, name: trimmed };
}

/** What the setting can take, in words. */
export function describeDomain(name: string): string {
  return CONFIG_KEYS[name]?.domain ?? '';
}

export type ValidateResult = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * §1.6:260 — "refusing a value the setting cannot take and saying what it
 * can". The message always names both the key and its domain, because a
 * refusal that does not say what would have worked sends the reader back to
 * the schema this command exists to replace.
 */
export function validateValue(name: string, value: unknown): ValidateResult {
  const def = CONFIG_KEYS[name];
  if (!def) return { ok: false, message: `${name} is not a clud-bug setting.` };
  const parsed = def.schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    message: `${name} cannot take ${JSON.stringify(value)}. It takes: ${def.domain}.`,
  };
}

/**
 * Read one CLI argument as a value. JSON when it parses as JSON, the literal
 * string otherwise — so `set tests "npm test"` and `set review.ci_checks
 * '["build"]'` both read the way the person who typed them expects, with no
 * quoting rule to remember for the common case.
 */
export function parseValueArg(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return raw;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

/** Read a nested path. Undefined anywhere along it reads as undefined. */
export function getAt(obj: unknown, path: readonly string[]): unknown {
  let cursor: unknown = obj;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Write a nested path, returning a new object. Every level is copied by
 * spread, which preserves both the values and the key ORDER of everything it
 * did not touch — §1.6:243's round-trip obligation is a byte-level one once
 * the result goes through `JSON.stringify(…, null, 2)`.
 */
export function setAt<T extends Record<string, unknown>>(
  obj: T,
  path: readonly string[],
  value: unknown,
): T {
  const [head, ...rest] = path;
  if (head === undefined) return obj;
  if (rest.length === 0) return { ...obj, [head]: value };
  const child = obj[head];
  const childObj = child && typeof child === 'object' && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : {};
  return { ...obj, [head]: setAt(childObj, rest, value) };
}

/** Remove a nested path, returning a new object. Absent paths are a no-op. */
export function unsetAt<T extends Record<string, unknown>>(obj: T, path: readonly string[]): T {
  const [head, ...rest] = path;
  if (head === undefined || !(head in obj)) return obj;
  if (rest.length === 0) {
    const next = { ...obj };
    delete next[head];
    return next;
  }
  const child = obj[head];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return obj;
  return { ...obj, [head]: unsetAt(child as Record<string, unknown>, rest) };
}

export type GuardResult = { ok: true } | { ok: false; message: string };

/**
 * The one gate every write goes through — `config set`, `config unset`, and
 * `init`'s own stamping, which reaches it through `stampSetting` below.
 * `writer` is required rather than defaulted so a new write path has to say
 * which it is: a call site that forgets gets a type error, not the permissive
 * half.
 *
 * Omit `nextValue` to guard a removal. A removal is a write: §1.6:243 makes an
 * absent key resolve to its default, so unsetting `review.strict_mode` is
 * exactly the weakening §1.6:262 forbids — for either writer.
 *
 * The last case is the one a per-key check would miss: `set review.passes
 * {…}` REPLACES the object, so a value that merely omits `blocking` deletes a
 * human-owned setting without ever naming it. Writing an ancestor is allowed
 * only while every human-owned descendant comes through unchanged.
 */
export function guardWrite(input: {
  key: string;
  nextValue?: unknown;
  manifest: Record<string, unknown>;
  writer: ConfigWriter;
}): GuardResult {
  const { key, nextValue, manifest, writer } = input;
  const def = CONFIG_KEYS[key];
  if (!def) return { ok: true };

  if (def.owner === 'human' && !isSetupStamp(def, nextValue, manifest, writer)) {
    return { ok: false, message: humanOwnedRefusal(key, def) };
  }
  // §1.6:247 leaves the tool's own state to init/update — which is `setup`,
  // and is the reason this is not a setting the command offers at all.
  if (def.owner === 'tool' && writer !== 'setup') {
    return { ok: false, message: toolOwnedRefusal(key, def) };
  }

  for (const name of CONFIG_KEY_NAMES) {
    const other = CONFIG_KEYS[name] as ConfigKeyDef;
    if (other.owner !== 'human') continue;
    if (!isUnder(other.path, def.path)) continue;
    const rest = other.path.slice(def.path.length);
    const current = getAt(manifest, other.path);
    const next = nextValue === undefined ? undefined : getAt(nextValue, rest);
    if (stableStringify(current) !== stableStringify(next)) {
      return {
        ok: false,
        message:
          `clud-bug config: refusing to write ${key} — it would ` +
          `${next === undefined ? 'remove' : 'change'} ${name}, which is nested inside it.\n\n` +
          humanOwnedRefusal(name, other),
      };
    }
  }
  return { ok: true };
}

/**
 * The single exception §1.6:262 leaves room for: `init` CREATING a gate
 * setting at the stronger value the schema declares for it. Three conditions,
 * all of them checkable here rather than at the call site — it is setup
 * asking, the schema named a value for this key, and the file does not already
 * hold one. Anything else about the value is a weakening, whatever it is
 * named.
 */
function isSetupStamp(
  def: ConfigKeyDef,
  nextValue: unknown,
  manifest: Record<string, unknown>,
  writer: ConfigWriter,
): boolean {
  if (writer !== 'setup' || def.setupDefault === undefined) return false;
  if (getAt(manifest, def.path) !== undefined) return false;
  return stableStringify(nextValue) === stableStringify(def.setupDefault);
}

/** True when `path` sits strictly below `prefix`. */
function isUnder(path: readonly string[], prefix: readonly string[]): boolean {
  if (path.length <= prefix.length) return false;
  return prefix.every((segment, i) => path[i] === segment);
}

/**
 * The §1.6:262 refusal. Names the key, quotes the rule, gives the path a
 * person takes instead, and — because a tool that overstates its own
 * enforcement is worse than one that has none — ends with what this actually
 * buys.
 *
 * The quoted sentence is §1.6's (SPEC.md:262) whatever section governs the
 * setting, so that is what it is attributed to. The setting's own section is
 * named separately, or not at all where there is none — a citation a reader
 * can open and find nothing about the setting is a worse answer than silence.
 */
export function humanOwnedRefusal(key: string, def: ConfigKeyDef = CONFIG_KEYS[key]!): string {
  const onDisk = def.path.join('.');
  return [
    `clud-bug config: refusing to set ${key}.`,
    '',
    `It decides whether something blocks, and SPEC §1.6 keeps that a person's to change,`,
    'never an agent\'s: "A setting that decides whether something blocks is a person\'s to change.',
    '… MUST NOT be written by an agent — not through the command, not by editing the file."',
    ...(def.spec && def.spec !== '§1.6' ? [`SPEC ${def.spec} governs what this setting does.`] : []),
    '',
    `A person sets it by editing "${onDisk}" in .claude/skills/.clud-bug.json on the default`,
    'branch and committing that change.',
    '',
    HONEST_GUARANTEE,
  ].join('\n');
}

/**
 * `clud-bug init`'s one way to write a setting — the same validator and the
 * same `guardWrite` the command uses, so `init` and `clud-bug config` cannot
 * drift into two key spaces OR two owner rules.
 *
 * Throws rather than returning a result: a key or a value setup may not write
 * is a bug in the caller, not in the repository being set up, and the caller
 * has nothing useful to do with it except stop.
 */
export function stampSetting<T extends Record<string, unknown>>(
  manifest: T,
  key: string,
  value: unknown,
): T {
  const validated = validateValue(key, value);
  if (!validated.ok) throw new Error(`clud-bug init: ${validated.message}`);
  const guard = guardWrite({ key, nextValue: validated.value, manifest, writer: 'setup' });
  if (!guard.ok) throw new Error(`clud-bug init: ${guard.message}`);
  return setAt(manifest, (CONFIG_KEYS[key] as ConfigKeyDef).path, validated.value);
}

/** §1.6:247 — a tool's own state is not a setting, so there is nothing to offer. */
export function toolOwnedRefusal(key: string, def: ConfigKeyDef = CONFIG_KEYS[key]!): string {
  return (
    `clud-bug config: "${def.path.join('.')}" is clud-bug's own bookkeeping, not a setting — ` +
    `SPEC ${def.spec} names the settings a person edits and leaves a tool's own state unnamed. ` +
    'clud-bug init / update / add / remove maintain it.'
  );
}

/** Key-order-independent comparison, so a reordered object is not read as a change. */
function stableStringify(value: unknown): string {
  // The sentinel is a literal NUL, written as an escape so this file stays
  // text: `JSON.stringify` escapes a NUL inside a string rather than emitting
  // one, so no real value can produce this and be read as absent.
  if (value === undefined) return '\u0000undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Levenshtein, iterative two-row. Only ever run over the key list. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((row[j - 1] as number) + 1, (prev[j] as number) + 1, (prev[j - 1] as number) + cost);
    }
    prev = row;
  }
  return prev[b.length] as number;
}
