import type { Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createRichCatalogFixture } from './fixtures/rich-catalog';
import type { Constraint } from '@/lib/types';
import { rankVehicles } from './rank';
import { buildVehicleQuery, type VehicleRow } from './sql';

let db: Client;

beforeAll(async () => {
  db = await createRichCatalogFixture();
});

afterAll(() => db.close());

async function resolve(constraint: Constraint) {
  const q = buildVehicleQuery(constraint);
  if (!q) return [];
  const res = await db.execute({ sql: q.sql, args: q.args });
  return rankVehicles(res.rows as unknown as VehicleRow[], constraint);
}

function mkRow(partial: Partial<VehicleRow>): VehicleRow {
  return {
    id: 1,
    make: 'BMW',
    model: 'M3',
    year: 2001,
    engine: null,
    submodel: null,
    trim: null,
    body: null,
    drive: null,
    block_type: null,
    cylinders: null,
    displacement: null,
    aspiration: null,
    fuel: null,
    doors: null,
    ...partial,
  };
}

const E46: Constraint = {
  make: 'BMW',
  models: ['323%', '325%', '328%', '330%', 'M3'],
  yearMin: 1999,
  yearMax: 2006,
};

describe('rankVehicles', () => {
  test('empty input produces no vehicles', () => {
    expect(rankVehicles([], { make: 'Porsche' })).toEqual([]);
  });

  test('requested M3 window: the longer observed span ranks first and 1999 stays separate', async () => {
    const cards = await resolve({ ...E46, trimContains: [['M3']] });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 });
    // The fixture has no 2000 observation; no card may fill that gap.
    expect(cards[1]).toMatchObject({ yearMin: 1999, yearMax: 1999 });
  });

  test('bare E46 window returns several models with M3 ranked first', async () => {
    const cards = await resolve(E46);
    expect(cards.length).toBeGreaterThan(1);
    expect(cards[0].model).toBe('M3');
    expect(cards.some((c) => c.model.startsWith('330'))).toBe(true);
  });

  test('V10 query spans makes and every card says V10', async () => {
    const cards = await resolve({ cylinders: 10, blockType: 'V' });
    expect(new Set(cards.map((c) => c.make)).size).toBeGreaterThanOrEqual(2);
    for (const c of cards) {
      expect(c.reasons.join(' ')).toContain('V10');
    }
  });

  test('sparse GT3 RS observations stay separate with the trim as a reason', async () => {
    const cards = await resolve({
      make: 'Porsche',
      models: ['911'],
      yearMin: 2019,
      trimContains: [['GT3 RS']],
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ model: '911', yearMin: 2023 });
    expect(cards[1]).toMatchObject({ model: '911', yearMin: 2019, yearMax: 2019 });
    for (const c of cards) {
      expect(c.reasons.join(' ')).toContain('GT3 RS');
      expect(c.trims.some((t) => t.includes('GT3 RS'))).toBe(true);
    }
  });

  test('any missing model year splits a model into separate cards', () => {
    const rows = [1990, 1991, 1995, 1996].map((year, i) => mkRow({ id: i, year }));
    const cards = rankVehicles(rows, { make: 'BMW', models: ['M3'] });
    expect(cards).toHaveLength(2);
    const spans = cards.map((c) => `${c.yearMin}-${c.yearMax}`).sort();
    expect(spans).toEqual(['1990-1991', '1995-1996']);
  });

  test('a single missing observed year keeps catalog spans separate', () => {
    const rows = [2001, 2003].map((year, i) => mkRow({ id: i, year }));
    const cards = rankVehicles(rows, { make: 'BMW', models: ['M3'] });
    expect(cards).toHaveLength(2);
  });

  test('anyOf fitment labels become per-card reasons', async () => {
    const cards = await resolve({
      anyOf: [
        {
          make: 'Toyota',
          models: ['Supra'],
          yearMin: 1993,
          yearMax: 1998,
          label: 'ships with the 2JZ (1993–1998)',
        },
        {
          make: 'Lexus',
          models: ['SC300'],
          yearMin: 1992,
          yearMax: 1997,
          label: 'ships with the 2JZ (1992–1997)',
        },
      ],
    });
    const supra = cards.find((c) => c.model === 'Supra');
    const sc = cards.find((c) => c.model === 'SC300');
    expect(supra?.reasons).toContain('ships with the 2JZ (1993–1998)');
    expect(sc?.reasons).toContain('ships with the 2JZ (1992–1997)');
    expect(supra?.reasons).not.toContain('ships with the 2JZ (1992–1997)');
  });

  test('engines aggregate with counts, most common first', () => {
    const rows = [
      mkRow({ id: 1, year: 2001, engine: '3.2L L6 NA' }),
      mkRow({ id: 2, year: 2002, engine: '3.2L L6 NA' }),
      mkRow({ id: 3, year: 2003, engine: '3.0L L6 NA' }),
    ];
    const cards = rankVehicles(rows, { make: 'BMW' });
    expect(cards).toHaveLength(1);
    expect(cards[0].engines[0]).toEqual({ engine: '3.2L L6 NA', count: 2 });
    expect(cards[0].engines[1]).toEqual({ engine: '3.0L L6 NA', count: 1 });
  });
});
