import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { runSearch } from './search';
let db: Client;
beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await db.execute(
    `CREATE TABLE vehicles (id INTEGER PRIMARY KEY, make TEXT, model TEXT, year INTEGER, engine TEXT, submodel TEXT, trim TEXT, body TEXT, drive TEXT, block_type TEXT, cylinders INTEGER, displacement REAL, aspiration TEXT, fuel TEXT, doors INTEGER)`,
  );
  await db.execute(
    `INSERT INTO vehicles(id,make,model,year,cylinders) VALUES (1,'BMW','M3',2001,6), (2,'BMW','M3',2003,6)`,
  );
});
afterEach(() => db.close());
test('production search returns unresolved layout without model invention and legacy coverage is uncertain', async () => {
  const result = await runSearch('bmw m3 inline six', { db, modelCaller: null });
  expect(result.branches[0].vehicles.length).toBeGreaterThan(0);
  expect(result.branches[0].vehicles[0].unresolved).toContain('engine layout');
  expect(result.catalog).toBeNull();
  expect(result.coverageNotes.join(' ')).toMatch(/unknown|unavailable/i);
  expect(result.coverageNotes.join(' ')).toMatch(/production/i);
});
test('catalog identity and row granularity are surfaced from valid metadata', async () => {
  await db.execute('CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY,json TEXT)');
  const metadata = {
    schemaVersion: 1,
    id: 'epa-test',
    label: 'EPA test',
    sourceUrl: 'https://www.fueleconomy.gov/',
    licenseUrl: 'https://edg.epa.gov/EPA_Data_License.html',
    sourceSha256: 'a'.repeat(64),
    kind: 'epa',
    market: 'US',
    yearMin: 2001,
    yearMax: 2003,
    rowCount: 2,
  };
  await db.execute({
    sql: 'INSERT INTO catalog_metadata VALUES(1,?)',
    args: [JSON.stringify(metadata)],
  });
  await db.execute("UPDATE vehicles SET model='M3 Sedan'");
  const result = await runSearch('bmw m3', { db, modelCaller: null });
  expect(result.branches[0].vehicles[0].model).toBe('M3 Sedan');
  expect(result.catalog).toEqual(metadata);
  expect(result.coverageNotes.join(' ')).toMatch(/EPA configuration/i);
});

test('invalid metadata cannot crash otherwise usable vehicle search', async () => {
  await db.execute('CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY,json TEXT)');
  await db.execute("INSERT INTO catalog_metadata VALUES(1,'not json')");
  const result = await runSearch('bmw m3', { db, modelCaller: null });
  expect(result.catalog).toBeNull();
  expect(result.branches[0].vehicles.length).toBeGreaterThan(0);
});
