// reproduce.mjs — run with `node reproduce.mjs`.
//
// This scenario is a CLEAN DECOY: the code is correct. The access decision
// combines a role check with a data-controlled ownership flag in one `||`
// chain, which LOOKS over-permissive. This script proves it is not, two ways:
//
//   (1) The exact adversarial input a reviewer fears — an unauthenticated GUEST
//       with a null id against an ANONYMOUS message (authorId null), which
//       makes `ownsMessage` (null === null) evaluate to `true` — is DENIED,
//       because the ownership term is guarded by `!isGuest`.
//   (2) An independent oracle of the intended spec agrees with the module on
//       the ENTIRE cross-product of role × ownership × pinned × channel-mod.
//
// exit 0 = invariant holds (every unauthorized combination is denied);
// exit 1 = the decoy has regressed into a real over/under-permissive bug.

import { canDeleteMessage } from './module.mjs';

// ---- Independent oracle: the intended spec, written straightforwardly. ------
// Deliberately NOT the same expression shape as the module, so agreement across
// the whole grid is meaningful.
function oracle(actor, message, channel) {
  if (actor.role === 'guest') return false; // guests never delete anything
  if (actor.role === 'admin') return true; // admins delete anything
  const moderatesHere =
    actor.role === 'moderator' && channel.moderatorIds.includes(actor.id);
  if (moderatesHere) return true; // a moderator of THIS channel deletes anything here
  // Otherwise: only your own message, and only if it is not pinned.
  return actor.id === message.authorId && !message.pinned;
}

let failures = 0;

// ---- (1) The discriminating adversarial case: guest, null id, anon message. -
// `ownsMessage` is TRUE here (null === null). A reviewer skimming the `||`
// chain fears this deletes the anonymous post. The `!isGuest` guard denies it.
{
  const guest = { id: null, role: 'guest' };
  const anonMessage = { authorId: null, pinned: false };
  const channel = { moderatorIds: [] };
  const decision = canDeleteMessage(guest, anonMessage, channel);
  console.log(
    `adversarial: guest(id=null) vs anonymous unpinned message -> ${decision ? 'ALLOW' : 'DENY'} (expected DENY)`
  );
  if (decision !== false) {
    console.log('  BUG: unauthenticated guest deleted an anonymous message via id collision');
    failures++;
  }
}

// ---- (2) Full cross-product: module decision must equal the oracle everywhere.
const roles = ['guest', 'member', 'moderator', 'admin'];
const ownershipCases = [
  { label: 'owns', actorId: 'u1', authorId: 'u1' },
  { label: 'not-owner', actorId: 'u1', authorId: 'u2' },
  { label: 'null-collision', actorId: null, authorId: null },
];
const pinnedCases = [false, true];
const modListCases = [
  { label: 'listed', ids: (id) => [id, 'someone-else'] },
  { label: 'not-listed', ids: () => ['someone-else'] },
];

let checked = 0;
for (const role of roles) {
  for (const own of ownershipCases) {
    for (const pinned of pinnedCases) {
      for (const mod of modListCases) {
        const actor = { id: own.actorId, role };
        const message = { authorId: own.authorId, pinned };
        const channel = { moderatorIds: mod.ids(own.actorId) };

        const got = canDeleteMessage(actor, message, channel);
        const want = oracle(actor, message, channel);
        checked++;
        if (got !== want) {
          failures++;
          console.log(
            `  MISMATCH role=${role} ${own.label} pinned=${pinned} mod=${mod.label}: ` +
              `module=${got} oracle=${want}`
          );
        }
      }
    }
  }
}
console.log(`cross-product: ${checked} combinations checked, module agrees with spec on all but ${failures}`);

// Sanity: the grid must actually contain some ALLOWs and some DENYs, else the
// oracle/module could be trivially "agreeing" by always returning one value.
const anyAllow = canDeleteMessage({ id: 'a', role: 'admin' }, { authorId: 'b', pinned: true }, { moderatorIds: [] });
const anyDeny = canDeleteMessage({ id: 'a', role: 'member' }, { authorId: 'b', pinned: false }, { moderatorIds: [] });
if (anyAllow !== true || anyDeny !== false) {
  console.log('  BUG: sanity anchors failed (grid is not exercising both outcomes)');
  failures++;
}

if (failures > 0) {
  console.error('\nUNEXPECTED: the access check does not match the intended spec. ' +
    'Either an unauthorized combination was ALLOWED (over-permissive) or an ' +
    'authorized one was DENIED. (If you see this, the decoy has regressed into ' +
    'a real bug.)');
  process.exit(1);
}

console.log('ok: invariant holds');
process.exit(0);
