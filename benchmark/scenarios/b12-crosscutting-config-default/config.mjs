// config.mjs — PRE-EXISTING shared network constants. NOT part of the PR diff.
// The bucketing/polling change only *reads* these knobs; a line-local reviewer
// of the PR never opens this file.
//
// `requestTimeoutMs` follows the long-standing transport convention: a value of
// 0 is a SENTINEL meaning "no client-side timeout" — omit it and let the
// underlying socket/fetch impose its own hard cap. That is why the default is 0
// rather than some arbitrary number: the original transport (see transport.mjs)
// interprets 0 as "disabled" and simply leaves the timeout off, which is the
// correct, battle-tested behavior for a long-lived streaming request. Under
// that consumer the default is exactly right, so nobody thinks to question it.
export const NETWORK = {
  // 0 = disabled: no client-side cap, rely on the transport. See transport.mjs.
  requestTimeoutMs: 0,
  // Delay between successive status polls, in ms.
  pollStepMs: 1000,
  // Max concurrent in-flight requests.
  maxConcurrency: 6,
};
