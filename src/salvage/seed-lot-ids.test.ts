/** The id list and the catalog it indexes are one list; a lot added to either is added to both. */
import { expect, it } from 'vitest';
import { isRecordedLot, SALVAGE_LOT_IDS } from './seed-lot-ids';
import { SALVAGE_LOTS } from './seed-lots';

it('indexes every recorded lot, in the catalog order', () => {
  expect([...SALVAGE_LOT_IDS]).toEqual(SALVAGE_LOTS.map((lot) => lot.id));
  expect(SALVAGE_LOTS.every((lot) => isRecordedLot(lot.id))).toBe(true);
  // A lot the buyer brought carries a generated id and is no example.
  expect(isRecordedLot('lot_01HQ')).toBe(false);
});
