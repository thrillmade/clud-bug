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
  loadPreset,
  CANONICAL_REPO_CONVENIENCES,
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
function makeOctokitMock({ rulesets = [], repoSettings } = {}) {
  const state = {
    rulesets: rulesets.map((r) => structuredClone(r)),
    // Default to the canonical conveniences so the ruleset-focused tests stay
    // no-ops on the repo-settings path; pass `repoSettings` to drift fields.
    repoSettings: { ...CANONICAL_REPO_CONVENIENCES, ...(repoSettings ?? {}) },
    nextId: 1000,
  };
  const calls = {
    get: 0,
    update: 0,
    getRepoRulesets: 0,
    getRepoRuleset: 0,
    createRepoRuleset: 0,
    updateRepoRuleset: 0,
    lastCreatePayload: null,
    lastUpdatePayload: null,
    lastRepoPatch: null,
  };

  return {
    state,
    calls,
    octokit: {
      repos: {
        // Repo-level conveniences (universal hygiene) — GET/PATCH pair.
        async get() {
          calls.get++;
          return { data: structuredClone(state.repoSettings) };
        },
        async update({ owner, repo, ...patch }) {
          calls.update++;
          calls.lastRepoPatch = patch;
          Object.assign(state.repoSettings, patch);
          return {};
        },
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

// A full canonical ruleset object matching the vendored skdd preset
// (data/rulesets/skdd.json). Used to seed the mock's "already-canonical"
// state. Kept inline (not derived from loadPreset) so the test also documents
// the NORMATIVE contract: the ruleset is named `reporulez-default` (vendored
// from reporulez), 0 approvals, clud-bug-review as a required check, empty
// bypass_actors (repo extras are preserved as a superset on PUT).
function canonicalRuleset(overrides = {}) {
  return {
    id: 42,
    name: 'reporulez-default',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [],
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
// loadPreset / loadCanonicalV1 (vendored-from-reporulez presets)
// ---------------------------------------------------------------------------

test('loadCanonicalV1: back-compat alias resolves the DEFAULT skdd preset', async () => {
  const ruleset = await loadCanonicalV1();
  const skdd = await loadPreset('skdd');
  // Alias returns the same memoized object as the skdd preset.
  assert.equal(ruleset, skdd);
  assert.equal(ruleset.name, 'reporulez-default');
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  // 0 approvals — the clud-bug-review CHECK is the gate (SPEC §7.2.1).
  const pr = ruleOf(ruleset.rules, 'pull_request');
  assert.equal(pr.parameters.required_approving_review_count, 0);
  assert.equal(pr.parameters.required_review_thread_resolution, true);
  // The four canonical skdd contexts (order-agnostic; the `test` context is gone).
  assert.deepEqual(contextsOf(ruleset.rules).sort(), [
    'check-decisions',
    'check-derived-docs',
    'check-links',
    'clud-bug-review',
  ]);
});

test('loadCanonicalV1: result is memoized (same object on second call)', async () => {
  const a = await loadCanonicalV1();
  const b = await loadCanonicalV1();
  assert.equal(a, b);
});

test('loadPreset: baseline = structural hygiene only (no required checks)', async () => {
  const baseline = await loadPreset('baseline');
  assert.equal(baseline.name, 'reporulez-default');
  assert.deepEqual(baseline.bypass_actors, []);
  assert.equal(ruleOf(baseline.rules, 'required_status_checks'), undefined);
  assert.equal(
    ruleOf(baseline.rules, 'pull_request').parameters
      .required_approving_review_count,
    0,
  );
  // Structural rules present.
  for (const t of ['deletion', 'non_fast_forward', 'required_linear_history']) {
    assert.ok(ruleOf(baseline.rules, t), `expected ${t} rule`);
  }
});

test('loadPreset: clud-bug = baseline + the single clud-bug-review check', async () => {
  const cludbug = await loadPreset('clud-bug');
  assert.deepEqual(contextsOf(cludbug.rules), ['clud-bug-review']);
});

test('loadPreset: skdd = clud-bug + the SkDD derived-docs checks', async () => {
  const skdd = await loadPreset('skdd');
  const ctx = contextsOf(skdd.rules).sort();
  assert.deepEqual(ctx, [
    'check-decisions',
    'check-derived-docs',
    'check-links',
    'clud-bug-review',
  ]);
});

test('loadPreset: public-guard = 1 approval + code-owner + last-push, no checks', async () => {
  const guard = await loadPreset('public-guard');
  const pr = ruleOf(guard.rules, 'pull_request');
  assert.equal(pr.parameters.required_approving_review_count, 1);
  assert.equal(pr.parameters.require_code_owner_review, true);
  assert.equal(pr.parameters.require_last_push_approval, true);
  assert.equal(ruleOf(guard.rules, 'required_status_checks'), undefined);
});

test('loadPreset: unknown preset name throws', async () => {
  await assert.rejects(loadPreset('nope'), /unknown preset/);
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
  assert.equal(payload.name, 'reporulez-default');
  assert.equal(payload.target, 'branch');
  assert.equal(payload.enforcement, 'active');
  assert.deepEqual(payload.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(payload.bypass_actors, []);
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
// applyCanonicalRuleset: repo conveniences (universal hygiene, all presets)
// ---------------------------------------------------------------------------

test('apply: repo-conveniences drift → repos.update PATCHes the delta', async () => {
  // Ruleset already canonical; only the repo-level settings drifted.
  const { octokit, calls } = makeOctokitMock({
    rulesets: [canonicalRuleset()],
    repoSettings: {
      delete_branch_on_merge: false,
      allow_merge_commit: true,
      allow_rebase_merge: true,
      squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
    },
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  // Conveniences are reported (they precede the ruleset in the change list).
  assert.ok(
    result.changes.some((c) => /delete_branch_on_merge: false → true/.test(c)),
    `expected delete_branch_on_merge diff; got: ${result.changes.join(' | ')}`,
  );
  assert.ok(result.changes.some((c) => /allow_merge_commit: true → false/.test(c)));
  assert.ok(result.changes.some((c) => /allow_rebase_merge: true → false/.test(c)));
  assert.ok(
    result.changes.some((c) =>
      /squash_merge_commit_title: COMMIT_OR_PR_TITLE → PR_TITLE/.test(c),
    ),
  );
  // Exactly one repos.update (PATCH) carrying the converged conveniences.
  assert.equal(calls.update, 1);
  assert.equal(calls.lastRepoPatch.delete_branch_on_merge, true);
  assert.equal(calls.lastRepoPatch.allow_merge_commit, false);
  assert.equal(calls.lastRepoPatch.allow_rebase_merge, false);
  assert.equal(calls.lastRepoPatch.squash_merge_commit_title, 'PR_TITLE');
  // Ruleset already canonical → no ruleset write.
  assert.equal(calls.createRepoRuleset, 0);
  assert.equal(calls.updateRepoRuleset, 0);
});

test('apply: conveniences are idempotent — canonical repo settings → no repos.update', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [canonicalRuleset()] });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, true);
  assert.equal(calls.update, 0);
  assert.equal(calls.updateRepoRuleset, 0);
});

test('apply: conveniences fire for EVERY preset (baseline included)', async () => {
  const { octokit, calls } = makeOctokitMock({
    rulesets: [],
    repoSettings: { allow_squash_merge: false },
  });
  await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    preset: 'baseline',
  });
  // baseline still gets the universal repo hygiene PATCH.
  assert.equal(calls.update, 1);
  assert.equal(calls.lastRepoPatch.allow_squash_merge, true);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: preset selection
// ---------------------------------------------------------------------------

test('apply: default preset is skdd (four canonical contexts)', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  await applyCanonicalRuleset(octokit, { owner: 'octo', repo: 'demo' });
  assert.equal(calls.createRepoRuleset, 1);
  assert.deepEqual(contextsOf(calls.lastCreatePayload.rules).sort(), [
    'check-decisions',
    'check-derived-docs',
    'check-links',
    'clud-bug-review',
  ]);
});

test('apply: --preset clud-bug creates the single-check variant', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    preset: 'clud-bug',
  });
  assert.deepEqual(contextsOf(calls.lastCreatePayload.rules), ['clud-bug-review']);
});

test('apply: --preset public-guard creates the 1-approval variant (no checks)', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    preset: 'public-guard',
  });
  const pr = ruleOf(calls.lastCreatePayload.rules, 'pull_request');
  assert.equal(pr.parameters.required_approving_review_count, 1);
  assert.equal(pr.parameters.require_code_owner_review, true);
  assert.equal(
    ruleOf(calls.lastCreatePayload.rules, 'required_status_checks'),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: error propagation
// ---------------------------------------------------------------------------

test('apply: transport error from getRepoRulesets bubbles up', async () => {
  const octokit = {
    repos: {
      // Conveniences read succeeds; the ruleset list is what 403s.
      async get() {
        return { data: {} };
      },
      async update() {
        throw new Error('should not be called');
      },
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

test('runConfigureGithub: invalid --preset → exit 2 (usage error, no network)', async () => {
  let stderrBuf = '';
  const code = await runConfigureGithub({
    target: 'octo/demo',
    preset: 'bogus',
    resolveToken: async () => {
      throw new Error('token resolution should not run');
    },
    octokitFactory: () => {
      throw new Error('should not be called');
    },
    stdout: () => {},
    stderr: (m) => {
      stderrBuf += m;
    },
  });
  assert.equal(code, 2);
  assert.match(stderrBuf, /unknown preset "bogus"/);
});

test('runConfigureGithub: default preset (skdd) surfaces in the summary', async () => {
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
  assert.match(stdoutBuf, /preset: skdd/);
});

test('runConfigureGithub: --preset public-guard is threaded to the applier', async () => {
  const { octokit, calls } = makeOctokitMock({ rulesets: [] });
  const code = await runConfigureGithub({
    target: 'octo/demo',
    preset: 'public-guard',
    quiet: true,
    resolveToken: async () => 'token',
    octokitFactory: () => octokit,
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.equal(calls.createRepoRuleset, 1);
  const pr = ruleOf(calls.lastCreatePayload.rules, 'pull_request');
  assert.equal(pr.parameters.required_approving_review_count, 1);
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
