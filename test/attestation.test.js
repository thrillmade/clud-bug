// #266 — the reader half of the harness attestation (SPEC 2.0 §4.4): the
// tolerant record parser, the dispatch⋈completed join, and the bundle field the
// record set travels on (§4.4:963 — "it travels on the check's output alongside
// the audit artifact of §4.5 — one mechanism rather than two").
//
// The join is the load-bearing part. §4.4:967: "A 'already reviewed this SHA'
// marker is not an attestation … It records that a hook fired; an attestation
// records which reasoners ran." A dispatch row alone means a subagent was
// LAUNCHED; only a completed row joined to it means one ran to the end.

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  ATTESTATION_SCHEMA,
  ATTEST_STORE_FILE,
  MAX_ATTESTATION_RECORDS,
  REGISTRATION_PATHS,
  parseAttestRecord,
  parseAttestStore,
  collectAttestation,
  readAttestation,
  registrationState,
  isRegistrationPathCommittable,
} from '../src/core/attestation.js';
import { buildBundle, parseBundle, NOTARY_BUNDLE_VERSION } from '../src/core/notary-bundle.js';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function dispatchRow(over = {}) {
  return {
    schema: ATTESTATION_SCHEMA,
    phase: 'dispatch',
    agent_id: 'agent-1',
    role: 'clud-bug-reviewer',
    resolved_model: 'claude-opus-5',
    effort: 'xhigh',
    effort_scope: 'hook-context',
    dispatch_ref: 'toolu_1',
    session_id: 's1',
    lens_label: 'Refute-first',
    lens_digest: 'sha256:' + '0'.repeat(32),
    head_sha: SHA,
    ts: '2026-09-15T14:02:11.000Z',
    ...over,
  };
}

function completedRow(over = {}) {
  return {
    schema: ATTESTATION_SCHEMA,
    phase: 'completed',
    agent_id: 'agent-1',
    role: 'clud-bug-reviewer',
    effort: 'xhigh',
    effort_scope: 'hook-context',
    session_id: 's1',
    head_sha: SHA,
    ts: '2026-09-15T14:09:03.000Z',
    ...over,
  };
}

const store = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

describe('parseAttestRecord', () => {
  it('accepts a well-formed row of either phase', () => {
    expect(parseAttestRecord(dispatchRow())?.phase).toBe('dispatch');
    expect(parseAttestRecord(completedRow())?.phase).toBe('completed');
  });

  it('rejects a row with a foreign schema, an unknown phase, or no agent_id', () => {
    expect(parseAttestRecord(dispatchRow({ schema: 'something/else@1' }))).toBe(null);
    expect(parseAttestRecord(dispatchRow({ phase: 'started' }))).toBe(null);
    expect(parseAttestRecord(dispatchRow({ agent_id: '' }))).toBe(null);
    expect(parseAttestRecord(dispatchRow({ agent_id: 7 }))).toBe(null);
    expect(parseAttestRecord(null)).toBe(null);
    expect(parseAttestRecord('dispatch')).toBe(null);
  });

  it('never carries a prompt-shaped field through, whatever the store holds', () => {
    // §4.4:959. The writer does not emit one; the reader must not pass one on
    // either, or a hand-edited store could smuggle source into the bundle.
    const parsed = parseAttestRecord(dispatchRow({ prompt: 'secret strategy', last_assistant_message: 'x' }));
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('secret strategy');
    expect(JSON.stringify(parsed)).not.toContain('last_assistant_message');
  });
});

describe('parseAttestStore', () => {
  it('drops malformed lines and keeps the rest (a torn write is not a lost review)', () => {
    const text = [JSON.stringify(dispatchRow()), '{not json', '', JSON.stringify(completedRow())].join('\n');
    expect(parseAttestStore(text)).toHaveLength(2);
  });

  it('returns [] on an absent / empty store', () => {
    expect(parseAttestStore('')).toEqual([]);
    expect(parseAttestStore(undefined)).toEqual([]);
  });
});

describe('collectAttestation', () => {
  it('emits a record only where a completed row joins a dispatch row', () => {
    const a = collectAttestation({ storeText: store([dispatchRow(), completedRow()]), headSha: SHA });
    expect(a.schema).toBe(ATTESTATION_SCHEMA);
    expect(a.records).toHaveLength(1);
    expect(a.records[0].agent_id).toBe('agent-1');
    expect(a.records[0].resolved_model).toBe('claude-opus-5'); // carried from the dispatch row
    expect(a.records[0].completed_ts).toBe('2026-09-15T14:09:03.000Z');
  });

  it('§4.4:967 — a dispatch row with no completion is NOT an attestation', () => {
    const a = collectAttestation({ storeText: store([dispatchRow()]), headSha: SHA });
    expect(a.records).toEqual([]);
  });

  it('a completion with no dispatch row is not an attestation either (no resolved model)', () => {
    const a = collectAttestation({ storeText: store([completedRow()]), headSha: SHA });
    expect(a.records).toEqual([]);
  });

  it('drops rows recorded against a different head — the record is named for THIS commit', () => {
    const a = collectAttestation({
      storeText: store([
        dispatchRow({ agent_id: 'old', head_sha: OTHER_SHA }),
        completedRow({ agent_id: 'old', head_sha: OTHER_SHA }),
        dispatchRow(),
        completedRow(),
      ]),
      headSha: SHA,
    });
    expect(a.records.map((r) => r.agent_id)).toEqual(['agent-1']);
  });

  it('drops a pair whose two halves disagree about the head', () => {
    const a = collectAttestation({
      storeText: store([dispatchRow(), completedRow({ head_sha: OTHER_SHA })]),
      headSha: SHA,
    });
    expect(a.records).toEqual([]);
  });

  it('caps the record set and says so rather than truncating in silence', () => {
    const rows = [];
    for (let i = 0; i < MAX_ATTESTATION_RECORDS + 5; i++) {
      rows.push(dispatchRow({ agent_id: `a${i}`, dispatch_ref: `toolu_${i}` }));
      rows.push(completedRow({ agent_id: `a${i}` }));
    }
    const a = collectAttestation({ storeText: store(rows), headSha: SHA });
    expect(a.records).toHaveLength(MAX_ATTESTATION_RECORDS);
    expect(a.truncated).toBe(true);
  });

  it('is not truncated when it fits', () => {
    const a = collectAttestation({ storeText: store([dispatchRow(), completedRow()]), headSha: SHA });
    expect(a.truncated).toBe(false);
  });

  it('collapses a repeated completion for one agent into one record', () => {
    const a = collectAttestation({
      storeText: store([dispatchRow(), completedRow(), completedRow()]),
      headSha: SHA,
    });
    expect(a.records).toHaveLength(1);
  });

  it('tolerates a store that is entirely garbage', () => {
    const a = collectAttestation({ storeText: 'nonsense\n{{{\n', headSha: SHA });
    expect(a.records).toEqual([]);
    expect(a.truncated).toBe(false);
  });
});

describe('the bundle carries the attestation (§4.4:963)', () => {
  const attestation = { schema: ATTESTATION_SCHEMA, records: [], truncated: false };

  it('bundle_version is 2 — a v1 producer cannot report, which is not "reports none"', () => {
    expect(NOTARY_BUNDLE_VERSION).toBe(2);
  });

  it('buildBundle omits the field when there is nothing to carry, and stamps it when there is', () => {
    const bare = buildBundle({
      repo: 'o/r', headSha: SHA, verdict: 'clean', findings: [], coverage: [], recipeVersion: 'local',
    });
    expect('attestation' in bare).toBe(false);
    const withAttest = buildBundle({
      repo: 'o/r', headSha: SHA, verdict: 'clean', findings: [], coverage: [], recipeVersion: 'local',
      attestation: {
        schema: ATTESTATION_SCHEMA,
        records: [
          {
            schema: ATTESTATION_SCHEMA, phase: 'completed', agent_id: 'agent-1', role: 'clud-bug-reviewer',
            resolved_model: 'claude-opus-5', effort: 'xhigh', effort_scope: 'hook-context',
            dispatch_ref: 'toolu_1', session_id: 's1', lens_label: 'L', head_sha: SHA,
          },
        ],
        truncated: false,
      },
    });
    expect(withAttest.attestation.records).toHaveLength(1);
  });

  it('parseBundle round-trips a valid attestation', () => {
    const b = buildBundle({
      repo: 'o/r', pr: 7, headSha: SHA, verdict: 'clean', findings: [], coverage: [],
      recipeVersion: 'local', attestation,
    });
    const parsed = parseBundle(JSON.parse(JSON.stringify(b)));
    expect(parsed).toEqual(b);
  });

  it('a malformed attestation degrades to ABSENT — it never nulls an otherwise valid bundle', () => {
    // A bad attestation must not destroy a review the notary could still read:
    // the claim degrades to independence-unestablished, which is the honest
    // weaker claim (§4.4:953), not a dropped review.
    for (const bad of ['nope', 42, { schema: 'other@1', records: [] }, { schema: ATTESTATION_SCHEMA, records: 'x' }]) {
      const parsed = parseBundle({
        repo: 'o/r', head_sha: SHA, verdict: 'clean', findings: [], coverage: [], attestation: bad,
      });
      expect(parsed).not.toBeNull();
      expect(parsed.attestation).toBeUndefined();
    }
  });

  it('drops only the unreadable ROWS of an otherwise well-formed attestation', () => {
    const parsed = parseBundle({
      repo: 'o/r', head_sha: SHA, verdict: 'clean', findings: [], coverage: [],
      attestation: {
        schema: ATTESTATION_SCHEMA,
        records: [{ ...dispatchRow(), phase: 'completed' }, { junk: true }],
        truncated: false,
      },
    });
    expect(parsed.attestation.records).toHaveLength(1);
  });

  it('carries no independence identifier at all — the records are the whole field', () => {
    // §4.4:953's identifier is derived from these records by the consumer, not
    // asserted by the producer, so no spelling of it rides the field out — not
    // an invented one, and not `self-reviewed` either.
    for (const claim of ['self-reviewed', 'independently-reviewed']) {
      const parsed = parseBundle({
        repo: 'o/r', head_sha: SHA, verdict: 'clean', findings: [], coverage: [],
        attestation: { schema: ATTESTATION_SCHEMA, records: [], truncated: false, producer_claim: claim },
      });
      expect(parsed.attestation.producer_claim).toBeUndefined();
    }
  });
});

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function makeRepo(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

describe('#266 item 1 — registration committability (SPEC §4.4:961)', () => {
  it('both registration paths are committable in a plain repo', async () => {
    const dir = await makeRepo('clud-bug-reg-plain-');
    expect(REGISTRATION_PATHS.every((p) => isRegistrationPathCommittable(dir, p))).toBe(true);
    expect(registrationState(dir)).toBe('committable');
  });

  it('registrationState is "uncommittable" when .claude/ is gitignored', async () => {
    const dir = await makeRepo('clud-bug-reg-ignored-');
    await writeFile(join(dir, '.gitignore'), '.claude/\n');
    expect(isRegistrationPathCommittable(dir, '.claude/settings.json')).toBe(false);
    expect(registrationState(dir)).toBe('uncommittable');
  });

  it('registrationState is "uncommittable" when only ONE of the two paths is ignored', async () => {
    // §4.4:961's registration spans both files the harness join needs; an
    // ignored agent file breaks the join exactly as an ignored settings.json
    // does, so the aggregate must not report "committable" on a partial win.
    const dir = await makeRepo('clud-bug-reg-partial-');
    await writeFile(join(dir, '.gitignore'), '.claude/agents/\n');
    expect(isRegistrationPathCommittable(dir, '.claude/settings.json')).toBe(true);
    expect(isRegistrationPathCommittable(dir, '.claude/agents/clud-bug-reviewer.md')).toBe(false);
    expect(registrationState(dir)).toBe('uncommittable');
  });

  it('registrationState is "uncommittable" outside a git repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-reg-nogit-'));
    expect(registrationState(dir)).toBe('uncommittable');
  });

  it('readAttestation stamps `registration` truthfully alongside the records', async () => {
    const dir = await makeRepo('clud-bug-reg-bundle-');
    const sha = git(dir, ['rev-parse', 'HEAD']);
    expect((await readAttestation({ cwd: dir, headSha: sha })).registration).toBe('committable');

    await writeFile(join(dir, '.gitignore'), '.claude/\n');
    expect((await readAttestation({ cwd: dir, headSha: sha })).registration).toBe('uncommittable');
  });
});

describe('#266 item 2 — `store` distinguishes why `records` is empty', () => {
  it('is "absent" when the store file has never been written', async () => {
    const dir = await makeRepo('clud-bug-store-absent-');
    const sha = git(dir, ['rev-parse', 'HEAD']);
    const a = await readAttestation({ cwd: dir, headSha: sha });
    expect(a.store).toBe('absent');
    expect(a.records).toEqual([]);
  });

  it('is "absent" outside a git repository (no common dir, so no store could exist)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clud-bug-store-nogit-'));
    const a = await readAttestation({ cwd: dir, headSha: SHA });
    expect(a.store).toBe('absent');
  });

  it('is "read" when the store exists and was opened, whether or not it held anything', async () => {
    const dir = await makeRepo('clud-bug-store-read-');
    const sha = git(dir, ['rev-parse', 'HEAD']);
    await writeFile(join(dir, '.git', ATTEST_STORE_FILE), '');
    const a = await readAttestation({ cwd: dir, headSha: sha });
    expect(a.store).toBe('read');
    expect(a.records).toEqual([]);
  });

  it('is "unreadable" when the store exists but cannot be opened as a file — never collapsed into "read"', async () => {
    const dir = await makeRepo('clud-bug-store-unreadable-');
    const sha = git(dir, ['rev-parse', 'HEAD']);
    // A directory sitting where the store file should be: readFile fails with
    // EISDIR, not ENOENT — a real, non-mocked "exists but unreadable" store.
    await mkdir(join(dir, '.git', ATTEST_STORE_FILE));
    const a = await readAttestation({ cwd: dir, headSha: sha });
    expect(a.store).toBe('unreadable');
    expect(a.records).toEqual([]);
  });

  it('collectAttestation only carries `store` when the caller supplies one', () => {
    // A direct caller with only raw text (every other test in this file) has
    // no fs-level fact to report, so the field stays unset rather than guessed.
    const a = collectAttestation({ storeText: null, headSha: SHA });
    expect('store' in a).toBe(false);
  });
});
