// Phase Z4 (CLI side) — the challenge/response nonce handshake that precedes
// `/notarize`. `submitToNotary` now mints a single-use nonce via `POST
// /challenge` before submitting, per SPEC §10.3.3 ① replay-closure. These
// tests drive the REAL compiled CLI (subprocess) against a throwaway local
// HTTP server standing in for the notary — matching check-verdict.test.js's
// `post-check-run` idiom and cli.test.js's "can't monkey-patch fetch in a
// child process" note (see its `CLUD_BUG_SKILLS_SH_BASE` override).

import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

// NB: `spawn`, not `spawnSync` — the mock notary server below lives in THIS
// same test process. `spawnSync` blocks the whole JS thread until the child
// exits, which would starve that server's event loop and deadlock any test
// that both spawns the CLI and expects it to reach a same-process server.
function run(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      // A broken PATH means any `git`/`gh` the CLI shells out to (owner/repo
      // resolution, the diff load for coverage/grounding, the final check-run
      // POST) fails closed with ENOENT rather than making a real network call —
      // keeps these tests hermetic regardless of local `gh` auth. The bundle
      // uses a made-up `head_sha`, so the diff load was always going to come up
      // empty; this just makes that deterministic too.
      env: { ...process.env, PATH: '/dev/null/does-not-exist', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    // Safety net: a stray open socket must never hang the test suite — fail
    // loudly (non-null `.signal`) instead of hanging until vitest's own
    // per-test timeout.
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function withServer(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      requests.push({ method: req.method, url: req.url, body });
      // Force the socket closed once the response is flushed — otherwise the
      // CLI's fetch keeps the HTTP/1.1 keep-alive connection open and
      // `server.close()` below hangs waiting for a connection nobody is
      // going to close from either end.
      res.on('finish', () => req.socket.destroy());
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function makeBundle(dir, overrides = {}) {
  const bundle = {
    bundle_version: 1,
    repo: 'o/r',
    pr: 7,
    head_sha: 'deadbeefcafefeed0000',
    verdict: 'clean',
    findings: [],
    coverage: [],
    recipe_version: 'test',
    protocol_version: '1.2.0',
    ...overrides,
  };
  const path = join(dir, 'bundle.json');
  await writeFile(path, JSON.stringify(bundle));
  return path;
}

describe('post-check-run notary submit: /challenge handshake', () => {
  it('200 challenge → nonce attached to the bundle POSTed to /notarize; outcome posted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      const bundlePath = await makeBundle(dir);
      await withServer(
        (req, res) => {
          if (req.method === 'POST' && req.url === '/notarize/challenge') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ nonce: 'nonce-123' }));
          } else if (req.method === 'POST' && req.url === '/notarize') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(404);
            res.end();
          }
        },
        async (url, requests) => {
          const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
            CLUD_BUG_NOTARY_URL: url,
          });
          expect(r.status).toBe(0);
          expect(r.stdout).toMatch(/notarized o\/r@deadbeefcafe\b/);

          const challengeReq = requests.find((x) => x.url === '/notarize/challenge');
          expect(challengeReq).toBeTruthy();
          expect(challengeReq.body).toMatchObject({ repo: 'o/r', head_sha: 'deadbeefcafefeed0000' });

          const notarizeReq = requests.find((x) => x.url === '/notarize');
          expect(notarizeReq).toBeTruthy();
          expect(notarizeReq.body.nonce).toBe('nonce-123');
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('402 (not entitled) on /challenge → loud NOT-notarized warning, falls back, never calls /notarize', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      const bundlePath = await makeBundle(dir);
      await withServer(
        (req, res) => {
          if (req.method === 'POST' && req.url === '/notarize/challenge') {
            res.writeHead(402, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not entitled' }));
          } else {
            res.writeHead(404);
            res.end();
          }
        },
        async (url, requests) => {
          const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
            CLUD_BUG_NOTARY_URL: url,
          });
          // Best-effort verb — never fatal even though the final self-attested
          // check-run POST also fails closed (no `gh` on PATH).
          expect(r.status).toBe(0);
          expect(r.stderr).toMatch(/NOT notarized/);
          expect(r.stderr).toMatch(/self-attested/);
          expect(r.stderr).toMatch(/cludbug\.dev/);
          expect(requests.some((x) => x.url === '/notarize')).toBe(false);
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('non-402 4xx on /challenge → terminal rejected (not a fallback), never calls /notarize', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      const bundlePath = await makeBundle(dir);
      await withServer(
        (req, res) => {
          if (req.method === 'POST' && req.url === '/notarize/challenge') {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad request' }));
          } else {
            res.writeHead(404);
            res.end();
          }
        },
        async (url, requests) => {
          const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
            CLUD_BUG_NOTARY_URL: url,
          });
          expect(r.status).toBe(0);
          expect(r.stderr).toMatch(/notary declined the challenge/);
          expect(r.stderr).not.toMatch(/NOT notarized/);
          expect(r.stdout).not.toMatch(/notarized/);
          expect(requests.some((x) => x.url === '/notarize')).toBe(false);
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('5xx on /challenge → fallback (endpoint down), never calls /notarize', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      const bundlePath = await makeBundle(dir);
      await withServer(
        (req, res) => {
          if (req.method === 'POST' && req.url === '/notarize/challenge') {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'down for maintenance' }));
          } else {
            res.writeHead(404);
            res.end();
          }
        },
        async (url, requests) => {
          const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
            CLUD_BUG_NOTARY_URL: url,
          });
          expect(r.status).toBe(0);
          expect(r.stderr).toMatch(/notary challenge endpoint unavailable/);
          expect(r.stderr).toMatch(/falling back to the self-attested check/);
          expect(r.stderr).not.toMatch(/NOT notarized/);
          expect(requests.some((x) => x.url === '/notarize')).toBe(false);
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('network error reaching /challenge (endpoint down) → fallback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      const bundlePath = await makeBundle(dir);
      const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
        // Port 1 is (almost certainly) not listening → ECONNREFUSED, same
        // unreachable-host idiom cli.test.js uses for skills.sh.
        CLUD_BUG_NOTARY_URL: 'http://127.0.0.1:1',
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/notary challenge endpoint unreachable/);
      expect(r.stderr).toMatch(/falling back to the self-attested check/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('successful challenge but /notarize itself 4xx → still terminal rejected (unchanged semantics)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      const bundlePath = await makeBundle(dir);
      await withServer(
        (req, res) => {
          if (req.method === 'POST' && req.url === '/notarize/challenge') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ nonce: 'nonce-456' }));
          } else if (req.method === 'POST' && req.url === '/notarize') {
            res.writeHead(422, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'ungrounded critical' }));
          } else {
            res.writeHead(404);
            res.end();
          }
        },
        async (url, requests) => {
          const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
            CLUD_BUG_NOTARY_URL: url,
          });
          expect(r.status).toBe(0);
          expect(r.stderr).toMatch(/notary declined the bundle/);
          expect(r.stdout).not.toMatch(/notarized/);
          const notarizeReq = requests.find((x) => x.url === '/notarize');
          expect(notarizeReq).toBeTruthy();
          expect(notarizeReq.body.nonce).toBe('nonce-456');
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pr-less bundle → self-attest fallback; never contacts the notary at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-notary-'));
    try {
      // JSON.stringify drops `pr: undefined`, so the bundle has no PR — a
      // commit-trigger local pre-notarization the notary can't certify.
      const bundlePath = await makeBundle(dir, { pr: undefined });
      await withServer(
        (req, res) => {
          res.writeHead(500);
          res.end();
        },
        async (url, requests) => {
          const r = await run(dir, ['post-check-run', '--sha', 'deadbeefcafefeed0000', '--bundle', bundlePath], {
            CLUD_BUG_NOTARY_URL: url,
          });
          expect(r.status).toBe(0);
          expect(r.stderr).toMatch(/no PR/);
          expect(r.stdout).not.toMatch(/notarized/);
          // Neither the challenge nor the notarize endpoint was ever hit.
          expect(requests.length).toBe(0);
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
