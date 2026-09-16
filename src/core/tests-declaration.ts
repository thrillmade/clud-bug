// The §6.7 test declaration, resolved from the two files that can carry it
// (clud-bug#271).
//
// SPEC §1.6's table puts `tests` in `.logmind/config.yml`: "the command that
// runs this repository's tests, or `none` (§6.7)". clud-bug writes it into
// `.claude/skills/.clud-bug.json` instead (#319/#321), because §6.7's own
// ownership table has a row for a repository where clud-bug is the only tool
// installed — and there, the logmind file does not exist. Both are read, and
// the file the SPEC names wins wherever it says anything, so the two tools
// cannot disagree about whether a push may go out.
//
// Pure: the caller supplies the bytes. The pre-push hook reads them from the
// DEFAULT BRANCH, never the working tree (§6.7: "The declaration is read from
// the default branch, never the working tree" — §6.3 applied on the machine),
// and that read stays the caller's job.

export type TestsDeclarationSource = 'logmind' | 'clud-bug' | 'unset';

export interface TestsDeclaration {
  /** The declared command, the literal `none`, or `null` when neither file declares. */
  value: string | null;
  source: TestsDeclarationSource;
}

export interface ReadTestsDeclarationInput {
  /** The parsed `.claude/skills/.clud-bug.json`. */
  manifest?: unknown;
  /** The raw text of `.logmind/config.yml`, or null/undefined when absent. */
  logmindConfig?: string | null;
}

export function readTestsDeclaration(input: ReadTestsDeclarationInput): TestsDeclaration {
  const fromLogmind = parseLogmindTests(input.logmindConfig);
  if (fromLogmind !== null) return { value: fromLogmind, source: 'logmind' };

  const raw = (input.manifest as { tests?: unknown } | null | undefined)?.tests;
  if (typeof raw === 'string' && raw.trim()) return { value: raw.trim(), source: 'clud-bug' };

  return { value: null, source: 'unset' };
}

/**
 * The top-level `tests:` line pattern `parseLogmindTests` scans for — a plain
 * string, not a RegExp, exported so the pre-push hook's shell-embedded copy
 * (src/cli/hooks.ts, which cannot `import` this module) can share the
 * identical literal instead of hand-copying it, the same trick
 * `TEST_FILE_PATTERN` (src/core/detect.ts) already uses. Pinned equal by
 * test/config-parity.test.js.
 */
export const LOGMIND_TESTS_LINE_PATTERN = '^tests\\s*:(.*)$';

/**
 * Read a top-level `tests:` scalar out of `.logmind/config.yml`.
 *
 * Deliberately a line reader rather than a YAML parse: this runs in the same
 * no-network, no-dependency position as the pre-push hook's own shell, and one
 * scalar at the top level is the entire contract. Anything it cannot make
 * sense of reads as absent — §1.6:243 makes tolerance the reader's rule, and
 * the declaration being missing is a state §6.7 already has an answer for.
 */
export function parseLogmindTests(text: string | null | undefined): string | null {
  if (typeof text !== 'string' || !text) return null;
  const lineRe = new RegExp(LOGMIND_TESTS_LINE_PATTERN);
  for (const line of text.split(/\r?\n/)) {
    // Top level only: an indented `tests:` belongs to whatever block it is
    // under, and reading it would let an unrelated key declare the gate.
    const match = lineRe.exec(line);
    if (!match) continue;
    const value = stripComment((match[1] ?? '').trim());
    return value || null;
  }
  return null;
}

/** Unquote, and drop a `#` comment only where it is not inside the quotes. */
function stripComment(raw: string): string {
  const quoted = /^(['"])([\s\S]*?)\1\s*(?:#.*)?$/.exec(raw);
  if (quoted) return quoted[2] ?? '';
  const hash = raw.indexOf('#');
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}
