// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives the routing compiler (module.mjs) and checks the load-bearing SPEC
// contract: expandRule(rule) ALWAYS returns an array of specs.
//
// The defect is combinatorial — it needs TWO conditions to combine:
//   (shared helper)  `collapse` unwraps a one-item list into a BARE element.
//                    That is correct for resolveDefault (single-spec contract),
//                    so the helper itself is never wrong in isolation.
//   (single-element input)  a rule with EXACTLY ONE known channel makes
//                    expandRule build a one-item `specs` list, so `collapse`
//                    unwraps it and expandRule returns a bare {event, channel}
//                    object instead of an array — silently breaking its own
//                    array contract and the caller that iterates it.
// Either condition alone is fine: multi-/zero-channel rules stay arrays, and the
// same helper is perfectly correct where a single value IS the contract.

import { expandRule, buildDeliveryPlan } from './module.mjs';

// Sanity: a rule with two known channels — expandRule must (and does) return an array.
const two = expandRule({ event: 'deploy', channels: ['email', 'sms'] });

// Trigger: a rule with EXACTLY ONE known channel.
const oneChannelRule = { event: 'signup', channels: ['email'] };
const single = expandRule(oneChannelRule);

console.log('expandRule(2 channels) ->', JSON.stringify(two));
console.log('expandRule(1 channel)  ->', JSON.stringify(single));

// SPEC contract: expandRule ALWAYS returns an array of specs.
if (!Array.isArray(single)) {
  // Corroborate with the real downstream break: buildDeliveryPlan iterates the
  // per-rule specs, so a bare object makes `for...of` throw (not iterable).
  let callerBreak = 'expected an iterable of specs';
  try {
    buildDeliveryPlan([oneChannelRule]);
  } catch (err) {
    callerBreak = `${err.name}: ${err.message}`;
  }

  console.error(
    `\nBUG CONFIRMED: expandRule violated its array contract — for a rule with ` +
      `exactly one known channel it returned a BARE spec ${JSON.stringify(single)} ` +
      `instead of a one-element array. The shared \`collapse\` helper unwraps a ` +
      `singleton list (right for resolveDefault's single-spec contract, wrong for ` +
      `expandRule's array contract), so the divergence only surfaces on the ` +
      `single-known-channel branch. Downstream buildDeliveryPlan then breaks: ` +
      `${callerBreak}.`
  );
  process.exit(1);
}

// If the contract holds, the plan builder must also run cleanly and count right.
const plan = buildDeliveryPlan([oneChannelRule, { event: 'deploy', channels: ['email', 'sms'] }]);
console.log('delivery plan ->', JSON.stringify(plan));

console.log('\nok: invariant holds (expandRule always returns an array of specs)');
process.exit(0);
