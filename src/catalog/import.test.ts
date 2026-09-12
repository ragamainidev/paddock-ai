import { createClient } from '@libsql/client';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { ingestEpaCsv } from './epa';
import { readCatalogMetadata } from './metadata';
const dirs: string[] = [];
function fixture(csv: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'epa-'));
  dirs.push(dir);
  const source = path.join(dir, 'source.csv');
  writeFileSync(source, csv);
  return { source, dbPath: path.join(dir, 'catalog.db') };
}
const header = 'id,year,make,model,cylinders,displ,drive,fuelType1,trany,atvType\n';
const row =
  '123,2020,Example,Model Turbo,4,2.0,Front-Wheel Drive,Regular Gasoline,Automatic 6-spd,\n';
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test('preserves source identity and unknown facts with validated provenance', async () => {
  const { source, dbPath } = fixture(header + row);
  expect(await ingestEpaCsv(source, dbPath)).toBe(1);
  const db = createClient({ url: `file:${dbPath}` });
  try {
    const r = (await db.execute('SELECT * FROM vehicles')).rows[0];
    expect(r).toMatchObject({
      source_id: '123',
      source_model: 'Model Turbo',
      model: 'Model Turbo',
      drive: 'FWD',
      fuel: 'GAS',
      cylinders: 4,
      displacement: 2,
      trim: null,
      body: null,
      block_type: null,
      aspiration: null,
    });
    expect(await readCatalogMetadata(db)).toMatchObject({
      schemaVersion: 1,
      kind: 'user',
      rowCount: 1,
      yearMin: 2020,
      yearMax: 2020,
    });
  } finally {
    db.close();
  }
});
test.each([
  ['wrong schema', 'a,b\nx,y\n'],
  ['empty', header],
  ['duplicate', header + row + row],
  ['invalid row', header + row.replace('2020', 'oops')],
  ['malformed', header + '"oops'],
])('rejects %s and preserves all previous tables', async (_name, csv) => {
  const { source, dbPath } = fixture(header + row);
  await ingestEpaCsv(source, dbPath);
  const db = createClient({ url: `file:${dbPath}` });
  await db.execute('CREATE TABLE unrelated (value TEXT)');
  await db.execute("INSERT INTO unrelated VALUES ('keep')");
  writeFileSync(source, csv);
  await expect(ingestEpaCsv(source, dbPath)).rejects.toThrow();
  expect((await db.execute('SELECT COUNT(*) AS n FROM vehicles')).rows[0].n).toBe(1);
  expect((await db.execute('SELECT * FROM unrelated')).rows[0].value).toBe('keep');
  db.close();
});
test('checksum mismatch does not replace catalog', async () => {
  const { source, dbPath } = fixture(header + row);
  await expect(ingestEpaCsv(source, dbPath, { expectedSha256: '0'.repeat(64) })).rejects.toThrow(
    /checksum/i,
  );
});
test('legacy metadata returns null', async () => {
  const db = createClient({ url: ':memory:' });
  expect(await readCatalogMetadata(db)).toBeNull();
  db.close();
});
test('DDL and catalog rows roll back when metadata write fails', async () => {
  const { source, dbPath } = fixture(header + row);
  await ingestEpaCsv(source, dbPath);
  const db = createClient({ url: `file:${dbPath}` });
  try {
    await db.execute(
      "CREATE TRIGGER reject_metadata BEFORE INSERT ON catalog_metadata BEGIN SELECT RAISE(ABORT, 'blocked'); END",
    );
    writeFileSync(source, header + row.replace('123', '456'));
    await expect(ingestEpaCsv(source, dbPath)).rejects.toThrow(/blocked/);
    expect((await db.execute('SELECT source_id FROM vehicles')).rows[0].source_id).toBe('123');
    expect((await readCatalogMetadata(db))?.rowCount).toBe(1);
  } finally {
    db.close();
  }
});
test('does not confuse ambiguous drive or model text with known equipment', async () => {
  const { source, dbPath } = fixture(
    header + row.replace('Front-Wheel Drive', '4-Wheel or All-Wheel Drive'),
  );
  await ingestEpaCsv(source, dbPath);
  const db = createClient({ url: `file:${dbPath}` });
  try {
    expect((await db.execute('SELECT drive,aspiration FROM vehicles')).rows[0]).toMatchObject({
      drive: null,
      aspiration: null,
    });
  } finally {
    db.close();
  }
});
test('rejects corrupt metadata rather than reporting unverifiable coverage', async () => {
  const db = createClient({ url: ':memory:' });
  try {
    await db.execute('CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY, json TEXT)');
    await db.execute("INSERT INTO catalog_metadata VALUES(1,'{}')");
    await expect(readCatalogMetadata(db)).rejects.toThrow();
  } finally {
    db.close();
  }
});
test.each([
  ['T', '', 'Turbo'],
  ['', 'S', 'Supercharged'],
  ['T', 'S', 'Twincharged'],
  ['', '', null],
])('maps explicit EPA charger evidence %s/%s', async (tCharger, sCharger, aspiration) => {
  const { source, dbPath } = fixture(
    header.trimEnd() + ',tCharger,sCharger\n' + row.trimEnd() + `,${tCharger},${sCharger}\n`,
  );
  await ingestEpaCsv(source, dbPath);
  const db = createClient({ url: `file:${dbPath}` });
  try {
    expect((await db.execute('SELECT aspiration FROM vehicles')).rows[0].aspiration).toBe(
      aspiration,
    );
  } finally {
    db.close();
  }
});
test.each([
  ['Hybrid', 'HYBRID'],
  ['Plug-in Hybrid', 'HYBRID'],
  ['FFV', 'FLEX'],
])('uses official atvType header for %s', async (atvType, fuel) => {
  const { source, dbPath } = fixture(
    'id,year,make,model,cylinders,displ,drive,fuelType1,trany,atvType\n15606,2000,Honda,Insight,3,1.0,Front-Wheel Drive,Regular Gasoline,Manual 5-spd,' +
      atvType +
      '\n',
  );
  await ingestEpaCsv(source, dbPath);
  const db = createClient({ url: `file:${dbPath}` });
  try {
    expect((await db.execute('SELECT fuel FROM vehicles')).rows[0].fuel).toBe(fuel);
  } finally {
    db.close();
  }
});
test('local EPA-shaped data never claims official origin even with matching checksum', async () => {
  const { source, dbPath } = fixture(header + row);
  await ingestEpaCsv(source, dbPath);
  const db = createClient({ url: `file:${dbPath}` });
  try {
    const first = await readCatalogMetadata(db);
    await ingestEpaCsv(source, dbPath, { expectedSha256: first!.sourceSha256 });
    expect(await readCatalogMetadata(db)).toMatchObject({
      kind: 'user',
      sourceUrl: new URL('file://' + source).href,
      licenseUrl: 'urn:user-supplied:license-unspecified',
      format: 'epa',
    });
  } finally {
    db.close();
  }
});
