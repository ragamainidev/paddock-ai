import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { resolveVehicles } from './catalog';
import { tokenize } from '@/interpret/tokenize';
let db: Client;
beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await db.execute(
    `CREATE TABLE vehicles (id INTEGER PRIMARY KEY, make TEXT, model TEXT, year INTEGER, engine TEXT, submodel TEXT, trim TEXT, body TEXT, drive TEXT, block_type TEXT, cylinders INTEGER, displacement REAL, aspiration TEXT, fuel TEXT, doors INTEGER)`,
  );
  await db.execute(`INSERT INTO vehicles(id,make,model,year,cylinders,block_type,trim,submodel,aspiration) VALUES
    (1,'Toyota','Supra',1995,6,NULL,NULL,NULL,NULL),
    (2,'Toyota','Supra',1995,6,'L','Turbo','Base','Turbo'),
    (3,'Toyota','Supra',1997,6,'V','Base','Base','NA')`);
});
afterEach(() => db.close());
test('missing layout earns no credit and a known contradictory layout is excluded', async () => {
  const cards = await resolveVehicles(db, { make: 'Toyota', cylinders: 6, blockType: 'L' });
  expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(2);
  const unknown = cards.find((c) => c.unresolved?.length);
  expect(unknown?.unresolved).toContain('engine layout');
  expect(unknown?.reasons).not.toContain('engine layout');
  expect(cards[0].score).toBeGreaterThan(unknown!.score);
});
test('unknown exclusions are retained without credit; positive excluded facts are rejected', async () => {
  const cards = await resolveVehicles(db, {
    make: 'Toyota',
    exclude: { trimContains: ['Turbo'], aspiration: ['Turbo'] },
  });
  expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(2);
  expect(cards.find((c) => c.unresolved?.length)?.unresolved).toEqual([
    'excluding trim "Turbo"',
    'excluding aspiration Turbo',
  ]);
});
test('a fitment OR remains unknown until a whole alternative matches, including trim', async () => {
  const cards = await resolveVehicles(db, {
    anyOf: [
      {
        make: 'Toyota',
        models: ['Supra'],
        yearMax: 1996,
        trimContains: ['Turbo'],
        label: 'turbo fitment',
      },
    ],
  });
  expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(2);
  expect(cards.find((c) => c.unresolved?.length)?.reasons).not.toContain('turbo fitment');
  expect(cards.find((c) => !c.unresolved?.length)?.reasons).toContain('turbo fitment');
});
test('injection-looking trim is literal and absent optional facts remain unresolved', async () => {
  const cards = await resolveVehicles(db, {
    make: 'Toyota',
    trimContains: [["%' OR 1=1 --"]],
    aspiration: 'NA',
    unfilterable: [{ term: 'manual', reason: 'unverified', forwardedToListings: true }],
  });
  expect(cards).toHaveLength(1);
  expect(cards[0].rowCount).toBe(1);
  expect(cards[0].unresolved).toContain('manual: unverified');
});

test('EPA aliases preserve raw family labels without crossing model boundaries', async () => {
  await db.execute('DELETE FROM vehicles');
  await db.execute(`INSERT INTO vehicles(id,make,model,year) VALUES
    (1,'Porsche','911 Carrera',2020),(2,'Porsche','911 Turbo',2020),(3,'Porsche','Cayman',2020),
    (4,'Audi','R8 Coupe',2020),(5,'Audi','RS 8',2020),
    (6,'BMW','M3 Sedan',2020),(7,'BMW','M340i Sedan',2020),
    (8,'Lexus','SC 300',1995),(9,'Lexus','SC 400',1995),(10,'Lexus','SC 300/SC 400',1995)`);
  const options = { catalogKind: 'epa' as const };
  expect(
    (await resolveVehicles(db, { make: 'Porsche', models: ['911'] }, options))
      .map((c) => c.model)
      .sort(),
  ).toEqual(['911 Carrera', '911 Turbo']);
  expect(
    (await resolveVehicles(db, { make: 'Audi', models: ['R8'] }, options)).map((c) => c.model),
  ).toEqual(['R8 Coupe']);
  expect(
    (await resolveVehicles(db, { make: 'BMW', models: ['M3'] }, options)).map((c) => c.model),
  ).toEqual(['M3 Sedan']);
  const lexus = await resolveVehicles(db, { make: 'Lexus', models: ['SC300'] }, options);
  expect(lexus.map((c) => c.model).sort()).toEqual(['SC 300', 'SC 300/SC 400']);
  expect(lexus.find((c) => c.model.includes('/'))?.unresolved).toContain('model SC 300/SC 400');
  expect(
    await resolveVehicles(db, { make: 'Porsche', models: ['911'] }, { catalogKind: 'user' }),
  ).toEqual([]);
});

test('fitment aliases preserve unresolved combined identity and reject known trim/year contradictions', async () => {
  await db.execute('DELETE FROM vehicles');
  await db.execute(`INSERT INTO vehicles(id,make,model,year,trim,submodel) VALUES
 (1,'Lexus','SC 300',1995,'Sport','Base'),(2,'Lexus','SC 300/SC 400',1995,NULL,NULL),
 (3,'Lexus','SC 400',1995,'Sport','Base'),(4,'Lexus','SC 300',2000,'Sport','Base'),(5,'Lexus','SC 300',1995,'Base','Base')`);
  const cards = await resolveVehicles(
    db,
    {
      anyOf: [
        {
          make: 'Lexus',
          models: ['SC300'],
          yearMax: 1997,
          trimContains: ['Sport'],
          label: 'fitment',
        },
      ],
    },
    { catalogKind: 'epa' },
  );
  expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(2);
  expect(cards.find((c) => c.model.includes('/'))?.unresolved).toContain(
    'engine fitment alternatives',
  );
  expect(cards.find((c) => c.model === 'SC 300')?.reasons).toContain('fitment');
});

test('all optional scalar filters retain unknowns and reject explicit mismatches', async () => {
  await db.execute(`UPDATE vehicles SET drive='RWD',body='Coupe',doors=2,fuel='GAS' WHERE id=2`);
  await db.execute(`UPDATE vehicles SET drive='AWD',body='Sedan',doors=4,fuel='DIESEL' WHERE id=3`);
  for (const constraint of [
    { aspiration: 'Turbo' as const },
    { drive: 'RWD' as const },
    { body: 'coupe' },
    { doors: 2 },
    { fuel: 'GAS' as const },
  ]) {
    const cards = await resolveVehicles(db, { make: 'Toyota', ...constraint });
    expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(2);
    expect(cards[0].unresolved).toEqual([]);
    expect(cards[1].unresolved?.length).toBe(1);
    expect(cards[0].score).toBe(cards[1].score + 1);
  }
});
test('OR fitment checks complete alternatives without mixing one alternative year with another trim', async () => {
  const cards = await resolveVehicles(db, {
    anyOf: [
      {
        make: 'Toyota',
        models: ['Supra'],
        yearMax: 1996,
        trimContains: ['Turbo'],
        label: 'early turbo',
      },
      {
        make: 'Toyota',
        models: ['Supra'],
        yearMin: 1997,
        trimContains: ['Base'],
        label: 'later base',
      },
    ],
  });
  expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(3);
  expect(cards.find((c) => c.yearMin === 1997)?.reasons).toEqual(['later base']);
  expect(cards.find((c) => c.yearMin === 1995 && c.unresolved?.length)?.reasons).toEqual([]);
  expect(cards.find((c) => c.yearMin === 1995 && !c.unresolved?.length)?.reasons).toEqual([
    'early turbo',
  ]);
});

// EPA 32356 is a 2013 7.0L Corvette, not the 6.2L LS3 configuration.
test.each(['ls3', 'chevrolet ls3'])(
  'engine search %s rejects contradictory source attributes and leaves exact code unknown',
  async (query) => {
    await db.execute('DELETE FROM vehicles');
    await db.execute(`INSERT INTO vehicles(id,make,model,year,cylinders,displacement,block_type) VALUES
    (32356,'Chevrolet','Corvette',2013,8,7.0,NULL),
    (32355,'Chevrolet','Corvette',2013,8,6.2,NULL),
    (3,'Chevrolet','Camaro',2013,6,3.6,NULL),
    (4,'Chevrolet','Camaro',2013,NULL,NULL,NULL)`);
    const cards = await resolveVehicles(db, tokenize(query).branches[0].constraint, {
      catalogKind: 'epa',
    });
    expect(cards.reduce((n, c) => n + c.rowCount, 0)).toBe(2);
    for (const card of cards) {
      expect(card.unresolved).toContain('LS3: catalog does not verify exact engine codes');
      expect(card.reasons.some((reason) => reason.includes('shipped with'))).toBe(false);
    }
    expect(cards.find((card) => card.model === 'Camaro')?.unresolved).toContain('displacement');
  },
);

test('single narrowed engine fitment rejects wrong displacement and keeps missing layout unresolved', async () => {
  await db.execute('DELETE FROM vehicles');
  await db.execute(`INSERT INTO vehicles(id,make,model,year,cylinders,displacement,block_type) VALUES
    (1,'BMW','M3',2003,6,3.2,NULL),
    (2,'BMW','M3',2003,6,3.0,NULL),
    (3,'BMW','M3',2003,6,3.2,'V')`);
  const cards = await resolveVehicles(db, tokenize('bmw s54').branches[0].constraint, {
    catalogKind: 'epa',
  });
  expect(cards).toHaveLength(1);
  expect(cards[0].rowCount).toBe(1);
  expect(cards[0].unresolved).toEqual([
    'engine layout',
    'S54: catalog does not verify exact engine codes',
  ]);
});

test('EPA format applies source spelling consistently to fixture and supplied catalogs', async () => {
  await db.execute("INSERT INTO vehicles(id,make,model,year) VALUES(4,'Audi','RS 7',2015)");
  for (const catalogKind of ['fixture', 'user'] as const) {
    const cards = await resolveVehicles(
      db,
      { make: 'Audi', models: ['RS7%'] },
      { catalogKind, catalogFormat: 'epa' },
    );
    expect(cards.map((card) => card.model)).toEqual(['RS 7']);
    expect(cards[0].unresolved).toEqual([]);
  }
});
