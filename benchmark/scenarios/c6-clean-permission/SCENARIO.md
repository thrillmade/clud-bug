---
id: c6-clean-permission
class: clean
severity: none
one_line_defect: NONE — this code is correct
reproduction: node reproduce.mjs
why_correct: The ownership term in the `||` chain is guarded by `!isGuest` (closing the guest/anonymous null-id collision) and `moderatesHere` is gated by `role === 'moderator'` (so a stale moderatorIds entry grants nothing), so every unauthorized role × ownership × pinned × channel-membership combination is denied.
correct_finding: NONE. A correct review reports no finding here; any critical/major flag is a FALSE POSITIVE.
---

`canDeleteMessage` decides deletion rights by folding a data-controlled ownership
test (`actor.id === message.authorId`) into a top-level `||` term alongside the
role checks, which is the classic over-permissive-LOOKING shape: a hasty reviewer
sees ownership at the head of an OR chain and flags "any principal whose id matches
the author walks through." But the ownership term is guarded by `!isGuest`, which is
load-bearing — an unauthenticated guest (`id: null`) and an anonymous message
(`authorId: null`) both carry null, so `ownsMessage` is `true` for that pair, and
only `!isGuest` stops a guest from deleting an anonymous post. Likewise `moderatesHere`
requires `role === 'moderator'`, so a stale `moderatorIds` entry for a mere member
grants nothing. `node reproduce.mjs` denies the exact guest/null-collision case a
reviewer fears and shows the module agreeing with an independent spec oracle across
the whole cross-product, so the only correct output is no finding.
