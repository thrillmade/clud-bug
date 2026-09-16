// Tests for src/core/notary-client.ts — the notary HTTP-client boundary
// (clud-bug#269, SPEC §6.5: "failing to answer is not the same as refusing").
// `classifyNotaryAttempt` is the ONE place that decides terminal vs. transient
// for every call site; the table below is that contract pinned per status.

import { describe, expect, it, afterEach } from 'vitest';

import {
  classifyNotaryAttempt,
  requestNotaryWithRetry,
  NOTARY_MAX_ATTEMPTS,
} from '../../src/core/notary-client.js';

describe('classifyNotaryAttempt', () => {
  const response = (status, body) => ({ kind: 'response', status, body });

  // The table clud-bug#269 rulings §2 names verbatim: 200/201, 400, 401, 409,
  // 422, 500, 502, 503 (with and without `retryable: true`), network error,
  // timeout.
  const TABLE = [
    ['200 (bare accept)', response(200, undefined), 'accepted'],
    ['201 (bare accept)', response(201, { ok: true }), 'accepted'],
    ['400 (malformed bundle — /notarize)', response(400, { error: 'malformed JSON body' }), 'terminal'],
    ['401 (spent/invalid nonce)', response(401, { error: 'invalid, spent, or expired challenge nonce' }), 'terminal'],
    ['409 (head moved — clud-bug-app#133)', response(409, { error: 'head moved', reason: 'head_moved' }), 'terminal'],
    ['422 (bundle failed ground-truth validation)', response(422, { error: 'bundle failed ground-truth validation' }), 'terminal'],
    ['500 (bare internal error)', response(500, undefined), 'transient'],
    ['502 (validated but could not post the check)', response(502, { error: 'could not post' }), 'transient'],
    ['503 without retryable (ground-truth unreachable, no body)', response(503, undefined), 'transient'],
    [
      '503 with retryable:true (clud-bug-app#133 contract)',
      response(503, { error: 'notary-unavailable', retryable: true, reason: 'ground_truth_unreachable' }),
      'transient',
    ],
    ['network error (ECONNREFUSED)', { kind: 'network-error', message: 'connect ECONNREFUSED' }, 'transient'],
    ['timeout (fetch aborts the same way as any other network failure)', { kind: 'network-error', message: 'The operation was aborted' }, 'transient'],
  ];

  it.each(TABLE)('%s → %s', (_label, outcome, expected) => {
    expect(classifyNotaryAttempt(outcome)).toBe(expected);
  });

  it('a 4xx with retryable:true is overridden to transient — the body is the authority, not the status range', () => {
    expect(classifyNotaryAttempt(response(400, { error: 'x', retryable: true }))).toBe('transient');
  });

  it('a non-object / non-boolean retryable field is not honored', () => {
    expect(classifyNotaryAttempt(response(503, { retryable: 'true' }))).toBe('transient'); // still transient — 503 alone gets there
    expect(classifyNotaryAttempt(response(400, { retryable: 'true' }))).toBe('terminal'); // string, not `true` — no override
    expect(classifyNotaryAttempt(response(400, null))).toBe('terminal');
  });
});

describe('requestNotaryWithRetry', () => {
  const ENV_KEY = 'CLUD_BUG_NOTARY_RETRY_MS';
  const originalEnv = process.env[ENV_KEY];
  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it('does not retry an accepted (2xx) attempt', async () => {
    process.env[ENV_KEY] = '0,0';
    let calls = 0;
    const result = await requestNotaryWithRetry(async () => {
      calls += 1;
      return { kind: 'response', status: 200, body: {} };
    }, classifyNotaryAttempt);
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.class).toBe('accepted');
  });

  it('does not retry a terminal (4xx) attempt', async () => {
    process.env[ENV_KEY] = '0,0';
    let calls = 0;
    const result = await requestNotaryWithRetry(async () => {
      calls += 1;
      return { kind: 'response', status: 422, body: {} };
    }, classifyNotaryAttempt);
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.class).toBe('terminal');
  });

  it('retries a transient attempt up to NOTARY_MAX_ATTEMPTS, then stops', async () => {
    process.env[ENV_KEY] = '0,0'; // zero backoff — hermetic, no real delay
    let calls = 0;
    const result = await requestNotaryWithRetry(async () => {
      calls += 1;
      return { kind: 'network-error', message: 'ECONNREFUSED' };
    }, classifyNotaryAttempt);
    expect(calls).toBe(NOTARY_MAX_ATTEMPTS);
    expect(result.attempts).toBe(NOTARY_MAX_ATTEMPTS);
    expect(result.class).toBe('transient');
  });

  it('stops retrying as soon as a later attempt is definitive', async () => {
    process.env[ENV_KEY] = '0,0';
    let calls = 0;
    const result = await requestNotaryWithRetry(async () => {
      calls += 1;
      if (calls < 2) return { kind: 'network-error', message: 'ECONNREFUSED' };
      return { kind: 'response', status: 200, body: {} };
    }, classifyNotaryAttempt);
    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.class).toBe('accepted');
  });

  it('is generic over a non-NotaryAttemptOutcome result via a caller-supplied classify (the submit-round use)', async () => {
    process.env[ENV_KEY] = '0,0';
    let calls = 0;
    const result = await requestNotaryWithRetry(
      async () => {
        calls += 1;
        return calls < 2 ? 'stale-nonce-round' : 'fresh-round-posted';
      },
      (r) => (r === 'fresh-round-posted' ? 'accepted' : 'transient'),
    );
    expect(calls).toBe(2);
    expect(result.result).toBe('fresh-round-posted');
    expect(result.class).toBe('accepted');
  });
});
