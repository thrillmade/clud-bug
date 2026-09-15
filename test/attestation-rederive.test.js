// #266 — the boundary rule: §4.4:965, "A notary MUST read it from the check
// itself, and MUST NOT accept one handed over by the reviewing party."
//
// The reviewing agent assembles the bundle, so anything it writes into
// `attestation` is the party-under-check reporting on itself. `post-check-run`
// therefore DELETES whatever the artifact carried and re-derives the field from
// the harness's own store before submitting. These tests drive the real
// compiled CLI against a throwaway notary, with a real `git init` repo so
// `--git-common-dir` and `HEAD` resolve the way they do in the field.

import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

import { ATTEST_FILE } from '../src/cli/hooks.js';
import { ATTESTATION_SCHEMA } from '../src/core/attestation.js';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'clud-bug.js');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'clud-bug-rederive-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

/** Write the store the harness hooks would have written for `sha`. */
async function seedStore(dir, sha, agents = ['agent-1']) {
  const rows = [];
  for (const id of agents) {
    rows.push({
      schema: ATTESTATION_SCHEMA, phase: 'dispatch', agent_id: id, role: 'clud-bug-reviewer',
      resolved_model: 'claude-opus-5', effort: 'xhigh', effort_scope: 'hook-context',
      dispatch_ref: `toolu_${id}`, session_id: 's1', lens_label: 'Refute-first', head_sha: sha,
    });
    rows.push({
      schema: ATTESTATION_SCHEMA, phase: 'completed', agent_id: id, role: 'clud-bug-reviewer',
      effort: 'xhigh', effort_scope: 'hook-context', session_id: 's1', head_sha: sha,
    });
  }
  await writeFile(join(dir, '.git', ATTEST_FILE), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function run(cwd, args, env = {}, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function withNotary(fn) {
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
      requests.push({ url: req.url, body });
      res.on('finish', () => req.socket.destroy());
      if (req.url === '/notarize/challenge') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ nonce: 'nonce-123' }));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
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

describe('#266 post-check-run re-derives the attestation at the boundary (§4.4:965)', () => {
  it('discards a hand-forged attestation and submits the harness store instead', async () => {
    const dir = await makeRepo();
    const sha = git(dir, ['rev-parse', 'HEAD']);
    await seedStore(dir, sha, ['agent-1']);
    const bundlePath = join(dir, 'bundle.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        bundle_version: 2, repo: 'o/r', pr: 7, head_sha: sha, verdict: 'clean',
        findings: [], coverage: [], recipe_version: 'test',
        attestation: {
          schema: ATTESTATION_SCHEMA,
          truncated: false,
          records: [
            { schema: ATTESTATION_SCHEMA, phase: 'completed', agent_id: 'forged-1', role: 'clud-bug-reviewer', resolved_model: 'claude-opus-5', head_sha: sha },
            { schema: ATTESTATION_SCHEMA, phase: 'completed', agent_id: 'forged-2', role: 'clud-bug-reviewer', resolved_model: 'claude-opus-5', head_sha: sha },
          ],
        },
      }),
    );

    await withNotary(async (url, requests) => {
      const r = await run(dir, ['post-check-run', '--sha', sha, '--bundle', bundlePath], {
        CLUD_BUG_NOTARY_URL: url,
      });
      expect(r.status).toBe(0);
      const submitted = requests.find((q) => q.url === '/notarize');
      expect(submitted).toBeTruthy();
      const ids = submitted.body.attestation.records.map((x) => x.agent_id);
      expect(ids).toEqual(['agent-1']);
      expect(ids).not.toContain('forged-1');
    });
  });

  it('a bundle whose store is empty submits NO attestation rather than the forged one', async () => {
    const dir = await makeRepo();
    const sha = git(dir, ['rev-parse', 'HEAD']);
    const bundlePath = join(dir, 'bundle.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        bundle_version: 2, repo: 'o/r', pr: 7, head_sha: sha, verdict: 'clean',
        findings: [], coverage: [], recipe_version: 'test',
        attestation: {
          schema: ATTESTATION_SCHEMA, truncated: false,
          records: [{ schema: ATTESTATION_SCHEMA, phase: 'completed', agent_id: 'forged-1', role: 'clud-bug-reviewer', resolved_model: 'm', head_sha: sha }],
        },
      }),
    );

    await withNotary(async (url, requests) => {
      const r = await run(dir, ['post-check-run', '--sha', sha, '--bundle', bundlePath], {
        CLUD_BUG_NOTARY_URL: url,
      });
      expect(r.status).toBe(0);
      const submitted = requests.find((q) => q.url === '/notarize');
      // §4.4:953 — absence is reported as absence, never as the forged claim.
      expect(submitted.body.attestation.records).toEqual([]);
      // …and never as an independence identifier either. An empty record set is
      // also what an absent or unreadable store produces, so it cannot support
      // ANY claim about who reviewed: the field the producer emits carries the
      // records plus the two honest #266 items 1+2 facts (`store`,
      // `registration`) and nothing else (#246 owns the identifier).
      expect(Object.keys(submitted.body.attestation).sort()).toEqual([
        'records',
        'registration',
        'schema',
        'store',
        'truncated',
      ]);
      // This bundle's store was never written (`seedStore` wasn't called) —
      // that is an ABSENCE, not the same fact as a store that was read and
      // held nothing.
      expect(submitted.body.attestation.store).toBe('absent');
      // The fixture repo has no .gitignore, so both registration paths are
      // committable (item 1).
      expect(submitted.body.attestation.registration).toBe('committable');
    });
  });
});

describe('#266 build-bundle stamps the attestation from the store', () => {
  it('carries the completed records for HEAD', async () => {
    const dir = await makeRepo();
    const sha = git(dir, ['rev-parse', 'HEAD']);
    await seedStore(dir, sha, ['agent-1', 'agent-2']);
    const r = await run(
      dir,
      ['build-bundle', '--repo', 'o/r', '--pr', '7', '--sha', sha, '--recipe-version', 'test'],
      {},
      JSON.stringify({ critical_findings: [], minor_findings: [], preexisting_findings: [] }),
    );
    expect(r.status).toBe(0);
    const bundle = JSON.parse(r.stdout);
    expect(bundle.bundle_version).toBe(2);
    expect(bundle.attestation.records.map((x) => x.agent_id).sort()).toEqual(['agent-1', 'agent-2']);
  });

  it('emits an empty record set (not a missing field) when nothing reviewed this head', async () => {
    const dir = await makeRepo();
    const sha = git(dir, ['rev-parse', 'HEAD']);
    const r = await run(
      dir,
      ['build-bundle', '--repo', 'o/r', '--pr', '7', '--sha', sha, '--recipe-version', 'test'],
      {},
      JSON.stringify({ critical_findings: [] }),
    );
    expect(r.status).toBe(0);
    const bundle = JSON.parse(r.stdout);
    expect(bundle.attestation.schema).toBe(ATTESTATION_SCHEMA);
    expect(bundle.attestation.records).toEqual([]);
  });
});

describe('#266 the recipe dispatches the type the matcher filters on', () => {
  /** A repo with one installed rule skill and a 2-pass plan — the shape that
   * actually dispatches subagents. */
  async function makeMultiPassRepo() {
    const dir = await makeRepo();
    const skillsDir = join(dir, '.claude', 'skills');
    await mkdir(join(skillsDir, 'house-style'), { recursive: true });
    await writeFile(
      join(skillsDir, 'house-style', 'SKILL.md'),
      '---\nname: house-style\ndescription: House style\nkind: rule\n---\n\nKeep it tight.\n',
    );
    await writeFile(
      join(skillsDir, '.clud-bug.json'),
      JSON.stringify({
        tests: 'none',
        installed: [{ slug: 'house-style', kind: 'baseline' }],
        reviewPasses: { count: 2, mode: 'cross-check' },
      }) + '\n',
    );
    return dir;
  }

  it('review-prompt names subagent_type clud-bug-reviewer with a per-pass lens label', async () => {
    const dir = await makeMultiPassRepo();
    const r = await run(dir, ['review-prompt', '--trigger', 'pr']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('subagent_type: `clud-bug-reviewer`');
    // §4.4:957 asks for "a lens label or digest" per reviewing agent; the
    // harness records `description`, so each pass has to carry a distinct one.
    expect(r.stdout).toMatch(/description: "[^"]*pass 1 of 2"/);
    expect(r.stdout).toMatch(/description: "[^"]*pass 2 of 2"/);
  });

  it('never asks the agent to write an attestation into the bundle', async () => {
    const dir = await makeMultiPassRepo();
    const r = await run(dir, ['review-prompt', '--trigger', 'pr']);
    expect(r.status).toBe(0);
    // The bundle template the recipe prints must not carry an `attestation`
    // key: an agent that fills one in is the party under check reporting on
    // itself, and post-check-run deletes it anyway (§4.4:965).
    const fence = r.stdout.slice(r.stdout.indexOf('# bundle.json'));
    expect(fence.slice(0, 600)).not.toContain('attestation');
    // …and the recipe says so outright, so an agent does not invent the field.
    expect(r.stdout).toContain('Do not write that record yourself');
  });
});
