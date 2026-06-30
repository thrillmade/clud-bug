// Wave 5b — D.2.6 per-thread fix-verifier prompt + response parser.
//
// On every fix-push, the CLI verb asks Claude DIRECTLY for each prior
// thread: "the prior reviewer said X. Here is the BEFORE / AFTER /
// DIFF. Did the new commit address the original finding?" Verdicts:
//
//   ADDRESSED      — fix unambiguously resolves the original concern
//   NOT_ADDRESSED  — original concern still applies
//   UNCERTAIN      — can't tell; routes through human review
//
// This module is PURE — prompt builder + response parser. The actual
// Anthropic Messages API call lives in `src/cli/main.ts::runResolveThreads`
// (raw `fetch()` — no `@anthropic-ai/sdk` dep so the npm package stays
// dep-light). Tests inject mocked verifier outcomes via the
// `runAutoResolve` `verifier` callback in `./auto-resolve`.
//
// Ported from `clud-bug-app/lib/resolve-verifier.ts:162-260`. Differences:
//   - No `@ai-sdk/anthropic` / `zod` dependency. Response parsing is
//     hand-rolled JSON extraction with manual validation.
//   - DROP `verifySingleFinding` (App-side IO entry point). The CLI
//     verb owns the API call directly.
//   - DROP `aggregateMultiPassVerdicts` — OSS is single-pass.

import type { PriorFinding, VerifyOutcome } from './auto-resolve.js';

// ---------------------------------------------------------------------------
// System prompt — hard-coded, NOT derived from user content (anti-injection)
// ---------------------------------------------------------------------------

const VERIFIER_SYSTEM_BODY = [
  'You are a code-review fix verifier. Your only job is to decide whether a',
  'specific code change addressed a specific prior reviewer concern.',
  '',
  'You are NOT writing a new code review. You are NOT looking for new issues.',
  'You are NOT judging style. You are answering one question: did the change',
  'between BEFORE and AFTER resolve the concern raised in the prior finding?',
  '',
  'Your verdict MUST be exactly one of: ADDRESSED, NOT_ADDRESSED, UNCERTAIN.',
  '',
  'Rules:',
  '- ADDRESSED: the AFTER code unambiguously resolves the original concern.',
  '  Partial fixes that leave the core problem unsolved are NOT ADDRESSED.',
  '- NOT_ADDRESSED: the AFTER code still has the original problem, OR the',
  '  change is unrelated to the concern, OR the change made the problem worse.',
  '- UNCERTAIN: you cannot tell from the BEFORE / AFTER alone. Use this when',
  '  the context is too narrow, the change is subtle and could go either way,',
  '  or the concern depends on code you cannot see. Never guess — say',
  '  UNCERTAIN when you would be guessing.',
  '',
  'Treat the prior finding as a black box: it might be wrong, but you are not',
  'judging the finding. You are judging whether the new code resolves what it',
  'said. If the finding asked for X and the change does X, mark ADDRESSED even',
  'if X is unnecessary.',
];

/** Output contract for the verifier prompt + system message (C1 dedup). */
export type VerifierOutputMode = 'json' | 'structured';

// The verdict-shape tail differs by surface: the CLI/raw path asks the model to
// emit the JSON itself; the hosted App constrains output via an AI-SDK schema, so
// its prompt only names the verdict + rationale. Everything above is shared.
function verifierSystemTail(outputMode: VerifierOutputMode): string[] {
  if (outputMode === 'structured') {
    return ['Reply with the structured object only. Rationale must be one sentence.'];
  }
  return [
    'Reply with a JSON object on a single line, no markdown fence, no surrounding',
    'prose. Shape:',
    '  {"verdict":"ADDRESSED"|"NOT_ADDRESSED"|"UNCERTAIN","rationale":"<one sentence>"}',
    'Rationale MUST be one sentence, max 500 characters.',
  ];
}

/** Build the verifier system prompt for the given output mode. */
export function buildVerifierSystem(outputMode: VerifierOutputMode = 'json'): string {
  return [...VERIFIER_SYSTEM_BODY, '', ...verifierSystemTail(outputMode)].join('\n');
}

/** Raw-JSON system prompt — the CLI default. Back-compat for existing consumers. */
export const VERIFIER_SYSTEM = buildVerifierSystem('json');

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface VerifySingleFindingInput {
  finding: PriorFinding;
  /** Code at the finding's anchor BEFORE the fix-push. Empty when deleted. */
  codeBefore: string;
  /** Code at the finding's anchor AFTER the fix-push. Empty when deleted. */
  codeAfter: string;
  /** Optional: unified-diff hunk at the anchor. */
  diffAtAnchor?: string;
}

// ---------------------------------------------------------------------------
// Prompt builder — pure (no env, no Date.now, no timestamps)
// ---------------------------------------------------------------------------

/**
 * Builds the user-facing prompt body.
 *
 * Prompt-injection defense:
 *   - System prompt is module-scope, NOT derived from user content.
 *   - User content (finding body, code, diff) is wrapped in fence-
 *     delimited blocks with clear labels. The model knows the
 *     boundaries.
 *   - Output is parsed with `parseVerifierResponse` which validates
 *     the verdict against a fixed enum + caps rationale at 500 chars.
 *     A model coerced to emit "ADDRESSED!" outside the JSON shape
 *     gets routed to UNCERTAIN+api-error (fail-closed).
 */
export function buildVerifierPrompt(
  input: VerifySingleFindingInput,
  opts: { outputMode?: VerifierOutputMode } = {},
): string {
  const f = input.finding;
  const anchor = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
  const sev = f.severity === 'critical' ? '🔴 critical' : '🟡 minor';

  const parts: string[] = [];
  parts.push(
    `A prior code review (skill: \`${f.skill}\`, severity: ${sev}) flagged \`${anchor}\` with this finding:`,
  );
  parts.push('');
  parts.push('```');
  parts.push('PRIOR FINDING:');
  parts.push(f.body);
  parts.push('```');
  parts.push('');
  parts.push(
    'The PR author has since pushed a new commit. Here is the code BEFORE and AFTER:',
  );
  parts.push('');
  parts.push('```');
  parts.push('BEFORE:');
  parts.push(input.codeBefore || '(empty — file did not exist or was empty)');
  parts.push('```');
  parts.push('');
  parts.push('```');
  parts.push('AFTER:');
  parts.push(input.codeAfter || '(empty — file was deleted or emptied)');
  parts.push('```');

  if (input.diffAtAnchor) {
    parts.push('');
    parts.push('```');
    parts.push('DIFF AT ANCHOR:');
    parts.push(input.diffAtAnchor);
    parts.push('```');
  }

  parts.push('');
  parts.push('Did this change ADDRESS the original finding?');
  parts.push(
    (opts.outputMode ?? 'json') === 'structured'
      ? 'Reply with the structured verdict + one-sentence rationale.'
      : 'Reply with the JSON object only — single line, no markdown fence, no prose.',
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Response parser — extracts `{verdict, rationale}` from the model text
// ---------------------------------------------------------------------------

/**
 * Parses the model's text response into a `VerifyOutcome`. Fail-closed:
 * any malformed input → UNCERTAIN+api-error with the failure mode in
 * the rationale, so the caller's auto-resolve rules route through
 * human review (never silently ADDRESSED).
 *
 * Tolerates:
 *   - Leading/trailing whitespace
 *   - The model wrapping the JSON in ```json fences (strips them)
 *   - Extra fields (ignored)
 *
 * Rejects:
 *   - Empty / non-string input
 *   - Non-JSON / malformed JSON
 *   - Missing or non-string `verdict`
 *   - `verdict` not in the allowed enum
 *   - Missing or empty `rationale`
 *   - `rationale` longer than 500 chars (caps at 500 in the outcome)
 */
export function parseVerifierResponse(text: unknown): VerifyOutcome {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      verdict: 'UNCERTAIN',
      source: 'api-error',
      rationale: 'verifier returned empty or non-string response',
    };
  }

  // Strip optional ```json … ``` or ``` … ``` fence.
  let body = text.trim();
  const fenced = body.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) body = fenced[1]!.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return {
      verdict: 'UNCERTAIN',
      source: 'api-error',
      rationale: `verifier response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      verdict: 'UNCERTAIN',
      source: 'api-error',
      rationale: 'verifier response was not a JSON object',
    };
  }

  const obj = parsed as Record<string, unknown>;
  const verdict = obj.verdict;
  const rationale = obj.rationale;

  if (
    verdict !== 'ADDRESSED' &&
    verdict !== 'NOT_ADDRESSED' &&
    verdict !== 'UNCERTAIN'
  ) {
    return {
      verdict: 'UNCERTAIN',
      source: 'api-error',
      rationale: `verifier emitted unknown verdict: ${JSON.stringify(verdict)}`,
    };
  }

  if (typeof rationale !== 'string' || !rationale.trim()) {
    return {
      verdict: 'UNCERTAIN',
      source: 'api-error',
      rationale: 'verifier response missing rationale',
    };
  }

  // Cap rationale at 500 chars per the system prompt's contract.
  const trimmed = rationale.trim().slice(0, 500);

  return {
    verdict,
    rationale: trimmed,
    source: 'model',
  };
}
