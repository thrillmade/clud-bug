// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives the polling PR (module.mjs) and checks the invariant it advertises: a
// resource that becomes ready within the network budget is reported done.
//
// The whole point of pollUntilDone is to poll a not-yet-ready resource until it
// flips ready. Here the resource becomes ready after 3s of elapsed time —
// comfortably inside any sane network budget. A caller that does NOT pass an
// explicit timeout must still find it, because inheriting the config default is
// the intended default path.

import { waitForReady } from './module.mjs';
import { NETWORK } from './config.mjs';

const resource = { id: 'job-42', readyAtMs: 3000 };

// CONTROL: with an explicit, positive budget the poller works fine — proving the
// loop logic itself is correct. The defect is purely the inherited default, not
// any single line of module.mjs.
const control = waitForReady(resource, { timeoutMs: 30000 });

// SUBJECT: the default path — the caller inherits NETWORK.requestTimeoutMs.
const outcome = waitForReady(resource);

console.log('config requestTimeoutMs (inherited default):', NETWORK.requestTimeoutMs);
console.log('control (explicit 30s budget):', JSON.stringify(control));
console.log('subject (inherited default) :', JSON.stringify(outcome));

// Invariant: a resource ready after 3s must be found on the default path.
const holds = outcome.done === true && outcome.value === 'job-42';

if (!holds) {
  console.error(
    '\nBUG CONFIRMED: a resource ready after 3s was never found on the default ' +
      'path (' +
      outcome.attempts +
      ' probes, reason=' +
      outcome.reason +
      '). pollUntilDone inherits NETWORK.requestTimeoutMs as a literal budget, ' +
      'but that constant defaults to 0 — a SENTINEL meaning "no client-side cap / ' +
      'wait indefinitely" (transport.mjs handles it with `if (timeoutMs > 0)`). ' +
      'The new poller does raw arithmetic `start + 0`, collapsing the deadline to ' +
      'the start instant, so it gives up before the first probe. The control with ' +
      'an explicit 30s budget returned ' +
      JSON.stringify(control) +
      ', proving the loop logic is fine and the fault is the config default.',
  );
  process.exit(1);
}

console.log('\nok: invariant holds');
process.exit(0);
