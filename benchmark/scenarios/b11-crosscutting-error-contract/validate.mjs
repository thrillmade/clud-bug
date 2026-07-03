// validate.mjs — PRE-EXISTING utility. This file is NOT part of the PR diff.
// It is only *exposed* by the transfers change; a line-local reviewer of the
// PR never opens it.
//
// Account references arrive as raw strings from an upstream queue, e.g.
// "ACCT-1041". parseAccountId() canonicalizes one into its numeric id.
//
// CONTRACT: returns the numeric account id on success, or `null` when the
// input is not a well-formed reference. It is a *total* function — it never
// throws. Callers are expected to check the result for null.

export function parseAccountId(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^ACCT-(\d{4,})$/.exec(raw.trim());
  if (!m) return null; // malformed reference — signalled by null, not an exception
  return Number(m[1]);
}

// Convenience predicate used elsewhere in the codebase.
export function isValidAccountRef(raw) {
  return parseAccountId(raw) !== null;
}
