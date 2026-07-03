// reproduce.mjs — run with `node reproduce.mjs`.
//
// This scenario is a CLEAN DECOY: the code is correct. This script exercises
// the exact inputs a real async race would corrupt — a batch of read-modify-
// write ops on a shared balance, fired without awaiting between dispatches —
// and confirms the serialization invariants hold. If the mutex were removed
// (naive concurrent version), every op would read the SAME stale balance and
// the last write would win; these assertions would then fail. They do not.

import { createLedger } from './module.mjs';

let failed = false;
function check(label, cond, detail) {
  if (!cond) {
    failed = true;
    console.log(`BUG: [${label}] ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Case A — lost-update stress. 200 deposits of +1 from an empty ledger, all
// dispatched "at once". Serialized => final balance is exactly 200. A naive
// concurrent version reads balance=0 in every op and writes 1 => final 1.
// ---------------------------------------------------------------------------
{
  const ledger = createLedger(0);
  const ops = Array.from({ length: 200 }, () => ({ type: 'deposit', amount: 1 }));
  const results = await ledger.applyAll(ops);

  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const final = ledger.getBalance();
  console.log(`Case A: ${fulfilled}/200 ops fulfilled, final balance = ${final}`);
  check('A/final', final === 200, `expected final balance 200, got ${final}`);
  check('A/count', fulfilled === 200, `expected 200 fulfilled, got ${fulfilled}`);
}

// ---------------------------------------------------------------------------
// Case B — TOCTOU overdraft guard. Balance 50, then two withdrawals of 40
// fired together. Serialized => the first succeeds (balance 10), the second's
// `b < amount` guard trips (10 < 40) and it rejects. A racy check-then-act
// would let BOTH pass the guard and debit past zero.
// ---------------------------------------------------------------------------
{
  const ledger = createLedger(50);
  const results = await ledger.applyAll([
    { type: 'withdraw', amount: 40 },
    { type: 'withdraw', amount: 40 },
  ]);

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  const final = ledger.getBalance();
  console.log(
    `Case B: ${ok} succeeded, ${rejected} rejected, final balance = ${final}`
  );
  check('B/final', final === 10, `expected final balance 10, got ${final}`);
  check('B/succeeded', ok === 1, `expected exactly 1 success, got ${ok}`);
  check('B/rejected', rejected === 1, `expected exactly 1 rejection, got ${rejected}`);
  check('B/nonneg', final >= 0, `balance went negative: ${final}`);
}

// ---------------------------------------------------------------------------
// Case C — interleaved deposits and withdrawals. Balance 100, then 100 pairs
// of (+10, -10) fired together. Serialized => net 0, so final is 100 and the
// balance never dips below zero (so no withdrawal ever rejects). A racy run
// would lose updates and land on some stale ±10 value.
// ---------------------------------------------------------------------------
{
  const ledger = createLedger(100);
  const ops = [];
  for (let i = 0; i < 100; i++) {
    ops.push({ type: 'deposit', amount: 10 });
    ops.push({ type: 'withdraw', amount: 10 });
  }
  const results = await ledger.applyAll(ops);

  const rejected = results.filter((r) => r.status === 'rejected').length;
  const final = ledger.getBalance();
  console.log(`Case C: ${rejected} rejected, final balance = ${final}`);
  check('C/final', final === 100, `expected final balance 100, got ${final}`);
  check('C/norejections', rejected === 0, `expected 0 rejections, got ${rejected}`);
}

if (failed) {
  console.error(
    '\nUNEXPECTED: a serialization invariant was violated — ops interleaved on ' +
      'the shared balance (lost update or TOCTOU overdraft). If you see this, ' +
      'the decoy has regressed into a real bug.'
  );
  process.exit(1);
}

console.log('\nok: invariant holds');
process.exit(0);
