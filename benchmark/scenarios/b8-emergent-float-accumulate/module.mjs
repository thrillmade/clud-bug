// module.mjs — the "PR under review".
//
// Accounts-receivable: a customer sends ONE payment to clear a stack of open
// invoices, oldest first. We walk the invoices, and for each one we can still
// fully cover out of what's left of the payment, we mark it cleared and draw
// the running balance down by that invoice's amount. Whatever is left over is
// the customer's remaining balance.
//
// Amounts are plain 2-decimal dollar figures (what the customer sees on the
// statement). Every line below is individually reasonable — a plain sum, a
// "can I cover this?" guard, an ordinary subtraction, a leftover check. The
// defect is emergent: it only shows up once you accumulate many amounts and
// ask whether the running dollar balance still equals the true cents balance.

/**
 * Total currently due across a set of invoices, in dollars.
 * @param {{ id: string, amount: number }[]} invoices
 * @returns {number}
 */
export function invoiceTotal(invoices) {
  let total = 0;
  for (const inv of invoices) {
    total += inv.amount;
  }
  return total;
}

/**
 * Apply one payment across invoices oldest-first, clearing each invoice we can
 * still fully cover from the running balance.
 *
 * @param {number} payment  dollars the customer paid
 * @param {{ id: string, amount: number }[]} invoices
 * @returns {{ cleared: string[], remaining: number, fullyCleared: boolean }}
 */
export function applyPayment(payment, invoices) {
  let remaining = payment;
  const cleared = [];

  for (const inv of invoices) {
    // Only clear an invoice we can pay in full out of what's left.
    if (remaining < inv.amount) {
      break;
    }
    remaining -= inv.amount;
    cleared.push(inv.id);
  }

  return {
    cleared,
    remaining,
    // Paid off everything and nothing left over.
    fullyCleared: cleared.length === invoices.length && remaining === 0,
  };
}
