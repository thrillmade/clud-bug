// module.mjs — THIS is the "PR under review": edit-access control for documents.
//
// Context: a document store gates who may EDIT a document. Access can be granted
// two ways, and the entrypoint ORs them: a role-based grant (staff whose role is
// high enough) OR an ownership grant (you own the document). Each grant is a small
// self-contained predicate that the PR factored out into its own helper.
//
// SPEC (the contract the entrypoint must honor):
//   1. ROLE PATH: `editor` and `admin` roles may edit any ACTIVE document.
//      `viewer` has no role-based edit right.
//   2. OWNERSHIP PATH: a document's owner may edit their own document even if
//      their role is only `viewer` — ownership overrides role. But a suspended
//      member has lost all write access and may never edit.
//   3. ARCHIVE IS A HARD FREEZE: once a document is `archived` it is READ-ONLY
//      FOR EVERYONE — no role, and NOT the owner — may edit it. Archival is a
//      global deny that overrides every grant above. (Un-archive first to edit.)
//
// Reviewed line-by-line, every line below is individually defensible: the role
// path correctly refuses archived docs and correctly ranks the roles; the
// ownership path correctly lets a viewer-role owner edit their own doc and
// correctly locks out suspended members. The defect is not a wrong line — it is
// that invariant #3 (archived ⇒ nobody edits) is enforced on ONE operand of the
// OR and silently bypassed through the other.

const EDIT_ROLES = new Set(['editor', 'admin']);

/**
 * ROLE PATH — may this user edit this document by virtue of their role?
 * Editors/admins may edit active documents; archived docs are frozen out here.
 * @returns {boolean}
 */
export function canEditByRole(user, doc) {
  if (doc.archived) return false; // archived documents are frozen — no role edits them
  return EDIT_ROLES.has(user.role);
}

/**
 * OWNERSHIP PATH — may this user edit this document because they own it?
 * Owners may edit their own document regardless of role, unless they have been
 * suspended (suspension revokes all write access).
 * @returns {boolean}
 */
export function canEditAsOwner(user, doc) {
  if (user.suspended) return false; // suspended members have no write access
  return user.id === doc.ownerId;
}

/**
 * Entrypoint: may this user edit this document?
 * Grant access if EITHER the role path or the ownership path allows it.
 * @returns {boolean}
 */
export function canEdit(user, doc) {
  return canEditByRole(user, doc) || canEditAsOwner(user, doc);
}

/**
 * Apply an edit, enforcing access. Throws if the user may not edit `doc`.
 * @returns {object} the updated document
 */
export function applyEdit(user, doc, patch) {
  if (!canEdit(user, doc)) {
    throw new Error(`forbidden: ${user.id} may not edit ${doc.id}`);
  }
  return { ...doc, ...patch };
}
