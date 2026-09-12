import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  GENERATION_CATALOG,
  familyForConstraint,
  lookupGenerationFamily,
} from './generation-catalog';

const rows: Record<string, string>[] = parse(
  readFileSync(new URL('../../data/epa-sample.csv', import.meta.url)),
  { columns: true },
);

describe('independent public family catalog', () => {
  test('every family identity cites an actual EPA record, without deriving generation boundaries from coverage', () => {
    expect(GENERATION_CATALOG.families.length).toBeGreaterThan(0);
    for (const family of GENERATION_CATALOG.families) {
      expect(family.identitySourceIds?.length).toBeGreaterThan(0);
      for (const id of family.identitySourceIds ?? []) {
        const row = rows.find((r) => r.id === id);
        expect(row?.make).toBe(family.make);
        expect(row?.model.startsWith(family.family)).toBe(true);
        expect(family.identityCitations).toContain(
          `https://www.fueleconomy.gov/ws/rest/vehicle/${id}`,
        );
      }
      // Explicit release limitation: no manufacturer-backed boundaries yet.
      expect(family.generations).toEqual([]);
    }
  });

  test('retains independently sourced family discovery, including case-insensitive tokens', () => {
    expect(lookupGenerationFamily('R8')).toMatchObject({ make: 'Audi', modelLike: ['R8%'] });
    expect(familyForConstraint('Ford', ['Mustang'])).toMatchObject({ family: 'Mustang' });
    expect(lookupGenerationFamily('imaginary')).toBeUndefined();
  });

  test('tokens are lowercase, unique and do not shadow curated chassis, engines or variants', async () => {
    const { lookupChassis, lookupEngine, lookupMake, lookupVariant } = await import('./index');
    const tokens = GENERATION_CATALOG.families.flatMap((f) => f.modelTokens);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toBe(token.toLowerCase());
      expect(lookupChassis(token)).toHaveLength(0);
      expect(lookupEngine(token)).toBeUndefined();
      expect(lookupVariant(token)).toBeUndefined();
      expect(lookupMake(token)).toBeUndefined();
    }
  });
});
