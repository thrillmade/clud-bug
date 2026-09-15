// `clud-bug config` — the command SPEC 2.0 §1.6:260 requires: "**Every named
// setting MUST be settable by a command, and nobody should need to hand-edit
// the file.** A tool offers `<tool> config get <key>` and `<tool> config set
// <key> <value>`, refusing a value the setting cannot take and saying what it
// can." (clud-bug#271)
//
//   clud-bug config list [--json]
//   clud-bug config get <key> [--json]
//   clud-bug config set <key> <value>
//   clud-bug config unset <key>
//
// Exit codes — the contract a script reads:
//   0  done
//   1  the file could not be read or written, is not JSON this tool will
//      overwrite, or changed under the command (it is left exactly as it was)
//   2  no such setting (with a did-you-mean)
//   3  the setting cannot take that value (the message says what it can)
//   4  refused: not this caller's setting to write (§1.6:262 / §4.8)
//
// Identical in a terminal and in a workflow — §1.6:260's "its non-interactive
// form MUST be scriptable" — so nothing here reads a TTY, `CI`, or any
// agent-harness marker. A refusal that keyed on one of those would be both
// spoofable and a different command under CI, which is the same thing twice.
//
// What the §1.6:262 refusal actually buys is `HONEST_GUARANTEE`, printed with
// it: it stops a tool that asks, and nothing else.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { detectTestSuite } from '../core/detect.js';
import {
  CONFIG_KEYS,
  CONFIG_KEY_NAMES,
  HONEST_GUARANTEE,
  NAMED_CONFIG_KEYS,
  getAt,
  guardWrite,
  parseValueArg,
  resolveKey,
  setAt,
  specLabel,
  unsetAt,
  validateValue,
  type ConfigKeyDef,
} from '../core/config-schema.js';
import { MANIFEST_FILE, withManifestLock, writeManifestBytes } from './skills.js';

interface ConfigArgs {
  _: string[];
  json?: boolean;
  cwd?: string;
}

/** Exit codes, named so the call sites read as the contract above. */
const EXIT_IO = 1;
const EXIT_UNKNOWN_KEY = 2;
const EXIT_BAD_VALUE = 3;
const EXIT_REFUSED = 4;

class ConfigError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

export async function runConfig(args: ConfigArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const [, subcommand, key, ...rest] = args._;
  try {
    switch (subcommand) {
      case undefined:
      case 'list':
        await listSettings(cwd, Boolean(args.json));
        return;
      case 'get':
        await getSetting(cwd, key, Boolean(args.json));
        return;
      case 'set':
        await setSetting(cwd, key, rest);
        return;
      case 'unset':
        await unsetSetting(cwd, key);
        return;
      default:
        throw new ConfigError(
          `clud-bug config: no such subcommand "${subcommand}". ` +
          'Try: config list | config get <key> | config set <key> <value> | config unset <key>.',
          EXIT_UNKNOWN_KEY,
        );
    }
  } catch (err) {
    const code = err instanceof ConfigError ? err.code : EXIT_IO;
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(code);
  }
}

function skillsDir(cwd: string): string {
  return join(cwd, '.claude', 'skills');
}

function manifestPath(cwd: string): string {
  return join(skillsDir(cwd), MANIFEST_FILE);
}

/** The manifest, with the exact bytes it was parsed from — `null` for no file. */
interface ManifestRead {
  manifest: Record<string, unknown>;
  bytes: string | null;
}

/** The manifest's bytes, or `null` where there is no file yet. */
async function readManifestBytes(cwd: string): Promise<string | null> {
  const path = manifestPath(cwd);
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    // ENOENT is the only failure that means "no file yet" — that is how a
    // first install looks. Anything else (EACCES, EIO, a path that is not a
    // file) is a file we cannot see, and treating it as absent would write a
    // fresh manifest over the one that is there.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigError(
        `clud-bug config: ${path} could not be read (${(err as Error).message}). ` +
        'Nothing was written — fix the file, then run this again.',
        EXIT_IO,
      );
    }
    return null;
  }
}

/**
 * Read the manifest for a config operation. STRICT on purpose, unlike every
 * review-side reader (§1.6:243 makes tolerance the readers' rule): this is the
 * surface a person uses to inspect and change the file, so reporting defaults
 * over a file we could not parse would hide the very typo they came to find —
 * and writing on top of it would delete the whole configuration.
 *
 * Hands back the bytes as well as the object: a write is only safe against the
 * bytes it was computed from, and the object cannot say what those were.
 */
async function readManifestFile(cwd: string): Promise<ManifestRead> {
  const path = manifestPath(cwd);
  const bytes = await readManifestBytes(cwd);
  if (bytes === null) return { manifest: {}, bytes };
  try {
    const parsed: unknown = JSON.parse(bytes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the top level is not an object');
    }
    return { manifest: parsed as Record<string, unknown>, bytes };
  } catch (err) {
    throw new ConfigError(
      `clud-bug config: ${path} is not valid JSON (${(err as Error).message}). ` +
      'Nothing was written — fix the file, then run this again.',
      EXIT_IO,
    );
  }
}

/**
 * Write the manifest back, but only over the bytes it was computed from.
 *
 * The lock serializes clud-bug's own `config set`/`config unset` against each
 * other and nothing else: `init`, `update`, `add`, `remove` and a person with
 * an editor all replace this file without taking it. Any of them landing
 * between the read above and this write means the one-key edit in hand was
 * computed from bytes that are gone, and writing it puts them back — dropping
 * whatever the other writer had just set, at exit 0. Comparing first is what
 * makes that a refusal instead.
 *
 * The compare narrows the window to the gap between it and the rename; it
 * does not close it. Nothing a single process can do closes it, and a
 * refusal a person can act on is the honest half of the guarantee.
 *
 * Deliberately NOT `writeManifest`, which normalizes `version` and
 * `installed` — this command edits one setting and leaves every other byte
 * the way it found it (§1.6:243), including the two that reader would have
 * filled in.
 */
async function writeManifestFile(
  cwd: string,
  manifest: Record<string, unknown>,
  expected: string | null,
): Promise<void> {
  if (await readManifestBytes(cwd) !== expected) {
    throw new ConfigError(
      `clud-bug config: ${manifestPath(cwd)} changed while this command was running. ` +
      'Nothing was written — run it again.',
      EXIT_IO,
    );
  }
  await writeManifestBytes(skillsDir(cwd), manifest);
}

interface ResolvedSetting {
  key: string;
  value: unknown;
  /** Where the value came from: the file, or §1.6:243's documented default. */
  source: 'file' | 'default';
  owner: ConfigKeyDef['owner'];
  /** The governing section, or `null` where SPEC 2.0 names no such mechanism. */
  spec: string | null;
  summary: string;
}

function resolveSetting(manifest: Record<string, unknown>, key: string): ResolvedSetting {
  const def = CONFIG_KEYS[key] as ConfigKeyDef;
  const onDisk = getAt(manifest, def.path);
  return {
    key,
    value: onDisk === undefined ? def.default : onDisk,
    source: onDisk === undefined ? 'default' : 'file',
    owner: def.owner,
    spec: def.spec,
    summary: def.summary,
  };
}

async function listSettings(cwd: string, json: boolean): Promise<void> {
  const { manifest } = await readManifestFile(cwd);
  const settings = NAMED_CONFIG_KEYS.map((key) => resolveSetting(manifest, key));
  if (json) {
    process.stdout.write(`${JSON.stringify({ file: manifestPath(cwd), settings }, null, 2)}\n`);
    return;
  }
  const width = Math.max(...settings.map((s) => s.key.length));
  const lines = [`${manifestPath(cwd)}`, ''];
  for (const setting of settings) {
    const marker = setting.owner === 'human' ? '  (humans only)' : '';
    lines.push(`  ${setting.key.padEnd(width)}  ${JSON.stringify(setting.value)}${
      setting.source === 'default' ? '  [default]' : ''
    }${marker}`);
    lines.push(`  ${' '.repeat(width)}  ${setting.summary} ${
      specLabel(CONFIG_KEYS[setting.key] as ConfigKeyDef)
    }`);
  }
  lines.push('');
  lines.push('  clud-bug config set <key> <value>   ·   clud-bug config unset <key>');
  lines.push(`  A setting marked (humans only) is refused: ${HONEST_GUARANTEE}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function requireKey(raw: string | undefined): string {
  if (!raw) {
    throw new ConfigError(
      'clud-bug config: which setting? Run `clud-bug config list` to see them all.',
      EXIT_UNKNOWN_KEY,
    );
  }
  const resolved = resolveKey(raw);
  if (resolved.ok) return resolved.name;
  throw new ConfigError(
    `clud-bug config: "${raw}" is not a clud-bug setting` +
    (resolved.suggestion ? ` — did you mean ${resolved.suggestion}?` : '.') +
    '\nRun `clud-bug config list` to see every setting this repository has.',
    EXIT_UNKNOWN_KEY,
  );
}

async function getSetting(cwd: string, rawKey: string | undefined, json: boolean): Promise<void> {
  const key = requireKey(rawKey);
  const { manifest } = await readManifestFile(cwd);
  const setting = resolveSetting(manifest, key);
  if (json) {
    const { summary: _summary, ...payload } = setting;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(setting.value)}\n`);
}

async function setSetting(cwd: string, rawKey: string | undefined, rest: string[]): Promise<void> {
  const key = requireKey(rawKey);
  const def = CONFIG_KEYS[key] as ConfigKeyDef;
  // `config set` takes no flags of its own — every remaining token is the
  // value, joined so a shell-unquoted multi-word value (`config set tests npm
  // test`) still reads as one. An unquoted `--something` among them is never
  // part of that value; it is a flag nobody defined, and folding it into the
  // string silently writes whatever followed it too — see #271 ruling 5.
  const flag = rest.find((token) => token.startsWith('--'));
  if (flag !== undefined) {
    throw new ConfigError(
      `clud-bug config: unknown flag "${flag}" for config set. ` +
      'config set takes no flags — quote the value if it needs to contain "--".',
      EXIT_UNKNOWN_KEY,
    );
  }
  const rawValue = rest.join(' ');
  if (rawValue === '') {
    throw new ConfigError(
      `clud-bug config: ${key} needs a value. It takes: ${def.domain}.`,
      EXIT_BAD_VALUE,
    );
  }
  const parsed = parseValueArg(rawValue);
  const validated = validateValue(key, parsed);
  if (!validated.ok) throw new ConfigError(`clud-bug config: ${validated.message}`, EXIT_BAD_VALUE);

  // Before the lock: this one asks the repository, not the manifest, so it
  // has no reason to wait behind somebody else's write.
  await assertHonestTestsDeclaration(cwd, key, validated.value);

  // The read, the guard and the write are one step. Apart, two concurrent
  // `config set`s each wrote their own edit over the same bytes, and whatever
  // the other one had set was gone.
  await withManifestLock(skillsDir(cwd), async () => {
    // Read BEFORE the guard: refusing an ancestor write needs to know what the
    // file holds today, and a malformed file must stop the whole operation.
    const { manifest, bytes } = await readManifestFile(cwd);
    const guard = guardWrite({ key, nextValue: validated.value, manifest, writer: 'command' });
    if (!guard.ok) throw new ConfigError(guard.message, EXIT_REFUSED);
    await writeManifestFile(cwd, setAt(manifest, def.path, validated.value), bytes);
  });
  process.stdout.write(`${key} = ${JSON.stringify(validated.value)}\n`);
}

async function unsetSetting(cwd: string, rawKey: string | undefined): Promise<void> {
  const key = requireKey(rawKey);
  const def = CONFIG_KEYS[key] as ConfigKeyDef;
  await withManifestLock(skillsDir(cwd), async () => {
    const { manifest, bytes } = await readManifestFile(cwd);
    // No `nextValue`: a removal is a write. §1.6:243 makes an absent key
    // resolve to its default, so unsetting a gate setting is the same
    // weakening as writing the weaker value.
    const guard = guardWrite({ key, manifest, writer: 'command' });
    if (!guard.ok) throw new ConfigError(guard.message, EXIT_REFUSED);
    await writeManifestFile(cwd, unsetAt(manifest, def.path), bytes);
  });
  process.stdout.write(`${key} unset — it now resolves to ${JSON.stringify(def.default)}\n`);
}

/**
 * §6.7: "Detection is what makes `none` honest: it cannot be pasted into a
 * repository the detector can see has tests." A dishonest `none` is a value
 * the setting cannot take, so it refuses on the value (exit 3), not on who is
 * asking.
 *
 * Takes the VALIDATED value, never the raw argument: the schema trims `tests`
 * (both readers do), so `none ` reaches here as `none` and is refused like any
 * other spelling of it.
 *
 * `detectTestSuite` is both of the signals the pre-push hook itself uses, not
 * the `package.json` one alone: a repository the hook can see has tests and
 * this command cannot is a `"none"` accepted here and blocked on the next
 * push. It reads the working tree rather than the base ref, which is the
 * difference between the two — at the moment someone TYPES the declaration,
 * the tree in front of them is the repository.
 */
async function assertHonestTestsDeclaration(
  cwd: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (key !== 'tests' || value !== 'none') return;
  const suite = await detectTestSuite(cwd);
  if (!suite) return;
  const saw = suite.signal === 'package-script'
    ? `this repository declares a test script (${JSON.stringify(suite.evidence)})`
    : `this repository has tests (${suite.evidence})`;
  const fix = suite.command
    ? `clud-bug config set tests ${JSON.stringify(suite.command)}`
    : 'clud-bug config set tests "<the command that runs them>"';
  throw new ConfigError(
    `clud-bug config: refusing "tests": "none" — ${saw}, and SPEC §6.7 blocks a push whose ` +
    `declaration contradicts the repository. Run: ${fix}`,
    EXIT_BAD_VALUE,
  );
}

/** The `config` block of `--help`, generated from the schema so it cannot drift. */
export function renderConfigHelp(): string {
  const width = Math.max(...CONFIG_KEY_NAMES.map((k) => k.length));
  const rows = NAMED_CONFIG_KEYS.map((key) => {
    const def = CONFIG_KEYS[key] as ConfigKeyDef;
    const marker = def.owner === 'human' ? ' (humans only)' : '';
    return `    ${key.padEnd(width)}  ${def.summary}${marker}`;
  });
  return rows.join('\n');
}
