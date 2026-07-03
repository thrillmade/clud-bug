// reproduce.mjs — drives b8-emergent-float-accumulate.
//
// Invariant under test: a payment that exactly equals the sum of all invoices
// must settle EVERY invoice and leave a zero balance. Equivalently, doing the
// allocation in binary-float dollars must give the SAME result as doing it in
// exact integer cents. The module carries money as floats and accumulates it,
// so the running balance drifts a sub-cent below the true cents balance — no
// single subtraction is wrong, but by the last invoice the drift is enough to
// trip the "can I cover this?" guard and strand an invoice the customer paid.
//
// A good reviewer runs this and watches the exact-payment invariant break.

import { applyPayment } from "./module.mjs";

// A stack of small open invoices (subscription/itemized micro-charges).
const invoices = [
  { id: "inv-01", amount: 2.99 },
  { id: "inv-02", amount: 3.49 },
  { id: "inv-03", amount: 1.29 },
  { id: "inv-04", amount: 0.89 },
  { id: "inv-05", amount: 4.99 },
  { id: "inv-06", amount: 1.99 },
  { id: "inv-07", amount: 2.49 },
  { id: "inv-08", amount: 3.99 },
  { id: "inv-09", amount: 0.99 },
  { id: "inv-10", amount: 5.49 },
  { id: "inv-11", amount: 1.79 },
  { id: "inv-12", amount: 2.29 },
  { id: "inv-13", amount: 0.59 },
  { id: "inv-14", amount: 3.19 },
  { id: "inv-15", amount: 1.49 },
];

// The customer pays EXACTLY what they owe — computed the honest way, in cents.
const totalCents = invoices.reduce((c, inv) => c + Math.round(inv.amount * 100), 0);
const payment = totalCents / 100;

// Reference allocation done entirely in integer cents (never loses a cent).
function referenceAllocation() {
  let remaining = totalCents;
  const cleared = [];
  for (const inv of invoices) {
    const c = Math.round(inv.amount * 100);
    if (remaining < c) break;
    remaining -= c;
    cleared.push(inv.id);
  }
  return { cleared, remainingCents: remaining };
}

const ref = referenceAllocation();
const got = applyPayment(payment, invoices);

const reasons = [];

// (a) Every invoice the exact-cents math clears must also be cleared here.
if (got.cleared.length !== ref.cleared.length) {
  const missed = invoices
    .slice(got.cleared.length)
    .map((inv) => inv.id)
    .join(", ");
  reasons.push(
    `paid the exact total ($${payment.toFixed(2)}) but only ${got.cleared.length}/${invoices.length} invoices cleared` +
      ` (integer-cents reference clears all ${ref.cleared.length}); stranded: ${missed}`
  );
}

// (b) No phantom balance may survive an exact payment.
if (got.remaining !== 0) {
  reasons.push(
    `exact payment left a phantom balance of $${got.remaining.toFixed(2)} (raw ${got.remaining}); should be $0.00`
  );
}

// (c) The exact-payment invariant itself.
if (!got.fullyCleared) {
  reasons.push(`fullyCleared is false after paying the exact amount owed`);
}

if (reasons.length > 0) {
  console.log(
    "BUG CONFIRMED: money is accumulated as binary floats, so the running balance diverges from the true cents balance — an exact payment fails to settle every invoice."
  );
  for (const r of reasons) console.log("  - " + r);
  process.exit(1);
} else {
  console.log("ok: invariant holds");
  process.exit(0);
}
