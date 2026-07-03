// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives the transfers PR (module.mjs) and checks the invariant it advertises:
// a transfer with a malformed account reference is REJECTED before it can move
// money — it must never reach `accepted`, and it must never touch the ledger.
//
// The PR guards its normalization with try/catch, assuming parseAccountId()
// THROWS on a malformed reference. It doesn't: parseAccountId returns `null` on
// failure (its real contract, in validate.mjs). So the catch never fires, the
// unresolved { to: null } transfer slips into `accepted`, and applyTransfers
// then debits a real account against a bogus destination.

import { normalizeTransfers, applyTransfers } from './module.mjs';

const instructions = [
  { from: 'ACCT-1000', to: 'ACCT-2000', amount: 500 }, // well-formed
  { from: 'ACCT-1000', to: 'not-an-account', amount: 900 }, // malformed dest → must be rejected
];

const { accepted, rejected } = normalizeTransfers(instructions);
console.log('accepted:', JSON.stringify(accepted));
console.log('rejected:', JSON.stringify(rejected));

// Invariant, per the PR's own contract: the malformed instruction must land in
// `rejected`, and no accepted transfer may carry a null (unresolved) endpoint.
const acceptedHasNullEndpoint = accepted.some((t) => t.from === null || t.to === null);
const malformedWasRejected = rejected.length === 1;

// Downstream harm: apply the batch to a fresh ledger and watch ACCT-1000. Its
// ONLY legitimate debit is the $5.00 well-formed transfer, so it should read
// -500 cents. If the malformed transfer sneaked through, it is debited again.
const balances = applyTransfers(instructions);
console.log('balances:', JSON.stringify([...balances.entries()]));
const acct1000 = balances.get(1000) ?? 0;

const holds = !acceptedHasNullEndpoint && malformedWasRejected && acct1000 === -500;

if (!holds) {
  console.error(
    '\nBUG CONFIRMED: the transfer with a malformed destination ("not-an-account") ' +
      'was NOT rejected. parseAccountId() returns null on failure (it does not throw), ' +
      'so the try/catch guard never fires and the unresolved { to: null } transfer ' +
      'slipped into `accepted`. applyTransfers then debited ACCT-1000 against a null ' +
      'destination: balance is ' + acct1000 + ' cents, expected -500 (rejected count ' +
      rejected.length + ', expected 1).'
  );
  process.exit(1);
}

console.log('\nok: invariant holds');
process.exit(0);
