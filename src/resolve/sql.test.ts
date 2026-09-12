import type { Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createRichCatalogFixture } from './fixtures/rich-catalog';
import type { Constraint } from '@/lib/types';
import { buildVehicleQuery, type VehicleRow } from './sql';

let db: Client;

beforeAll(async () => {
  db = await createRichCatalogFixture();
});

afterAll(() => db.close());

async function run(constraint: Constraint): Promise<VehicleRow[]> {
  const q = buildVehicleQuery(constraint);
  if (!q) return [];
  const res = await db.execute({ sql: q.sql, args: q.args });
  return res.rows as unknown as VehicleRow[];
}

function trimText(row: VehicleRow): string {
  return `${row.trim ?? ''} ${row.submodel ?? ''} ${row.model}`.toLowerCase();
}

describe('buildVehicleQuery', () => {
  test('refuses an unconstrained query', () => {
    expect(buildVehicleQuery({})).toBeNull();
    expect(
      buildVehicleQuery({
        unfilterable: [
          { term: 'manual', reason: 'no transmission data', forwardedToListings: true },
        ],
      }),
    ).toBeNull();
  });

  test('parameterizes every user value — no literals in the SQL text', () => {
    const q = buildVehicleQuery({
      make: 'Porsche',
      models: ['911'],
      yearMin: 2019,
      trimContains: [['GT3 RS']],
    });
    expect(q).not.toBeNull();
    expect(q!.sql).not.toContain('Porsche');
    expect(q!.sql).not.toContain('911');
    expect(q!.sql).not.toContain('GT3');
    expect(q!.args).toContain('Porsche');
    expect(q!.args).toContain('%GT3 RS%');
  });

  test('911 GT3 RS from 2019 returns fixture rows, all matching', async () => {
    const rows = await run({
      make: 'Porsche',
      models: ['911'],
      yearMin: 2019,
      trimContains: [['GT3 RS']],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.make).toBe('Porsche');
      expect(r.model).toBe('911');
      expect(Number(r.year)).toBeGreaterThanOrEqual(2019);
      expect(trimText(r)).toContain('gt3 rs');
    }
  });

  test('make matching is case-insensitive', async () => {
    const rows = await run({ make: 'porsche', models: ['911'], yearMin: 2019, yearMax: 2019 });
    expect(rows.length).toBeGreaterThan(0);
  });

  test('chassis modelLike patterns: E46 window catches M3 and 330i, nothing newer', async () => {
    const rows = await run({
      make: 'BMW',
      models: ['323%', '325%', '328%', '330%', 'M3'],
      yearMin: 1999,
      yearMax: 2006,
    });
    const models = new Set(rows.map((r) => r.model));
    expect(models.has('M3')).toBe(true);
    expect([...models].some((m) => String(m).startsWith('330'))).toBe(true);
    for (const r of rows) {
      expect(Number(r.year)).toBeGreaterThanOrEqual(1999);
      expect(Number(r.year)).toBeLessThanOrEqual(2006);
    }
  });

  test('spec-only query: V10 spans multiple makes', async () => {
    const rows = await run({ cylinders: 10 });
    expect(rows.length).toBeGreaterThan(0);
    const makes = new Set(rows.map((r) => r.make));
    expect(makes.size).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(Number(r.cylinders)).toBe(10);
  });

  test('naturally aspirated flat six coupe finds Porsches', async () => {
    const rows = await run({ cylinders: 6, blockType: 'H', aspiration: 'NA', body: 'Coupe' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.make === 'Porsche')).toBe(true);
    for (const r of rows) {
      expect(r.block_type).toBe('H');
      expect(r.aspiration).toBe('NA');
      expect(String(r.body).toLowerCase()).toContain('coupe');
    }
  });

  test('diesel wagons exist and every row is a diesel wagon', async () => {
    const rows = await run({ body: 'Wagon', fuel: 'DIESEL' });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(String(r.body).toLowerCase()).toContain('wagon');
      expect(r.fuel).toBe('DIESEL');
    }
  });

  test('impossible constraints return zero rows — never invent', async () => {
    const rows = await run({ make: 'Porsche', models: ['911'], fuel: 'DIESEL' });
    expect(rows).toHaveLength(0);
  });

  test('stacked trim groups AND together: GT3 + Touring means GT3 Touring only', async () => {
    const rows = await run({
      make: 'Porsche',
      models: ['911'],
      trimContains: [['GT3'], ['Touring']],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(trimText(r)).toContain('gt3');
      expect(trimText(r)).toContain('touring');
    }
  });

  test('alternatives inside one trim group OR together: ZR1 in either spelling', async () => {
    const rows = await run({
      make: 'Chevrolet',
      models: ['Corvette'],
      trimContains: [['ZR1', 'ZR-1']],
    });
    const years = rows.map((r) => Number(r.year));
    expect(years.some((y) => y <= 1995)).toBe(true); // C4 wrote it ZR-1
    expect(years.some((y) => y >= 2009)).toBe(true); // later cars write ZR1
  });

  test('trim exclusion: GT3 without RS keeps GT3, drops GT3 RS', async () => {
    const rows = await run({
      make: 'Porsche',
      models: ['911'],
      trimContains: [['GT3']],
      exclude: { trimContains: ['RS'] },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(trimText(r)).not.toContain('rs');
  });

  test('trim exclusion does not drop rows whose trim is null', async () => {
    const rows = await run({
      make: 'Mazda',
      models: ['MX-5%', 'Miata'],
      exclude: { trimContains: ['ZZZ-NOT-A-TRIM'] },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  test('aspiration exclusion drops rows explicitly marked Turbo, keeps the rest', async () => {
    const rows = await run({
      make: 'Porsche',
      models: ['911'],
      yearMin: 1999,
      yearMax: 2005,
      exclude: { aspiration: ['Turbo'] },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.aspiration).not.toBe('Turbo');
  });

  test('hostile input runs safely and matches nothing', async () => {
    const rows = await run({
      make: 'Porsche',
      trimContains: [["'; DROP TABLE vehicles; --"]],
    });
    expect(rows).toHaveLength(0);
    const still = await db.execute('SELECT COUNT(*) AS n FROM vehicles');
    expect(Number(still.rows[0].n)).toBeGreaterThan(0);
  });

  test('LIKE wildcards in user trim text are escaped, not interpreted', async () => {
    const rows = await run({ make: 'Porsche', models: ['911'], trimContains: [['%']] });
    expect(rows).toHaveLength(0);
  });

  test('anyOf unions engine fitments across makes', async () => {
    const rows = await run({
      anyOf: [
        { make: 'Toyota', models: ['Supra'], yearMin: 1993, yearMax: 1998 },
        { make: 'Lexus', models: ['SC300'], yearMin: 1992, yearMax: 1997 },
        { make: 'Lexus', models: ['IS300'], yearMin: 2001, yearMax: 2005 },
      ],
    });
    const found = new Set(rows.map((r) => `${r.make} ${r.model}`));
    expect(found).toEqual(new Set(['Toyota Supra', 'Lexus SC300', 'Lexus IS300']));
    for (const r of rows) {
      if (r.model === 'Supra') expect(Number(r.year)).toBeGreaterThanOrEqual(1993);
      if (r.model === 'IS300') expect(Number(r.year)).toBeLessThanOrEqual(2005);
    }
  });

  test('anyOf composes with global filters and fitment trims', async () => {
    const rows = await run({
      yearMin: 2002,
      anyOf: [
        { make: 'Toyota', models: ['Supra'], yearMax: 1998 },
        {
          make: 'Chevrolet',
          models: ['Corvette'],
          yearMin: 2001,
          yearMax: 2004,
          trimContains: ['Z06'],
        },
      ],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.make).toBe('Chevrolet');
      expect(Number(r.year)).toBeGreaterThanOrEqual(2002);
      expect(Number(r.year)).toBeLessThanOrEqual(2004);
      expect(`${r.trim} ${r.submodel}`).toContain('Z06');
    }
  });

  test('anyOf alone counts as a constraint', () => {
    expect(buildVehicleQuery({ anyOf: [{ make: 'Toyota', models: ['Supra'] }] })).not.toBeNull();
    expect(buildVehicleQuery({ anyOf: [] })).toBeNull();
  });
});
