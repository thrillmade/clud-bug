// module.mjs — THIS is the "PR under review": transfers.mjs.
//
// Context: a payments service ingests a batch of transfer instructions off an
// upstream queue. Each instruction names a source and destination account by a
// raw reference string ("ACCT-1041") plus an integer amount in cents. Before a
// transfer can touch the ledger it must be normalized: the raw references are
// resolved to canonical numeric account ids, and anything malformed is
// REJECTED so it never moves money.
//
// We reuse the existing parseAccountId() helper to resolve each reference, and
// treat a malformed reference as a rejection. Reviewed line-by-line, every line
// below is individually correct: we resolve both endpoints inside a guard, we
// accept the resolved transfers, and we divert failures into `rejected` with
// the reason. Nothing here mentions null.

import { parseAccountId } from './validate.mjs';

// Normalize a batch of raw transfer instructions. Malformed account references
// are rejected up front; only fully-resolved transfers reach `accepted`.
export function normalizeTransfers(instructions) {
  const accepted = [];
  const rejected = [];
  for (const inst of instructions) {
    try {
      // Resolve both endpoints. A malformed reference is a bad instruction and
      // must not proceed — the guard below routes it to `rejected`.
      const from = parseAccountId(inst.from);
      const to = parseAccountId(inst.to);
      accepted.push({ from, to, amount: inst.amount });
    } catch (err) {
      rejected.push({ inst, reason: String(err && err.message) });
    }
  }
  return { accepted, rejected };
}

// Apply the accepted transfers to a balances map (accountId -> cents): debit
// the source, credit the destination. Accounts default to a zero balance.
export function applyTransfers(instructions, balances = new Map()) {
  const { accepted } = normalizeTransfers(instructions);
  for (const { from, to, amount } of accepted) {
    balances.set(from, (balances.get(from) ?? 0) - amount);
    balances.set(to, (balances.get(to) ?? 0) + amount);
  }
  return balances;
}
