// SPEC §7 canonical-ruleset applier — v2 rulesets API.
//
// The pure half (in src/core/configure-github.ts) takes a structural
// OctokitLike instance and diffs the current ruleset vs the canonical one
// (bundled at data/canonical-v1.json). These tests mock the rulesets API to
// verify:
//   1. Fresh repo (no rulesets) → POST createRepoRuleset.
//   2. Already-canonical repo → alreadyCanonical: true, no create/update.
//   3. Partial mismatch → PUT updateRepoRuleset with exactly the delta.
//   4. Superset contracts: extra contexts + owner-raised approval floor kept.
//   5. Idempotency contract: apply(); apply() converges + no-ops the 2nd call.
//   6. CLI wrapper (src/cli/configure-github.ts): the §3.23.1 status payload.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  applyCanonicalRuleset,
  loadCanonicalV1,
} from '../../src/core/configure-github.js';
import { runConfigureGithub } from '../../src/cli/configure-github.js';

// ---------------------------------------------------------------------------
// Rulesets-API Octokit mock factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal OctokitLike mock over the rulesets API that:
 *   - records every call into `calls`
 *   - serves `state.rulesets` (full objects) from the list/get endpoints
 *   - lets create/update mutate `state.rulesets` so a subsequent apply()
 *     observes the converged ruleset (idempotency contract)
 *
 * The list endpoint returns SUMMARIES (id + name only), matching GitHub;
 * the get-by-id endpoint returns the full ruleset.
 */
function makeOctokitMock({ rulesets = [] } = {}) {
  const state = {
    rulesets: rulesets.map((r) => structuredClone(r)),
    nextId: 1000,
  };
  const calls = {
    getRepoRulesets: 0,
    getRepoRuleset: 0,
    createRepoRuleset: 0,
    updateRepoRuleset: 0,
    lastCreatePayload: null,
    lastUpdatePayload: null,
  };

  return {
    state,
    calls,
    octokit: {
      repos: {
        async getRepoRulesets() {
          calls.getRepoRulesets++;
          return {
            data: state.rulesets.map((r) => ({ id: r.id, name: r.name })),
          };
        },
        async getRepoRuleset({ ruleset_id }) {
          calls.getRepoRuleset++;
          return { data: state.rulesets.find((r) => r.id === ruleset_id) };
        },
        async createRepoRuleset({ owner, repo, ...payload }) {
          calls.createRepoRuleset++;
          calls.lastCreatePayload = payload;
          const created = { id: state.nextId++, ...payload };
          state.rulesets.push(created);
          return { data: created };
        },
        async updateRepoRuleset({ owner, repo, ruleset_id, ...payload }) {
          calls.updateRepoRuleset++;
          calls.lastUpdatePayload = { ruleset_id, ...payload };
          const idx = state.rulesets.findIndex((r) => r.id === ruleset_id);
          if (idx >= 0) state.rulesets[idx] = { id: ruleset_id, ...payload };
          return { data: state.rulesets[idx] };
        },
      },
    },
  };
}

// A full canonical ruleset object matching data/canonical-v1.json. Used to
// seed the mock's "already-canonical" state. Kept inline (not derived from
// loadCanonicalV1) so the test also documents the NORMATIVE contract:
// name skdd-canonical, 0 approvals, clud-bug-review as a required check.
function canonicalRuleset(overrides = {}) {
  return {
    id: 42,
    name: 'skdd-canonical',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [
      { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' },
    ],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      { type: 'required_linear_history' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          dismiss_stale_reviews_on_push: true,
          allowed_merge_methods: ['squash'],
        },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [
            { context: 'clud-bug-review' },
            { context: 'check-decisions' },
            { context: 'check-derived-docs' },
            { context: 'check-links' },
          ],
        },
      },
    ],
    ...overrides,
  };
}

/** Finds a rule by type in a rules array (payload or fixture). */
function ruleOf(rules, type) {
  return rules.find((r) => r.type === type);
}

/** Extracts the context strings from a required_status_checks rule. */
function contextsOf(rules) {
  const rule = ruleOf(rules, 'required_status_checks');
  return (rule?.parameters?.required_status_checks ?? []).map((c) => c.context);
}

// ---------------------------------------------------------------------------
// loadCanonicalV1
// ---------------------------------------------------------------------------

test('loadCanonicalV1: returns the v2 rulesets schema from the bundled file', async () => {
  const ruleset = await loadCanonicalV1();
  assert.equal(ruleset.version, 'v2');
  assert.equal(ruleset.name, 'skdd-canonical');
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  assert.ok(ruleset.spec_version);
  // 0 approvals — the clud-bug-review CHECK is the gate (SPEC §7.2.1).
  const pr = ruleOf(ruleset.rules, 'pull_request');
  assert.equal(pr.parameters.required_approving_review_count, 0);
  assert.equal(pr.parameters.required_review_thread_resolution, true);
  // The four canonical contexts; the universal `test` context is gone in v2.
  assert.deepEqual(contextsOf(ruleset.rules), [
    'clud-bug-review',
    'check-decisions',
    'check-derived-docs',
    'check-links',
  ]);
  // Repository-admin bypass (RepositoryRole id 5, always) — the self-mod escape hatch.
  assert.deepEqual(ruleset.bypass_actors, [
    { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' },
  ]);
});

test('loadCanonicalV1: result is memoized (same object on second call)', async () => {
  const a = await loadCanonicalV1();
  const b = await loadCanonicalV1();
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: fresh-repo path (no ruleset)
// ---------------------------------------------------------------------------

test('apply: fresh repo (no rulesets) — POSTs create, alreadyCanonical=false', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  assert.equal(result.ruleset, 'canonical-v1');
  assert.ok(result.changes.length > 0);
  assert.equal(calls.createRepoRuleset, 1);
  assert.equal(calls.updateRepoRuleset, 0);
});

test('apply: fresh repo — create payload carries the canonical contract', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  await applyCanonicalRuleset(octokit, { owner: 'octo', repo: 'demo' });
  const payload = calls.lastCreatePayload;
  assert.equal(payload.name, 'skdd-canonical');
  assert.equal(payload.target, 'branch');
  assert.equal(payload.enforcement, 'active');
  assert.deepEqual(payload.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(payload.bypass_actors, [
    { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' },
  ]);
  const pr = ruleOf(payload.rules, 'pull_request');
  assert.equal(pr.parameters.required_approving_review_count, 0);
  assert.deepEqual(pr.parameters.allowed_merge_methods, ['squash']);
  const contexts = contextsOf(payload.rules);
  assert.ok(contexts.includes('clud-bug-review'));
  assert.ok(!contexts.includes('test'));
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: already-canonical path
// ---------------------------------------------------------------------------

test('apply: already-canonical → alreadyCanonical=true, no create/update calls', async () => {
  const { octokit, calls } = makeOctokitMock({
    rulesets: [canonicalRuleset()],
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, true);
  assert.deepEqual(result.changes, []);
  assert.equal(calls.createRepoRuleset, 0);
  assert.equal(calls.updateRepoRuleset, 0);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: partial mismatch — PUT only what differs
// ---------------------------------------------------------------------------

test('apply: enforcement disabled → 1 update (PUT), reports the enforcement diff', async () => {
  const { octokit, calls } = makeOctokitMock({
    rulesets: [canonicalRuleset({ enforcement: 'disabled' })],
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  assert.ok(
    result.changes.some((c) => /enforcement: disabled → active/.test(c)),
    `expected enforcement diff; got: ${result.changes.join(' | ')}`,
  );
  assert.equal(calls.createRepoRuleset, 0);
  assert.equal(calls.updateRepoRuleset, 1);
  assert.equal(calls.lastUpdatePayload.enforcement, 'active');
});

test('apply: missing status check context — superset PUT preserves extras', async () => {
  // Repo drops the canonical "check-links" AND adds a repo-specific "lint".
  // Apply must add check-links back WITHOUT dropping lint.
  const existing = canonicalRuleset();
  existing.rules = existing.rules.map((r) =>
    r.type === 'required_status_checks'
      ? {
          ...r,
          parameters: {
            ...r.parameters,
            required_status_checks: [
              { context: 'clud-bug-review' },
              { context: 'check-decisions' },
              { context: 'check-derived-docs' },
              { context: 'lint' },
            ],
          },
        }
      : r,
  );
  const { octokit, calls } = makeOctokitMock({ rulesets: [existing] });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  assert.ok(
    result.changes.some((c) =>
      /required_status_checks: add \["check-links"\]/.test(c),
    ),
    `expected "add check-links"; got: ${result.changes.join(' | ')}`,
  );
  assert.equal(calls.updateRepoRuleset, 1);
  const merged = contextsOf(calls.lastUpdatePayload.rules);
  assert.ok(merged.includes('check-links'));
  assert.ok(merged.includes('lint'));
});

test('apply: extra status check context alone → no-op (superset preserved)', async () => {
  const existing = canonicalRuleset();
  existing.rules = existing.rules.map((r) =>
    r.type === 'required_status_checks'
      ? {
          ...r,
          parameters: {
            ...r.parameters,
            required_status_checks: [
              ...r.parameters.required_status_checks,
              { context: 'lint' },
            ],
          },
        }
      : r,
  );
  const { octokit, calls } = makeOctokitMock({ rulesets: [existing] });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, true);
  assert.equal(calls.updateRepoRuleset, 0);
});

test('apply: owner-raised required_approving_review_count is NOT lowered (floor contract)', async () => {
  const existing = canonicalRuleset();
  existing.rules = existing.rules.map((r) =>
    r.type === 'pull_request'
      ? {
          ...r,
          parameters: { ...r.parameters, required_approving_review_count: 1 },
        }
      : r,
  );
  const { octokit, calls } = makeOctokitMock({ rulesets: [existing] });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  // Canonical is 0; owner raised to 1 — leave it. No diff, no PUT.
  assert.equal(result.alreadyCanonical, true);
  assert.equal(calls.updateRepoRuleset, 0);
});

test('apply: --dry-run skips create/update but still reports changes', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    dryRun: true,
  });
  assert.equal(result.alreadyCanonical, false);
  assert.ok(result.changes.length > 0);
  assert.equal(calls.createRepoRuleset, 0);
  assert.equal(calls.updateRepoRuleset, 0);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: idempotency contract
// ---------------------------------------------------------------------------

test('apply: idempotent — apply(); apply() second call reports alreadyCanonical', async () => {
  // The mock mutates state on create, so the second call sees the converged
  // ruleset. This is the contract SPEC §3.23.1 pins.
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  const first = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(first.alreadyCanonical, false);
  const second = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(second.alreadyCanonical, true);
  assert.deepEqual(second.changes, []);
  // First call: 1 create. Second: zero additional writes.
  assert.equal(calls.createRepoRuleset, 1);
  assert.equal(calls.updateRepoRuleset, 0);
});

test('apply: respects --branch override (narrows the ref condition)', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    branch: 'develop',
  });
  assert.equal(calls.createRepoRuleset, 1);
  assert.deepEqual(calls.lastCreatePayload.conditions.ref_name.include, [
    'refs/heads/develop',
  ]);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: error propagation
// ---------------------------------------------------------------------------

test('apply: transport error from getRepoRulesets bubbles up', async () => {
  const octokit = {
    repos: {
      async getRepoRulesets() {
        const err = new Error('HTTP 403 Forbidden');
        err.status = 403;
        throw err;
      },
      async getRepoRuleset() {
        throw new Error('should not be called');
      },
      async createRepoRuleset() {
        throw new Error('should not be called');
      },
      async updateRepoRuleset() {
        throw new Error('should not be called');
      },
    },
  };
  await assert.rejects(
    applyCanonicalRuleset(octokit, { owner: 'o', repo: 'r' }),
    /403 Forbidden/,
  );
});

// ---------------------------------------------------------------------------
// CLI wrapper
// ---------------------------------------------------------------------------

test('runConfigureGithub: no token → exit 1 with recovery hint', async () => {
  let stderrBuf = '';
  const code = await runConfigureGithub({
    target: 'octo/demo',
    resolveToken: async () => null,
    octokitFactory: () => {
      throw new Error('should not be called');
    },
    stdout: () => {},
    stderr: (m) => {
      stderrBuf += m;
    },
  });
  assert.equal(code, 1);
  assert.match(stderrBuf, /no GitHub token/);
  assert.match(stderrBuf, /GITHUB_TOKEN|gh auth login/);
});

test('runConfigureGithub: missing target → exit 2 with help', async () => {
  let stderrBuf = '';
  const code = await runConfigureGithub({
    target: null,
    stdout: () => {},
    stderr: (m) => {
      stderrBuf += m;
    },
  });
  assert.equal(code, 2);
  assert.match(stderrBuf, /Usage:/);
});

test('runConfigureGithub: malformed target → exit 2', async () => {
  let stderrBuf = '';
  const code = await runConfigureGithub({
    target: 'no-slash',
    resolveToken: async () => 'token',
    stdout: () => {},
    stderr: (m) => {
      stderrBuf += m;
    },
  });
  assert.equal(code, 2);
  assert.match(stderrBuf, /owner\/repo/);
});

test('runConfigureGithub: already-canonical → exit 0 with §3.23.1 summary', async () => {
  let stdoutBuf = '';
  const { octokit } = makeOctokitMock({ rulesets: [canonicalRuleset()] });
  const code = await runConfigureGithub({
    target: 'octo/demo',
    resolveToken: async () => 'token',
    octokitFactory: () => octokit,
    quiet: true,
    stdout: (m) => {
      stdoutBuf += m;
    },
    stderr: () => {},
  });
  assert.equal(code, 0);
  // SPEC §3.23.1: the idempotent no-op MUST surface alreadyCanonical as a named field.
  assert.match(stdoutBuf, /alreadyCanonical: true/);
  assert.match(stdoutBuf, /rulesetVersion: v2/);
  assert.match(stdoutBuf, /octo/);
  assert.match(stdoutBuf, /demo/);
});

test('runConfigureGithub: already-canonical + --dry-run --json → payload reports dryRun:true', async () => {
  let stdoutBuf = '';
  const { octokit } = makeOctokitMock({ rulesets: [canonicalRuleset()] });
  const code = await runConfigureGithub({
    target: 'octo/demo',
    dryRun: true,
    json: true,
    resolveToken: async () => 'token',
    octokitFactory: () => octokit,
    quiet: true,
    stdout: (m) => {
      stdoutBuf += m;
    },
    stderr: () => {},
  });
  assert.equal(code, 0);
  const payload = JSON.parse(stdoutBuf);
  assert.equal(payload.alreadyCanonical, true);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.rulesetVersion, 'v2');
});

test('runConfigureGithub: --dry-run reports diff but skips write', async () => {
  let stdoutBuf = '';
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  const code = await runConfigureGithub({
    target: 'octo/demo',
    dryRun: true,
    quiet: true,
    resolveToken: async () => 'token',
    octokitFactory: () => octokit,
    stdout: (m) => {
      stdoutBuf += m;
    },
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(calls.createRepoRuleset, 0);
  assert.equal(calls.updateRepoRuleset, 0);
  assert.match(stdoutBuf, /dry-run on octo\/demo/);
});

test('runConfigureGithub: apply path creates the ruleset + reports change count', async () => {
  let stdoutBuf = '';
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  const code = await runConfigureGithub({
    target: 'octo/demo',
    quiet: true,
    resolveToken: async () => 'token',
    octokitFactory: () => octokit,
    stdout: (m) => {
      stdoutBuf += m;
    },
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(calls.createRepoRuleset, 1);
  assert.match(stdoutBuf, /converged to canonical-v1/);
});
