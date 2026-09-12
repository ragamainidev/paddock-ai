/**
 * The ids of the recorded catalog lots, and nothing else. A surface that only
 * needs to know whether a lot is one the product recorded — to label it a
 * `recorded example` (SPEC 61) — asks this module rather than importing the
 * catalog, because the lot data behind those ids (notes, photo addresses,
 * cross-source facts) has no business in a client bundle.
 *
 * `seed-lot-ids.test.ts` holds this list and `SALVAGE_LOTS` to each other.
 */
export const SALVAGE_LOT_IDS = [
  'sf90-front-il',
  '296gtb-front-wa',
  '458-rear-pa',
  'huracan-front-mi',
  'artura-vandalism-ca',
] as const;

/** Whether a lot is one of the recorded catalog lots. A lot the buyer brought is not. */
export function isRecordedLot(id: string): boolean {
  return (SALVAGE_LOT_IDS as readonly string[]).includes(id);
}
