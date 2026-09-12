/**
 * What a lot the buyer brought names as its source, and nothing else. This is
 * a leaf with no imports of its own: the workspace's formatters compare a
 * lot's source against it (SPEC 61), and they must be able to do that without
 * pulling `intake.ts` — and `node:crypto` with it — into a client bundle.
 * `intake.ts` re-exports it, so its own readers are unaffected.
 */
export const USER_LOT_SOURCE = 'user-supplied listing';
