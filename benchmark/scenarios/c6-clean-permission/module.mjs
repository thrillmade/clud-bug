// module.mjs — THIS is the "PR under review": authz.mjs.
//
// Context: deciding whether an actor may DELETE a message in a chat channel.
// The product rules ("the spec") are:
//
//   1. Admins may delete any message (pinned or not).
//   2. A moderator OF THIS CHANNEL may delete any message in it (pinned or not).
//   3. Any non-guest user may delete their OWN message — but only if it is NOT
//      pinned. (Pinned messages are protected; even the author can't remove one
//      unilaterally — they must ask staff.)
//   4. Everyone else is denied. Guests may never delete anything.
//
// SHAPE NOTE (this is the risky-LOOKING part). The final decision folds a
// data-controlled ownership test (`actor.id === message.authorId`) into a
// top-level `||` term:
//
//     isAdmin || moderatesHere || (ownsMessage && !isGuest && !message.pinned)
//
// A hasty reviewer sees ownership sitting at the top of an OR chain and
// concludes "any principal whose id matches the author walks right through —
// over-permissive." Two things they miss make it airtight:
//
//   * The ownership term is guarded by `!isGuest`. That matters because an
//     unauthenticated guest and an anonymous message can BOTH carry a null id,
//     so `ownsMessage` (null === null) is `true` for a guest on an anonymous
//     post. Without `!isGuest` that would delete an anon message; with it the
//     guest is denied. The negated flag is doing real work, not decoration.
//   * `moderatesHere` is gated by `role === 'moderator'`, so a stale entry in
//     `channel.moderatorIds` for someone who is only a 'member' grants nothing.
//
// Every unauthorized (role × ownership × pinned × channel-membership)
// combination is denied; reproduce.mjs enumerates the whole cross-product.

const ADMIN = "admin";
const MODERATOR = "moderator";
const GUEST = "guest";

/**
 * Decide whether `actor` may delete `message` in `channel`.
 *
 * @param {{ id: string|null, role: 'guest'|'member'|'moderator'|'admin' }} actor
 * @param {{ authorId: string|null, pinned: boolean }} message
 * @param {{ moderatorIds: Array<string> }} channel
 * @returns {boolean}
 */
export function canDeleteMessage(actor, message, channel) {
  const isAdmin = actor.role === ADMIN;

  // Moderator power is scoped to THIS channel AND requires the moderator role.
  // The membership list is just data, so we never trust it on its own — a
  // 'member' whose id lingers in moderatorIds gets no moderator powers.
  const moderatesHere =
    actor.role === MODERATOR && channel.moderatorIds.includes(actor.id);

  const isGuest = actor.role === GUEST;

  // Ownership is a data comparison: it can be `true` for a guest on an
  // anonymous message (null === null), so it must be paired with `!isGuest`.
  const ownsMessage = actor.id === message.authorId;

  return (
    isAdmin ||
    moderatesHere ||
    (ownsMessage && !isGuest && !message.pinned)
  );
}
