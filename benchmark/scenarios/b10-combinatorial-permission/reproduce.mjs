// reproduce.mjs — run with `node reproduce.mjs`.
//
// Drives canEdit / applyEdit (module.mjs) and checks SPEC invariant #3: an
// ARCHIVED document is read-only for EVERYONE — no role and not even the owner.
//
// The defect is combinatorial — it needs a specific role+flag COMBINATION:
//   (flag)  the document must be `archived` (the hard-freeze flag), and
//   (role)  the acting user must reach access via the OWNERSHIP path (they own
//           the doc) rather than the role path.
// Either half alone behaves correctly:
//   - archived + a non-owner editor  -> correctly DENIED (role path checks archived).
//   - non-archived + a viewer-owner   -> correctly ALLOWED (ownership overrides role).
// Only archived-doc + its-owner combine: the ownership operand of the OR never
// consults `archived`, so the freeze that the role operand enforces is bypassed.

import { canEdit, applyEdit } from './module.mjs';

// An ARCHIVED document owned by user "u_owner".
const doc = { id: 'doc_1', ownerId: 'u_owner', archived: true, body: 'frozen' };

// The owner has only the `viewer` role (no role-based edit right) and is NOT
// suspended — so the ONLY grant they could receive is the ownership path.
const owner = { id: 'u_owner', role: 'viewer', suspended: false };

// A non-owner `editor` — used to show the role path DOES honor the freeze.
const outsider = { id: 'u_editor', role: 'editor', suspended: false };

console.log('archived doc, non-owner editor  -> canEdit:', canEdit(outsider, doc));
console.log('archived doc, viewer-role owner -> canEdit:', canEdit(owner, doc));

// Invariant #3: for an archived document, canEdit MUST be false for every user.
const offender = [owner, outsider].find((u) => canEdit(u, doc));

if (offender) {
  // Prove it is a real capability, not just a boolean: the edit goes through.
  const updated = applyEdit(offender, doc, { body: 'MUTATED' });
  console.error(
    `\nBUG CONFIRMED: archived document ${doc.id} was edited by ${offender.id} ` +
      `(role=${offender.role}) — invariant "archived ⇒ read-only for everyone" is ` +
      `broken. The archive freeze is enforced on the role operand of ` +
      `canEditByRole||canEditAsOwner but the ownership operand never checks ` +
      `\`doc.archived\`, so an owner slips past the hard deny. body -> "${updated.body}".`
  );
  process.exit(1);
}

console.log('\nok: invariant holds (archived documents are read-only for everyone)');
process.exit(0);
