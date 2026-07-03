// transport.mjs — PRE-EXISTING. NOT part of the PR diff.
//
// This is the ESTABLISHED, correct consumer of NETWORK.requestTimeoutMs. It
// treats 0 as the sentinel it is: when the budget is 0, the `timeoutMs` option
// is omitted entirely so the request waits on the socket's own cap (i.e. "no
// client-side timeout"). Under this consumer the default 0 is exactly right —
// which is precisely why nobody questions the constant when a new caller starts
// reading it.
import { NETWORK } from './config.mjs';

export function buildRequestOptions(overrides = {}) {
  const timeoutMs = overrides.timeoutMs ?? NETWORK.requestTimeoutMs;
  const opts = { method: overrides.method ?? 'GET' };
  // 0 => omit the timeout entirely (rely on the transport's own hard cap).
  if (timeoutMs > 0) opts.timeoutMs = timeoutMs;
  return opts;
}
