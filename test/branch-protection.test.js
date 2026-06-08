import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  detectRepo,
  detectDefaultBranch,
  getProtectionState,
  enableConversationResolution,
} from '../lib/branch-protection.js';

// Tiny mock factory for the injectable `gh` invoker. Returns a fn that
// matches arg patterns to canned responses, so tests stay focused on
// one branch at a time.
function mockGh(routes) {
  return async (args) => {
    const key = args.join(' ');
    for (const [pattern, response] of routes) {
      const re = pattern instanceof RegExp ? pattern : new RegExp(`^${pattern}$`);
      if (re.test(key)) return response;
    }
    throw new Error(`mockGh: no route for "${key}"`);
  };
}

test('detectRepo: parses owner/repo from gh repo view JSON', async () => {
  const gh = mockGh([
    [/^repo view --json owner,name$/, { code: 0, stdout: JSON.stringify({ owner: { login: 'octo' }, name: 'demo' }), stderr: '' }],
  ]);
  const r = await detectRepo({ gh });
  assert.deepEqual(r, { owner: 'octo', repo: 'demo' });
});

test('detectRepo: rejects when gh fails', async () => {
  const gh = mockGh([
    [/^repo view/, { code: 1, stdout: '', stderr: 'not authenticated' }],
  ]);
  await assert.rejects(detectRepo({ gh }), /gh repo view failed/);
});

test('detectDefaultBranch: returns trimmed branch name', async () => {
  const gh = mockGh([
    [/repos\/octo\/demo --jq \.default_branch/, { code: 0, stdout: 'main\n', stderr: '' }],
  ]);
  const branch = await detectDefaultBranch({ owner: 'octo', repo: 'demo', gh });
  assert.equal(branch, 'main');
});

test('getProtectionState: enabled when API returns true', async () => {
  const gh = mockGh([
    [/protection --jq/, { code: 0, stdout: 'true\n', stderr: '' }],
  ]);
  const s = await getProtectionState({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.deepEqual(s, { state: 'enabled' });
});

test('getProtectionState: disabled when API returns false', async () => {
  const gh = mockGh([
    [/protection --jq/, { code: 0, stdout: 'false\n', stderr: '' }],
  ]);
  const s = await getProtectionState({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.deepEqual(s, { state: 'disabled' });
});

test('getProtectionState: no-protection on 404 ("Branch not protected")', async () => {
  const gh = mockGh([
    [/protection --jq/, { code: 1, stdout: '', stderr: 'gh: Branch not protected (HTTP 404)' }],
  ]);
  const s = await getProtectionState({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.deepEqual(s, { state: 'no-protection' });
});

test('getProtectionState: forbidden on 403', async () => {
  const gh = mockGh([
    [/protection --jq/, { code: 1, stdout: '', stderr: 'gh: 403 Forbidden — Resource not accessible by integration' }],
  ]);
  const s = await getProtectionState({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.deepEqual(s, { state: 'forbidden' });
});

test('getProtectionState: unrelated message containing "administrator" stays unknown (regex precision)', async () => {
  // Regression: the prior regex used `/admin/i` which matched any token
  // containing "admin". Now we key only on 403/Forbidden/Resource not
  // accessible so an error like "Contact your administrator@example.com"
  // doesn't get misclassified as a permission failure.
  const gh = mockGh([
    [/protection --jq/, { code: 1, stdout: '', stderr: 'something failed. Contact administrator@example.com.' }],
  ]);
  const s = await getProtectionState({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.equal(s.state, 'unknown');
});

test('getProtectionState: unknown on any other error', async () => {
  const gh = mockGh([
    [/protection --jq/, { code: 1, stdout: '', stderr: '503 server error' }],
  ]);
  const s = await getProtectionState({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.equal(s.state, 'unknown');
  assert.match(s.reason, /503/);
});

test('enableConversationResolution: ok on 0 exit', async () => {
  const gh = mockGh([
    [/api -X POST .*required_conversation_resolution/, { code: 0, stdout: '{}', stderr: '' }],
  ]);
  const r = await enableConversationResolution({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.deepEqual(r, { ok: true });
});

test('enableConversationResolution: no-protection on 404', async () => {
  const gh = mockGh([
    [/api -X POST .*required_conversation_resolution/, { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }],
  ]);
  const r = await enableConversationResolution({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'no-protection');
});

test('enableConversationResolution: forbidden on 403', async () => {
  const gh = mockGh([
    [/api -X POST .*required_conversation_resolution/, { code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible by integration' }],
  ]);
  const r = await enableConversationResolution({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'forbidden');
});

test('enableConversationResolution: unknown on other error', async () => {
  const gh = mockGh([
    [/api -X POST .*required_conversation_resolution/, { code: 1, stdout: '', stderr: 'connection reset by peer' }],
  ]);
  const r = await enableConversationResolution({ owner: 'o', repo: 'r', branch: 'main', gh });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'unknown');
  assert.match(r.reason, /connection reset/);
});
