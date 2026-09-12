import { describe, expect, test } from 'vitest';
import { checkVin } from '@/inspector/vin';
import { getSalvageLot, LOTS_COLLECTED_ON, SALVAGE_LOTS } from './seed-lots';

// The salvage seed catalog is tested like code (same discipline as the BaT
// seeds, SPEC 28): every lot is a real Copart auction whose VIN must decode
// cleanly against its own claimed identity, whose photos are https on the
// real Copart CDN, and whose provenance is a fetchable listing URL.

describe('salvage seed catalog integrity', () => {
  test('there are lots, with unique ids and unique VINs', () => {
    expect(SALVAGE_LOTS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(SALVAGE_LOTS.map((l) => l.id)).size).toBe(SALVAGE_LOTS.length);
    expect(new Set(SALVAGE_LOTS.map((l) => l.vin)).size).toBe(SALVAGE_LOTS.length);
  });

  test.each(SALVAGE_LOTS.map((lot) => [lot.id, lot] as const))(
    '%s: VIN decodes cleanly against the claimed identity',
    (_id, lot) => {
      const check = checkVin(lot.vin, { make: lot.make, year: lot.year });
      expect(check.valid).toBe(true);
      expect(check.mismatches).toEqual([]);
    },
  );

  test.each(SALVAGE_LOTS.map((lot) => [lot.id, lot] as const))(
    '%s: photos are https on the Copart CDN and capped sanely',
    (_id, lot) => {
      expect(lot.photos.length).toBeGreaterThanOrEqual(4);
      expect(lot.photos.length).toBeLessThanOrEqual(12);
      for (const photo of lot.photos) {
        expect(photo).toMatch(/^https:\/\/cs\.copart\.com\//);
      }
      expect(new Set(lot.photos).size).toBe(lot.photos.length);
    },
  );

  test.each(SALVAGE_LOTS.map((lot) => [lot.id, lot] as const))(
    '%s: provenance is complete — source URL, collection date, damage, title statement',
    (_id, lot) => {
      expect(lot.url).toMatch(/^https:\/\//);
      expect(lot.collectedOn).toBe(LOTS_COLLECTED_ON);
      expect(lot.damage.primary.length).toBeGreaterThan(0);
      expect(lot.titleBrand.length).toBeGreaterThan(0); // honest 'masked…' counts
      expect(lot.location.length).toBeGreaterThan(0);
      expect(lot.engine.length).toBeGreaterThan(0);
    },
  );

  test('lookup by id round-trips', () => {
    expect(getSalvageLot('huracan-front-mi')?.vin).toBe('ZHWUF5ZF9MLA16300');
    expect(getSalvageLot('nope')).toBeUndefined();
  });

  test('the non-repairable lot says so — that fact drives the verdict', () => {
    expect(getSalvageLot('huracan-front-mi')?.titleBrand).toMatch(/non-repairable/i);
  });
});
