// v0.7.0-rc.4 — SPEC §7 canonical-ruleset applier.
//
// The pure half (in src/core/configure-github.ts) takes a structural
// OctokitLike instance and diffs current state vs the canonical ruleset.
// These tests mock Octokit to verify:
//   1. Fresh repo (404 + zero settings) → applies all rules.
//   2. Already-canonical repo → returns alreadyCanonical: true, no PATCHes.
//   3. Partial mismatch → emits exactly the diffs that differ.
//   4. Idempotency contract: apply(); apply() converges + reports no changes
//      on the second call.
//   5. CLI wrapper (src/cli/configure-github.ts): missing token → exit 1.

import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  applyCanonicalRuleset,
  loadCanonicalV1,
} from '../../src/core/configure-github.js';
import { runConfigureGithub } from '../../src/cli/configure-github.js';

// ---------------------------------------------------------------------------
// Octokit mock factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal OctokitLike mock that:
 *   - records every call into `calls`
 *   - returns the seed state from `current` for read methods
 *   - lets write methods mutate `current` so a subsequent apply() observes
 *     the converged state (idempotency contract)
 *
 * On a fresh repo with no protection rule, pass branchProtection404=true
 * — the mock then throws a 404-shaped error from getBranchProtection.
 */
function makeOctokitMock({
  branchProtection = null,
  branchProtection404 = false,
  repoSettings = {},
} = {}) {
  const state = {
    branchProtection,
    branchProtection404,
    repoSettings: { ...repoSettings },
  };
  const calls = {
    getBranchProtection: 0,
    updateBranchProtection: 0,
    get: 0,
    update: 0,
    lastUpdateBranchProtectionPayload: null,
    lastUpdatePayload: null,
  };

  return {
    state,
    calls,
    octokit: {
      repos: {
        async getBranchProtection({ owner, repo, branch }) {
          calls.getBranchProtection++;
          if (state.branchProtection404) {
            const err = new Error('Branch not protected');
            err.status = 404;
            throw err;
          }
          return { data: state.branchProtection ?? {} };
        },
        async updateBranchProtection(params) {
          calls.updateBranchProtection++;
          calls.lastUpdateBranchProtectionPayload = params;
          // Mirror what GitHub would do after a successful PUT — write the
          // settings back so a subsequent read sees them.
          state.branchProtection404 = false;
          state.branchProtection = {
            required_status_checks: params.required_status_checks,
            required_pull_request_reviews: params.required_pull_request_reviews,
            required_conversation_resolution: {
              enabled: params.required_conversation_resolution === true,
            },
            enforce_admins: { enabled: params.enforce_admins === true },
            allow_force_pushes: { enabled: params.allow_force_pushes === true },
            allow_deletions: { enabled: params.allow_deletions === true },
            required_linear_history: {
              enabled: params.required_linear_history === true,
            },
          };
          return {};
        },
        async get({ owner, repo }) {
          calls.get++;
          return { data: state.repoSettings };
        },
        async update(params) {
          calls.update++;
          calls.lastUpdatePayload = params;
          for (const k of [
            'delete_branch_on_merge',
            'allow_auto_merge',
            'squash_merge_commit_title',
            'squash_merge_commit_message',
          ]) {
            if (params[k] !== undefined) state.repoSettings[k] = params[k];
          }
          return {};
        },
      },
    },
  };
}

// The canonical settings as bundled in data/canonical-v1.json. Inlining
// the expected end-state lets us build "already canonical" mock state
// without coupling to the file's exact contents.
const CANONICAL_BRANCH_PROTECTION_STATE = {
  required_status_checks: {
    strict: true,
    contexts: [
      'clud-bug-review',
      'check-decisions',
      'check-derived-docs',
      'check-links',
      'test',
    ],
  },
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: false,
    require_code_owner_reviews: false,
  },
  required_conversation_resolution: { enabled: true },
  enforce_admins: { enabled: false },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_linear_history: { enabled: false },
};

const CANONICAL_REPO_STATE = {
  delete_branch_on_merge: true,
  allow_auto_merge: true,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'PR_BODY',
};

// ---------------------------------------------------------------------------
// loadCanonicalV1
// ---------------------------------------------------------------------------

test('loadCanonicalV1: returns canonical-v1 schema from bundled file', async () => {
  const ruleset = await loadCanonicalV1();
  assert.equal(ruleset.version, 'v1');
  assert.ok(ruleset.spec_version);
  assert.equal(ruleset.branch_protection.required_conversation_resolution, true);
  assert.deepEqual(
    ruleset.branch_protection.required_status_checks.contexts,
    [
      'clud-bug-review',
      'check-decisions',
      'check-derived-docs',
      'check-links',
      'test',
    ],
  );
});

test('loadCanonicalV1: result is memoized (same object on second call)', async () => {
  const a = await loadCanonicalV1();
  const b = await loadCanonicalV1();
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: fresh-repo path (no protection rule)
// ---------------------------------------------------------------------------

test('apply: fresh repo (404 protection) — applies all rules, alreadyCanonical=false', async () => {
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  assert.equal(result.ruleset, 'canonical-v1');
  assert.ok(result.changes.length > 0);
  assert.equal(calls.updateBranchProtection, 1);
  assert.equal(calls.update, 1);
});

test('apply: fresh repo — branch protection PUT carries canonical settings', async () => {
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
  await applyCanonicalRuleset(octokit, { owner: 'octo', repo: 'demo' });
  const payload = calls.lastUpdateBranchProtectionPayload;
  assert.equal(payload.required_conversation_resolution, true);
  assert.equal(payload.enforce_admins, false);
  assert.equal(payload.allow_force_pushes, false);
  assert.equal(payload.allow_deletions, false);
  assert.equal(payload.required_status_checks.strict, true);
  assert.deepEqual(payload.required_status_checks.contexts.sort(), [
    'check-decisions',
    'check-derived-docs',
    'check-links',
    'clud-bug-review',
    'test',
  ]);
  assert.equal(
    payload.required_pull_request_reviews.required_approving_review_count,
    1,
  );
});

test('apply: fresh repo — repo-level PATCH carries canonical settings', async () => {
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
  await applyCanonicalRuleset(octokit, { owner: 'octo', repo: 'demo' });
  const payload = calls.lastUpdatePayload;
  assert.equal(payload.delete_branch_on_merge, true);
  assert.equal(payload.allow_auto_merge, true);
  assert.equal(payload.squash_merge_commit_title, 'PR_TITLE');
  assert.equal(payload.squash_merge_commit_message, 'PR_BODY');
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: already-canonical path
// ---------------------------------------------------------------------------

test('apply: already-canonical → alreadyCanonical=true, no PATCH calls', async () => {
  const { octokit, calls } = makeOctokitMock({
    branchProtection: CANONICAL_BRANCH_PROTECTION_STATE,
    repoSettings: CANONICAL_REPO_STATE,
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, true);
  assert.deepEqual(result.changes, []);
  assert.equal(calls.updateBranchProtection, 0);
  assert.equal(calls.update, 0);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: partial mismatch — only PATCH what differs
// ---------------------------------------------------------------------------

test('apply: partial mismatch (only delete_branch_on_merge differs) — emits 1 change + 1 repo PATCH', async () => {
  const { octokit, calls } = makeOctokitMock({
    branchProtection: CANONICAL_BRANCH_PROTECTION_STATE,
    repoSettings: { ...CANONICAL_REPO_STATE, delete_branch_on_merge: false },
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  assert.equal(result.changes.length, 1);
  assert.match(result.changes[0], /delete_branch_on_merge: false → true/);
  assert.equal(calls.updateBranchProtection, 0); // no branch-protection PATCH
  assert.equal(calls.update, 1); // one repo PATCH only
});

test('apply: missing status check contexts — superset behavior preserves extras', async () => {
  // Repo currently requires the canonical 5 contexts PLUS one extra
  // ("lint"). Canonical doesn't touch "lint" — superset contract says we
  // leave it alone. We also intentionally drop one canonical context
  // ("test") so the apply path must add it back without dropping "lint".
  const repoState = {
    ...CANONICAL_BRANCH_PROTECTION_STATE,
    required_status_checks: {
      strict: true,
      contexts: [
        'clud-bug-review',
        'check-decisions',
        'check-derived-docs',
        'check-links',
        'lint', // extra repo-specific context — must be preserved
      ],
    },
  };
  const { octokit, calls } = makeOctokitMock({
    branchProtection: repoState,
    repoSettings: CANONICAL_REPO_STATE,
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  assert.equal(result.alreadyCanonical, false);
  // One change: contexts.add ["test"]
  assert.ok(
    result.changes.some((c) =>
      /required_status_checks.contexts: add \["test"\]/.test(c),
    ),
    `expected "add test" change; got: ${result.changes.join(' | ')}`,
  );
  assert.equal(calls.updateBranchProtection, 1);
  // Verify the PUT payload preserved "lint" AND added "test"
  const payload = calls.lastUpdateBranchProtectionPayload;
  assert.ok(payload.required_status_checks.contexts.includes('lint'));
  assert.ok(payload.required_status_checks.contexts.includes('test'));
});

test('apply: higher required_approving_review_count is NOT lowered (raise-only contract)', async () => {
  const repoState = {
    ...CANONICAL_BRANCH_PROTECTION_STATE,
    required_pull_request_reviews: {
      required_approving_review_count: 2, // higher than canonical floor of 1
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
    },
  };
  const { octokit, calls } = makeOctokitMock({
    branchProtection: repoState,
    repoSettings: CANONICAL_REPO_STATE,
  });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
  });
  // Already-canonical — repo's count of 2 stays.
  assert.equal(result.alreadyCanonical, true);
  assert.equal(calls.updateBranchProtection, 0);
});

test('apply: --dry-run skips ALL PATCH calls + still reports changes', async () => {
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
  const result = await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    dryRun: true,
  });
  assert.equal(result.alreadyCanonical, false);
  assert.ok(result.changes.length > 0);
  assert.equal(calls.updateBranchProtection, 0);
  assert.equal(calls.update, 0);
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: idempotency contract
// ---------------------------------------------------------------------------

test('apply: idempotent — apply(); apply() second call reports alreadyCanonical', async () => {
  // The mock mutates state on PUT/PATCH, so a second call sees the
  // converged state. This is the contract the SPEC pins.
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
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
  // First call: 1 PUT + 1 PATCH. Second: zero additional writes.
  assert.equal(calls.updateBranchProtection, 1);
  assert.equal(calls.update, 1);
});

test('apply: respects --branch override', async () => {
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
  await applyCanonicalRuleset(octokit, {
    owner: 'octo',
    repo: 'demo',
    branch: 'develop',
  });
  assert.equal(calls.updateBranchProtection, 1);
  const payload = calls.lastUpdateBranchProtectionPayload;
  assert.equal(payload.branch, 'develop');
});

// ---------------------------------------------------------------------------
// applyCanonicalRuleset: error propagation (non-404)
// ---------------------------------------------------------------------------

test('apply: non-404 transport error from getBranchProtection bubbles up', async () => {
  const octokit = {
    repos: {
      async getBranchProtection() {
        const err = new Error('HTTP 403 Forbidden');
        err.status = 403;
        throw err;
      },
      async updateBranchProtection() {
        throw new Error('should not be called');
      },
      async get() {
        return { data: {} };
      },
      async update() {
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
// CLI wrapper: token missing → exit 1
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

test('runConfigureGithub: already-canonical → exit 0 with summary', async () => {
  let stdoutBuf = '';
  const { octokit } = makeOctokitMock({
    branchProtection: CANONICAL_BRANCH_PROTECTION_STATE,
    repoSettings: CANONICAL_REPO_STATE,
  });
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
  assert.match(stdoutBuf, /ok configure-github: octo\/demo already canonical-v1/);
});

test('runConfigureGithub: --dry-run reports diff but skips PATCH', async () => {
  let stdoutBuf = '';
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
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
  assert.equal(calls.updateBranchProtection, 0);
  assert.equal(calls.update, 0);
  assert.match(stdoutBuf, /dry-run on octo\/demo/);
});

test('runConfigureGithub: apply path PATCHes + reports change count', async () => {
  let stdoutBuf = '';
  const { octokit, calls } = makeOctokitMock({ branchProtection404: true });
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
  assert.equal(calls.updateBranchProtection, 1);
  assert.equal(calls.update, 1);
  assert.match(stdoutBuf, /converged to canonical-v1/);
});
