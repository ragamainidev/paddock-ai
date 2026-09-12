import { describe, expect, test } from 'vitest';
import { checkReliability } from './reliability';
import { findComps, getSeedListing, SEED_LISTINGS } from './seed-listings';
import { checkVin } from './vin';

// The seed catalog is data, so its integrity is tested like code: every
// entry must be internally consistent and covered by the rest of the system.

describe('seed listing integrity', () => {
  test('every seed has at least 3 https photos and a provenance URL', () => {
    for (const seed of SEED_LISTINGS) {
      expect(seed.photos.length, seed.id).toBeGreaterThanOrEqual(3);
      for (const photo of seed.photos) expect(photo).toMatch(/^https:\/\//);
      expect(seed.url).toMatch(/^https:\/\/bringatrailer\.com\/listing\//);
      expect(seed.price).toBeGreaterThan(1000);
      expect(seed.description.length).toBeGreaterThan(50);
    }
  });

  test('every seed VIN decodes cleanly against its own claimed make and year', () => {
    for (const seed of SEED_LISTINGS) {
      const check = checkVin(seed.vin, { make: seed.make, year: seed.year });
      expect(check.valid, `${seed.id}: ${seed.vin}`).toBe(true);
      expect(check.mismatches, `${seed.id}: ${seed.vin}`).toEqual([]);
    }
  });

  test('every seed has comps, and never includes itself as its own comp', () => {
    for (const seed of SEED_LISTINGS) {
      const result = findComps(seed.make, seed.model, seed.year, seed.url);
      expect(result, seed.id).not.toBeNull();
      expect(result!.comps.length, seed.id).toBeGreaterThanOrEqual(5);
      expect(
        result!.comps.every((c) => c.url !== seed.url),
        seed.id,
      ).toBe(true);
      expect(result!.query).toContain('collected');
    }
  });

  test('every seed is covered by curated reliability data', () => {
    for (const seed of SEED_LISTINGS) {
      const report = checkReliability(seed.make, seed.model, seed.year);
      expect(report.commonFailures.length, seed.id).toBeGreaterThan(0);
    }
  });

  test('seed ids are unique and resolvable', () => {
    const ids = SEED_LISTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getSeedListing(ids[0])?.id).toBe(ids[0]);
    expect(getSeedListing('nope')).toBeUndefined();
  });
});

describe('findComps', () => {
  test('badge twins share a market: Toyota 86 finds the FR-S comp set', () => {
    expect(findComps('Toyota', '86', 2015)).not.toBeNull();
  });

  test('uncovered vehicles return null, never an empty pretend set', () => {
    expect(findComps('Lexus', 'ES350', 2019)).toBeNull();
    expect(findComps('BMW', 'M3', 1995)).toBeNull(); // outside the year window
  });
});
