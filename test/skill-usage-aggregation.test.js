// v0.6.30 — cross-review aggregation tests.
//
// Covers `fetchUsageArtifacts` + `aggregateUsageStream` from
// `lib/skill-usage.js`. The fetch path is exercised against a mocked
// gh-runner so tests don't shell out + don't require GH_TOKEN.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import {
  fetchUsageArtifacts,
  aggregateUsageStream,
} from '../lib/skill-usage.js';

// ---------------------------------------------------------------------------
// aggregateUsageStream (pure function — no I/O)
// ---------------------------------------------------------------------------

test('aggregateUsageStream: empty array returns {}', () => {
  assert.deepEqual(aggregateUsageStream([]), {});
});

test('aggregateUsageStream: non-array returns {}', () => {
  assert.deepEqual(aggregateUsageStream(null), {});
  assert.deepEqual(aggregateUsageStream(undefined), {});
});

test('aggregateUsageStream: single artifact returns its usage', () => {
  const out = aggregateUsageStream([
    {
      prNumber: 1,
      fetchedAt: '2026-05-01T00:00:00Z',
      usage: {
        'critical-issues-only': { loads: 1, citations: 1, last_cited: '2026-05-01T00:00:00Z' },
      },
    },
  ]);
  assert.equal(out['critical-issues-only'].loads, 1);
  assert.equal(out['critical-issues-only'].citations, 1);
  assert.equal(out['critical-issues-only'].last_cited, '2026-05-01T00:00:00Z');
});

test('aggregateUsageStream: three artifacts sum loads + citations', () => {
  const out = aggregateUsageStream([
    {
      prNumber: 1, fetchedAt: '2026-05-01T00:00:00Z',
      usage: { 'pii': { loads: 1, citations: 1, last_cited: '2026-05-01T00:00:00Z' } },
    },
    {
      prNumber: 2, fetchedAt: '2026-05-02T00:00:00Z',
      usage: { 'pii': { loads: 1, citations: 0, last_cited: null } },
    },
    {
      prNumber: 3, fetchedAt: '2026-05-03T00:00:00Z',
      usage: { 'pii': { loads: 1, citations: 1, last_cited: '2026-05-03T00:00:00Z' } },
    },
  ]);
  assert.equal(out['pii'].loads, 3);
  assert.equal(out['pii'].citations, 2);
});

test('aggregateUsageStream: out-of-order input produces same result as chronological', () => {
  const arts = [
    {
      prNumber: 1, fetchedAt: '2026-05-01T00:00:00Z',
      usage: { 'a': { loads: 2, citations: 1, last_cited: '2026-05-01T00:00:00Z' } },
    },
    {
      prNumber: 2, fetchedAt: '2026-05-02T00:00:00Z',
      usage: { 'a': { loads: 3, citations: 2, last_cited: '2026-05-02T00:00:00Z' } },
    },
    {
      prNumber: 3, fetchedAt: '2026-05-03T00:00:00Z',
      usage: { 'a': { loads: 1, citations: 1, last_cited: '2026-05-03T00:00:00Z' } },
    },
  ];
  const chrono = aggregateUsageStream(arts);
  const reversed = aggregateUsageStream([...arts].reverse());
  const shuffled = aggregateUsageStream([arts[1], arts[2], arts[0]]);
  assert.deepEqual(reversed, chrono);
  assert.deepEqual(shuffled, chrono);
});

test('aggregateUsageStream: last_cited = most recent citing artifact', () => {
  const out = aggregateUsageStream([
    {
      prNumber: 1, fetchedAt: '2026-05-01T00:00:00Z',
      usage: { 'x': { loads: 1, citations: 1, last_cited: '2026-05-01T00:00:00Z' } },
    },
    {
      prNumber: 2, fetchedAt: '2026-05-05T00:00:00Z',
      usage: { 'x': { loads: 1, citations: 0, last_cited: null } }, // load only, no citation
    },
    {
      prNumber: 3, fetchedAt: '2026-05-03T00:00:00Z',
      usage: { 'x': { loads: 1, citations: 1, last_cited: '2026-05-03T00:00:00Z' } },
    },
  ]);
  // citing artifacts: PR1 (5/1) + PR3 (5/3). After chronological merge,
  // last_cited should be 5/3 (the latest citing artifact).
  assert.equal(out['x'].last_cited, '2026-05-03T00:00:00Z');
  assert.equal(out['x'].loads, 3);
  assert.equal(out['x'].citations, 2);
});

test('aggregateUsageStream: skills only in some artifacts are preserved', () => {
  const out = aggregateUsageStream([
    {
      prNumber: 1, fetchedAt: '2026-05-01T00:00:00Z',
      usage: { 'only-in-pr1': { loads: 1, citations: 0, last_cited: null } },
    },
    {
      prNumber: 2, fetchedAt: '2026-05-02T00:00:00Z',
      usage: { 'only-in-pr2': { loads: 1, citations: 1, last_cited: '2026-05-02T00:00:00Z' } },
    },
  ]);
  assert.ok(out['only-in-pr1']);
  assert.ok(out['only-in-pr2']);
  assert.equal(Object.keys(out).length, 2);
});

// ---------------------------------------------------------------------------
// fetchUsageArtifacts (with mocked ghRunner)
// ---------------------------------------------------------------------------

function makeMockRunner({ artifactList = [], onDownload = null } = {}) {
  return {
    async json(args) {
      // The list call uses `gh api repos/X/Y/actions/artifacts --paginate --jq ...`
      if (args.includes('api') && args.some((a) => a.includes('/actions/artifacts'))) {
        return artifactList;
      }
      return null;
    },
    async run(args) {
      if (args[0] === 'run' && args[1] === 'download') {
        if (onDownload) return onDownload(args);
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'unexpected mock invocation' };
    },
  };
}

test('fetchUsageArtifacts: uses per_page=100 (NOT --paginate, which breaks JSON parse across pages)', async () => {
  // Regression guard for the clud-bug-review finding on PR #127:
  // `gh api --paginate --jq <expr>` applies the jq filter to each
  // page independently, producing `[...]\n[...]` — invalid as a
  // single JSON document. `JSON.parse` returns null and the
  // dashboard silently shows empty for repos with >30 artifacts.
  let capturedArgs = null;
  const runner = {
    async json(args) {
      capturedArgs = args;
      return [];
    },
    async run() { return { code: 0, stdout: '', stderr: '' }; },
  };
  await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.ok(capturedArgs, 'json runner should have been called');
  assert.ok(
    !capturedArgs.includes('--paginate'),
    '--paginate must NOT be passed (breaks --jq across pages)',
  );
  const urlArg = capturedArgs.find((a) => a.includes('/actions/artifacts'));
  assert.ok(urlArg, 'should call the artifacts endpoint');
  assert.match(urlArg, /per_page=100/, 'URL must include per_page=100 to cover up to 100 artifacts in one call');
});

test('fetchUsageArtifacts: requires owner + repo', async () => {
  await assert.rejects(
    () => fetchUsageArtifacts({ owner: null, repo: 'logmind' }),
    /owner \+ repo are required/,
  );
});

test('fetchUsageArtifacts: empty artifact list returns []', async () => {
  const runner = makeMockRunner({ artifactList: [] });
  const out = await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.deepEqual(out, []);
});

test('fetchUsageArtifacts: null from runner returns []', async () => {
  const runner = { json: async () => null, run: async () => ({ code: 1, stdout: '', stderr: '' }) };
  const out = await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.deepEqual(out, []);
});

test('fetchUsageArtifacts: skips artifacts with malformed names', async () => {
  const runner = makeMockRunner({
    artifactList: [
      { id: 1, name: 'unrelated-artifact', workflow_run_id: 100, created_at: '2026-05-01T00:00:00Z' },
      { id: 2, name: 'clud-bug-skill-usage-pr-notanumber', workflow_run_id: 101, created_at: '2026-05-01T00:00:00Z' },
    ],
    // The --jq filter would normally filter these out at the API layer.
    // Our mock returns them anyway to exercise the client-side guard.
  });
  // Inject a downloader that would error if called — none of these should be downloaded.
  const out = await fetchUsageArtifacts({
    owner: 't', repo: 'r',
    ghRunner: {
      json: runner.json,
      run: async () => ({ code: 1, stdout: '', stderr: 'should not be called' }),
    },
  });
  // The malformed entries are filtered (no PR number match), but the
  // "unrelated-artifact" passes the --jq filter at API layer in
  // production. In the mock it leaks through and gets dropped here.
  assert.deepEqual(out, []);
});

test('fetchUsageArtifacts: returns one record per valid artifact', async () => {
  // Set up a temp dir + payload that the mock downloader writes to.
  // We can't easily intercept tmpdir creation, so we rely on the
  // downloader to write the file at the path the impl expects.

  const runner = makeMockRunner({
    artifactList: [
      { id: 42, name: 'clud-bug-skill-usage-pr-7', workflow_run_id: 999, created_at: '2026-05-15T12:00:00Z' },
    ],
    onDownload: async (args) => {
      // args = ['run', 'download', '999', '-R', 't/r', '-n', 'clud-bug-skill-usage-pr-7', '-D', <tmpDir>]
      const tmpDir = args[args.length - 1];
      const file = join(tmpDir, '.clud-bug.json');
      await writeFile(file, JSON.stringify({
        version: 1,
        usage: {
          'critical-issues-only': { loads: 5, citations: 3, last_cited: '2026-05-15T12:00:00Z' },
        },
      }));
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const out = await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.equal(out.length, 1);
  assert.equal(out[0].prNumber, 7);
  assert.equal(out[0].artifactId, 42);
  assert.equal(out[0].fetchedAt, '2026-05-15T12:00:00Z');
  assert.equal(out[0].usage['critical-issues-only'].loads, 5);
});

test('fetchUsageArtifacts: skips artifacts whose download fails', async () => {
  const runner = makeMockRunner({
    artifactList: [
      { id: 1, name: 'clud-bug-skill-usage-pr-1', workflow_run_id: 100, created_at: '2026-05-01T00:00:00Z' },
      { id: 2, name: 'clud-bug-skill-usage-pr-2', workflow_run_id: 101, created_at: '2026-05-02T00:00:00Z' },
    ],
    onDownload: async (args) => {
      const tmpDir = args[args.length - 1];
      const artifactName = args[args.length - 3];
      // Only PR-2 download succeeds.
      if (artifactName === 'clud-bug-skill-usage-pr-2') {
        await writeFile(join(tmpDir, '.clud-bug.json'), JSON.stringify({
          version: 1,
          usage: { 'pii': { loads: 1, citations: 1, last_cited: '2026-05-02T00:00:00Z' } },
        }));
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'download failed' };
    },
  });

  const out = await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.equal(out.length, 1);
  assert.equal(out[0].prNumber, 2);
});

test('fetchUsageArtifacts: filters by `since` date', async () => {
  const runner = makeMockRunner({
    artifactList: [
      { id: 1, name: 'clud-bug-skill-usage-pr-1', workflow_run_id: 100, created_at: '2026-04-01T00:00:00Z' }, // old
      { id: 2, name: 'clud-bug-skill-usage-pr-2', workflow_run_id: 101, created_at: '2026-05-15T00:00:00Z' }, // recent
    ],
    onDownload: async (args) => {
      const tmpDir = args[args.length - 1];
      await writeFile(join(tmpDir, '.clud-bug.json'), JSON.stringify({ version: 1, usage: {} }));
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const out = await fetchUsageArtifacts({
    owner: 't', repo: 'r',
    since: new Date('2026-05-01T00:00:00Z'),
    ghRunner: runner,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].prNumber, 2);
});

test('fetchUsageArtifacts: malformed .clud-bug.json in artifact is skipped', async () => {
  const runner = makeMockRunner({
    artifactList: [
      { id: 1, name: 'clud-bug-skill-usage-pr-1', workflow_run_id: 100, created_at: '2026-05-01T00:00:00Z' },
    ],
    onDownload: async (args) => {
      const tmpDir = args[args.length - 1];
      await writeFile(join(tmpDir, '.clud-bug.json'), 'not-json{{{');
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const out = await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.deepEqual(out, []);
});

test('fetchUsageArtifacts: missing usage field treats as empty {}', async () => {
  const runner = makeMockRunner({
    artifactList: [
      { id: 1, name: 'clud-bug-skill-usage-pr-1', workflow_run_id: 100, created_at: '2026-05-01T00:00:00Z' },
    ],
    onDownload: async (args) => {
      const tmpDir = args[args.length - 1];
      await writeFile(join(tmpDir, '.clud-bug.json'), JSON.stringify({ version: 1 })); // no usage key
      return { code: 0, stdout: '', stderr: '' };
    },
  });

  const out = await fetchUsageArtifacts({ owner: 't', repo: 'r', ghRunner: runner });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].usage, {});
});
