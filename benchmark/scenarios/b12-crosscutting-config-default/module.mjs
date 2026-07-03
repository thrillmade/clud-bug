// module.mjs — THIS is the "PR under review": a new client-side polling helper.
//
// Product wants a "wait until the job is ready" helper. It polls a status
// callback every pollStepMs until the job reports done, and gives up once the
// request budget is exhausted so we never hang forever. Callers that don't pass
// an explicit budget inherit the standard network default from config — the
// same knob every other network call already uses.
//
// Reviewed line-by-line, every line below is individually correct: we read the
// standard step and budget from config, compute a deadline, poll on a fixed
// step, and return done/attempts/reason. Nothing here looks wrong on its own —
// `deadline = start + budgetMs` is textbook. The defect is that the inherited
// default (config.NETWORK.requestTimeoutMs) is a 0-means-infinite SENTINEL, and
// this arithmetic silently treats that 0 as a literal zero-length budget.

import { NETWORK } from './config.mjs';

// Poll `check(elapsedMs)` until it returns { done: true, value }, or until the
// budget is used up. The clock is injectable for deterministic tests. Returns
// the outcome plus how many times we actually probed the status.
export function pollUntilDone(check, opts = {}) {
  const stepMs = opts.pollStepMs ?? NETWORK.pollStepMs;
  const budgetMs = opts.timeoutMs ?? NETWORK.requestTimeoutMs;
  const clock = opts.clock ?? Date.now;

  const start = clock();
  const deadline = start + budgetMs;

  let attempts = 0;
  for (let t = start; t < deadline; t += stepMs) {
    attempts++;
    const res = check(t - start);
    if (res && res.done) {
      return { done: true, attempts, value: res.value };
    }
  }
  return { done: false, attempts, reason: 'budget-exhausted' };
}

// Convenience wrapper: wait for a resource that becomes ready after
// `readyAtMs` of elapsed time. Thin shim over pollUntilDone for callers/tests.
export function waitForReady(resource, opts = {}) {
  return pollUntilDone(
    (elapsed) =>
      elapsed >= resource.readyAtMs ? { done: true, value: resource.id } : null,
    opts,
  );
}
