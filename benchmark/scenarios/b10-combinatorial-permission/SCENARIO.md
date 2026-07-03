---
id: b10-combinatorial-permission
class: combinatorial
severity: MAJOR
one_line_defect: canEdit ORs a role-based grant and an ownership grant; the archive hard-freeze (archived ⇒ read-only for everyone) is enforced only inside the role operand, so a document's owner reaching access via the ownership operand can edit an archived document that should be frozen.
reproduction: node reproduce.mjs
why_no_single_line: No single line is wrong — `canEditByRole` correctly refuses archived docs and correctly ranks roles, `canEditAsOwner` correctly lets a viewer-role owner edit their own doc and correctly locks out suspended members, and `canEdit` is the idiomatic "grant if either path allows" disjunction; each operand is a complete, individually-correct capability. The defect is that the cross-cutting archived deny must gate the WHOLE disjunction (or be duplicated into every operand) and instead appears in only one, so it bites only for the role+flag combination owner × archived.
correct_finding: Report that the "archived ⇒ read-only for everyone" invariant is broken because the freeze is checked on the role operand of the OR but not the ownership operand — an owner (even a viewer-role, non-suspended one) can edit an archived document. Ground it either by reproducing (`node reproduce.mjs`: an archived doc is edited by its owner) or by naming the invariant (archival is a global deny that must override every allow-grant; ORing two allow-predicates where only one honors the deny lets the deny be bypassed).
---

`canEdit(user, doc)` grants edit access if EITHER a role path (`canEditByRole`) OR
an ownership path (`canEditAsOwner`) allows it. The role path correctly enforces the
archive freeze (`if (doc.archived) return false`) and the ownership path correctly
enforces its own guard (suspended members lose write access), so each operand looks
complete and defensible on its own. But the archive freeze is a *global deny* meant to
override every grant, and it lives in only one operand. For the combination owner ×
archived the ownership operand returns true without ever consulting `doc.archived`, so
the OR grants edit access to a document that must be read-only for everyone. Drop
either half — a non-owner hitting the role path, or an owner on a non-archived doc —
and the output is correct; only the owner-of-an-archived-doc combination slips through.

**Fix:** make the archive freeze gate the whole decision instead of a single operand,
e.g. `export function canEdit(user, doc) { if (doc.archived) return false; return canEditByRole(user, doc) || canEditAsOwner(user, doc); }`
(or duplicate the `if (doc.archived) return false` guard into `canEditAsOwner` so every
allow-path honors the deny). Either restores "archived ⇒ read-only for everyone."
