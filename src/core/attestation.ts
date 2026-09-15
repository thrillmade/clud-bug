// #266 — the READER half of the harness attestation (SPEC 2.0 §4.4).
//
// The writer is a pair of Claude Code hooks whose registration is committed to
// `.claude/settings.json` (`src/cli/hooks.ts`). They append rows to
// `<git-common-dir>/clud-bug-attest.jsonl` — never into the repository, because
// §4.4:963 rules that "A record named for the commit it describes cannot exist
// inside that commit". This module turns those rows into the field a bundle
// carries, and it is the one place that decides what counts as an attestation.
//
// THE JOIN IS THE RULE. Claude Code splits the six facts §4.4:957 requires
// across two events: `SubagentStop` knows an agent finished but not what model
// it ran on ("Only SessionStart hooks can receive a `model` field"), while
// `PostToolUse` on the Agent tool knows the resolved model but fires at
// DISPATCH, because subagents run in the background by default. A dispatch row
// alone therefore means a reviewer was launched, which §4.4:967 is explicit is
// not an attestation: "It records that a hook fired; an attestation records
// which reasoners ran." Only a `completed` row joined to a `dispatch` row for
// the same `agent_id` — and both naming this head — becomes a record.
//
// WHAT A RECORD PROVES, exactly: a reasoner instance the harness issued an id
// for, distinct from the dispatching thread, completed while the working copy
// was at this head, on this resolved model. §4.4:955 ("A fresh context window
// on the same agent is not a different agent") holds structurally rather than
// by assertion — a `/clear` produces no `agent_id` and fires no SubagentStop,
// so it can never produce a row. What it does NOT prove is anything about the
// operator (§8.1:1505), or that the reviewer read this diff (§8.1:1503 — "it is
// evidence the operator could have fabricated"). Its force is tamper-evidence:
// removing the hook is a hunk in the diff under review, not silence.

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** Wire identifier of the record shape. A consumer that does not recognise it
 * MUST treat the attestation as absent rather than guess at the fields. */
export const ATTESTATION_SCHEMA = 'clud-bug/attestation@1';

/** Ceiling on the records one bundle carries. A panel is a handful of passes;
 * anything beyond this is a store that was never compacted, and the bundle says
 * it was capped rather than quietly shipping a prefix. */
export const MAX_ATTESTATION_RECORDS = 32;

/** The store's basename inside the git COMMON dir (shared with `cli/hooks.ts`,
 * which writes it). */
export const ATTEST_STORE_FILE = 'clud-bug-attest.jsonl';

export type AttestationPhase = 'dispatch' | 'completed';

/**
 * #266 item 2 — why an emitted `records: []` says nothing on its own about
 * whether a reviewer ran. `read` is a store that was opened and parsed, and
 * genuinely held no completed row for this head; `absent` is no store file at
 * all (this checkout has never had a review, or is outside a git repository);
 * `unreadable` is a store that exists but couldn't be opened (permissions, an
 * I/O error, a directory sitting where the file should be). All three degrade
 * to the same empty `records`, because a read failure must never crash the
 * caller — but they are not the same fact, and only `store` says which one
 * happened.
 */
export type AttestationStoreState = 'read' | 'absent' | 'unreadable';

/** #266 item 1 — whether SPEC §4.4:961's registration ("the repository's
 * committed harness settings, never an operator-local override") could ever
 * actually be committed from here. `uncommittable` covers both a `.gitignore`d
 * path and `cwd` not being (or no longer being) inside a git repository at
 * all — in neither case does a committed registration exist for a reviewer to
 * point to. */
export type RegistrationState = 'committable' | 'uncommittable';

/**
 * The two repo-root-relative paths §4.4:961's registration spans: the hook
 * entries (`cli/hooks.ts` merges them into this file) and the reviewer
 * subagent definition the `SubagentStop` matcher names — an ignored agent
 * file breaks the dispatch⋈completed join exactly as an ignored settings.json
 * does. Mirrors `REVIEWER_AGENT_TYPE`/`REVIEWER_AGENT_PATH` in `cli/hooks.ts`
 * (this module cannot import a `cli/` module — see this file's own doc header
 * on layering), so a rename of the reviewer agent file there must be mirrored
 * here.
 */
export const REGISTRATION_PATHS: readonly string[] = ['.claude/settings.json', '.claude/agents/clud-bug-reviewer.md'];

/**
 * Whether `relPath` (repo-root-relative, forward-slashed — git pathspecs
 * always are) could ever land in a commit made from `cwd`. `git check-ignore`
 * exits 0 when the path IS ignored (never committable), 1 when it is NOT
 * ignored (committable), and anything else — no git repository here, git
 * itself missing, ... — is not evidence the path COULD be committed, so it is
 * folded into "uncommittable" too rather than treated as an inconclusive
 * check that defaults open.
 */
export function isRegistrationPathCommittable(cwd: string, relPath: string): boolean {
  const r = spawnSync('git', ['check-ignore', '-q', '--', relPath], { cwd });
  return r.status === 1;
}

/** Aggregate committability over every path §4.4:961's registration spans
 * (`REGISTRATION_PATHS`) — the claim only holds when ALL of them do. */
export function registrationState(cwd: string): RegistrationState {
  return REGISTRATION_PATHS.every((p) => isRegistrationPathCommittable(cwd, p)) ? 'committable' : 'uncommittable';
}

/** One row as written by a hook. Every field is either harness-provided
 * verbatim or derived from one that is; there is deliberately no field an
 * operator supplies. */
export interface AttestationRecord {
  schema: string;
  phase: AttestationPhase;
  /** The harness's identifier for this agent instance (§4.4:957). */
  agent_id: string;
  /** The subagent type it ran as. */
  role: string;
  /** `tool_response.resolvedModel`, or null when the harness did not report
   * one. Never the requested alias — §4.4:957 asks for the resolved model. */
  resolved_model?: string | null;
  /** Present only alongside a null `resolved_model`, naming why. */
  resolved_model_source?: string;
  models_used?: string[];
  /** The effort level in effect when the hook ran. */
  effort?: string | null;
  /** Always `hook-context`: the docs promise the level in effect when the HOOK
   * runs, not the subagent's own, and claiming the latter would claim more than
   * the evidence supports (§4.4:953). */
  effort_scope?: string;
  /** `tool_use_id` — the dispatching call that spawned it (§4.4:957). */
  dispatch_ref?: string;
  session_id?: string;
  /** The dispatcher-written task description the harness recorded. */
  lens_label?: string;
  /** `sha256:<32 hex>` over the dispatch prompt. §4.4:959 permits a digest and
   * forbids the text: "A stable lens label or a digest establishes that the
   * lenses were distinct, which is all the claim needs." */
  lens_digest?: string;
  head_sha: string;
  ts?: string;
}

/** A joined record — one reviewing agent that actually completed. It claims
 * only that the harness recorded that subagent being dispatched and finishing
 * at this head; it is not a claim that the subagent read the diff, reviewed it
 * well, or reviewed it at all. */
export interface AttestationEntry extends AttestationRecord {
  phase: 'completed';
  /** When the completion row was written. */
  completed_ts?: string;
}

/**
 * The field a bundle carries. `records: []` ALONE is AMBIGUOUS — it is what a
 * store that was read and genuinely held nothing produces, but a store that
 * never existed (`absent`) and one that exists but couldn't be opened
 * (`unreadable`) both degrade to the same empty array, because a read failure
 * must never crash the caller (an unreadable attestation is still a review,
 * it just cannot claim independence). `store` is what makes those three
 * distinguishable; the field is emitted even when `records` is empty, rather
 * than omitted, precisely so `store` can say WHICH kind of empty this is —
 * §4.4:953 forbids going silent instead of claiming the weaker thing, and a
 * consumer cannot tell "no reviewer ran" (`store: 'read'`) from "this
 * producer cannot report" (`absent`/`unreadable`) unless both are sayable.
 */
export interface BundleAttestation {
  schema: string;
  records: AttestationEntry[];
  /** True when the store held more completed reviewers than `records` carries. */
  truncated: boolean;
  /** #266 item 2 — additive within `clud-bug/attestation@1`: see
   * `AttestationStoreState`. Optional so an older producer's bundle (or one
   * built directly from a hand-assembled `storeText`, as the unit tests do)
   * still parses; `readAttestation` always sets it truthfully. */
  store?: AttestationStoreState;
  /** #266 item 1 — additive within `clud-bug/attestation@1`: see
   * `RegistrationState`. `readAttestation` always sets it truthfully; it says
   * nothing about who reviewed, only whether THIS checkout's registration
   * could ever back an independence claim at all (SPEC §4.4:961). */
  registration?: RegistrationState;
}

const PHASES: ReadonlySet<string> = new Set(['dispatch', 'completed']);

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
}

/**
 * Tolerant parser for one row. Returns null on anything unrecognised — a
 * hand-edited store is exactly the case this exists for. Fields are copied by
 * an explicit ALLOWLIST, never by spreading the input: a row that somehow
 * carried a `prompt` (or a subagent's final message) must not be able to ride
 * it out to the notary, which is §4.4:959 applied on the read side too.
 */
export function parseAttestRecord(raw: unknown): AttestationRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r['schema'] !== ATTESTATION_SCHEMA) return null;
  if (typeof r['phase'] !== 'string' || !PHASES.has(r['phase'])) return null;
  const agentId = str(r['agent_id'], 64);
  if (!agentId) return null;
  const headSha = str(r['head_sha'], 64);
  if (!headSha) return null;

  const rec: AttestationRecord = {
    schema: ATTESTATION_SCHEMA,
    phase: r['phase'] as AttestationPhase,
    agent_id: agentId,
    role: str(r['role'], 64) ?? '',
    head_sha: headSha,
  };
  if (typeof r['resolved_model'] === 'string') rec.resolved_model = r['resolved_model'].slice(0, 64);
  else if (r['resolved_model'] === null) rec.resolved_model = null;
  const source = str(r['resolved_model_source'], 32);
  if (source && rec.resolved_model == null) rec.resolved_model_source = source;
  if (Array.isArray(r['models_used'])) {
    const models = r['models_used'].filter((m): m is string => typeof m === 'string' && !!m).slice(0, 8);
    if (models.length) rec.models_used = models.map((m) => m.slice(0, 64));
  }
  if (typeof r['effort'] === 'string') rec.effort = r['effort'].slice(0, 16);
  else if (r['effort'] === null) rec.effort = null;
  const scope = str(r['effort_scope'], 32);
  if (scope) rec.effort_scope = scope;
  const dispatchRef = str(r['dispatch_ref'], 80);
  if (dispatchRef) rec.dispatch_ref = dispatchRef;
  const session = str(r['session_id'], 80);
  if (session) rec.session_id = session;
  const label = str(r['lens_label'], 120);
  if (label) rec.lens_label = label;
  const digest = str(r['lens_digest'], 80);
  if (digest) rec.lens_digest = digest;
  const ts = str(r['ts'], 40);
  if (ts) rec.ts = ts;
  return rec;
}

/** Parse a whole store. A malformed line is DROPPED, not fatal: two subagents
 * can append concurrently, and one torn line must not erase the review the
 * other recorded. */
export function parseAttestStore(text: string | undefined | null): AttestationRecord[] {
  if (!text) return [];
  const out: AttestationRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const rec = parseAttestRecord(raw);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * Join the store into the bundle field for one head. See the join rule in this
 * file's header: dispatch ⋈ completed on `agent_id`, both rows naming
 * `headSha`, and the dispatch row supplying the model/effort/lens fields the
 * completion row does not carry.
 */
export function collectAttestation(input: {
  storeText?: string | null;
  headSha: string;
  /** #266 item 2 — passed through verbatim to the output. `readAttestation`
   * is the only caller that knows WHY `storeText` is what it is (it made the
   * actual `readFile` call); a caller that only has raw text — e.g. every
   * direct unit test of this function — has no `store` fact to report, so it
   * is left unset rather than guessed at here. */
  store?: AttestationStoreState;
}): BundleAttestation {
  const { storeText, headSha } = input;
  const rows = parseAttestStore(storeText).filter((r) => r.head_sha === headSha);

  const dispatches = new Map<string, AttestationRecord>();
  for (const r of rows) if (r.phase === 'dispatch' && !dispatches.has(r.agent_id)) dispatches.set(r.agent_id, r);

  const seen = new Set<string>();
  const entries: AttestationEntry[] = [];
  for (const r of rows) {
    if (r.phase !== 'completed') continue;
    if (seen.has(r.agent_id)) continue; // one reviewer, one record
    const dispatch = dispatches.get(r.agent_id);
    if (!dispatch) continue; // a completion with no dispatch half is not a record
    seen.add(r.agent_id);
    entries.push({
      ...dispatch,
      phase: 'completed',
      // The completion row's own role/session win: they describe the agent that
      // actually finished, where the dispatch row describes what was asked for.
      role: r.role || dispatch.role,
      ...(r.session_id !== undefined ? { session_id: r.session_id } : {}),
      ...(r.effort !== undefined ? { effort: r.effort } : {}),
      ...(r.ts !== undefined ? { completed_ts: r.ts } : {}),
    });
  }

  return {
    schema: ATTESTATION_SCHEMA,
    records: entries.slice(0, MAX_ATTESTATION_RECORDS),
    truncated: entries.length > MAX_ATTESTATION_RECORDS,
    ...(input.store !== undefined ? { store: input.store } : {}),
  };
}

/** Absolute path of the store for the repository containing `cwd`, or null
 * outside a repository. `--git-common-dir` (never `--git-dir`) is the ONE
 * location every linked worktree of a repo shares — the same rule the review
 * bookkeeping follows since #240 vector 1, so a review dispatched from a
 * worktree is readable from the primary checkout. */
export function resolveAttestStorePath(cwd: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const dir = (r.stdout ?? '').trim();
  if (!dir) return null;
  return join(dir.startsWith('/') ? dir : join(cwd, dir), ATTEST_STORE_FILE);
}

/**
 * Read the harness's store and derive the bundle field, for `headSha`, from
 * the repository containing `cwd`. An unreadable or absent store yields the
 * empty-but-present attestation, never a thrown error: a review whose
 * attestation cannot be read is still a review, it just cannot claim
 * independence.
 *
 * #266 items 1+2 — this is the ONE place `build-bundle` and `post-check-run`
 * both go through (the latter is the trust boundary, §4.4:965), so it is
 * where `store` and `registration` get stamped truthfully rather than left to
 * each caller to reconstruct.
 */
export async function readAttestation(input: {
  cwd: string;
  headSha: string;
}): Promise<BundleAttestation> {
  const path = resolveAttestStorePath(input.cwd);
  let text: string | null = null;
  let store: AttestationStoreState;
  if (!path) {
    // No `--git-common-dir` at all — outside a git repository, so no store
    // could ever have been written here. That is an absence, not a failure.
    store = 'absent';
  } else {
    try {
      text = await readFile(path, 'utf8');
      store = 'read';
    } catch (e) {
      text = null;
      // ENOENT — the store file itself has never been written (no review has
      // ever run in this checkout) — is an absence. Anything else (EACCES, an
      // EISDIR from something sitting where the file should be, ...) is a
      // store that exists but this process could not open, which is a
      // DIFFERENT fact a consumer needs distinguished (#266 item 2): collapse
      // it into 'read' and an unreadable store is reported as a clean
      // "nobody reviewed", which is exactly the not-recorded-means-
      // did-not-happen error §4.4:953 forbids.
      const code = e && typeof e === 'object' ? (e as NodeJS.ErrnoException).code : undefined;
      store = code === 'ENOENT' ? 'absent' : 'unreadable';
    }
  }
  const collected = collectAttestation({ storeText: text, headSha: input.headSha, store });
  return { ...collected, registration: registrationState(input.cwd) };
}
