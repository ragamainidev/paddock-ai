import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { ingestCsv } from './ingest';

const FIXTURE_CSV =
  'ymm_id,Make,Model,Year,Engine,Submodel,Trim,Body,Cylinder_Type_Name,Drive_Type,Engine_Block_Type,Engine_CC,Engine_Cylinders,Engine_Liter_Display,Fuel_Type_Name,NumDoors,Aspiration\nsynthetic-1,Fixture Motors,Example Coupe,2001,test engine,Example Sport,Example Sport Two Door,Coupe,DOHC,RWD,V,3200,6,3.2L,GAS,2,Naturally Aspirated\nsynthetic-2,Fixture Motors,Example Coupe,2002,,,,,,,,,,,,,\nsynthetic-3,Fixture Commercial,Example Tractor,2003,test diesel,N/A,N/R,Tractor,U/K,6 X 4,-,9000,-,9.0L,DIESEL,U/K,-\nsynthetic-4,Fixture Electric,Example Hybrid,2004,,,,Hatchback,,FWD,L,1600,4,1.6L,FULL HYBRID EV-GAS (FHEV),4,Naturally Aspirated\nsynthetic-5,Fixture Legacy,Example Roadster,2005,,,,Roadster,,RWD,L,1250,4,N/A,GAS,U/K,N/A\n';

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ymm-ingest-'));
  dbPath = path.join(dir, 'test.db');
  const csvPath = path.join(dir, 'fixture.csv');
  writeFileSync(csvPath, FIXTURE_CSV);
  await ingestCsv(csvPath, dbPath);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('ingests every csv row', async () => {
  const db = createClient({ url: `file:${dbPath}` });
  const rs = await db.execute('SELECT COUNT(*) AS n FROM vehicles');
  expect(rs.rows[0].n).toBe(5);
  db.close();
});

test('normalizes a clean enthusiast row', async () => {
  const db = createClient({ url: `file:${dbPath}` });
  const rs = await db.execute(
    "SELECT * FROM vehicles WHERE make = 'Fixture Motors' AND year = 2001",
  );
  expect(rs.rows).toHaveLength(1);
  const r = rs.rows[0];
  expect(r.model).toBe('Example Coupe');
  expect(r.submodel).toBe('Example Sport');
  expect(r.trim).toBe('Example Sport Two Door');
  expect(r.body).toBe('Coupe');
  expect(r.drive).toBe('RWD');
  expect(r.block_type).toBe('V');
  expect(r.cylinders).toBe(6);
  expect(r.displacement).toBe(3.2);
  expect(r.aspiration).toBe('NA');
  expect(r.fuel).toBe('GAS');
  expect(r.doors).toBe(2);
  db.close();
});

test('unknown markers land as null, not fake values', async () => {
  const db = createClient({ url: `file:${dbPath}` });
  const rs = await db.execute("SELECT * FROM vehicles WHERE make = 'Fixture Commercial'");
  const r = rs.rows[0];
  expect(r.drive).toBeNull(); // 6 X 4 is a commercial axle format
  expect(r.block_type).toBeNull();
  expect(r.cylinders).toBeNull();
  expect(r.aspiration).toBeNull();
  expect(r.doors).toBeNull();
  db.close();
});

test('derives displacement from engine cc when liter display is missing', async () => {
  const db = createClient({ url: `file:${dbPath}` });
  const rs = await db.execute("SELECT displacement FROM vehicles WHERE make = 'Fixture Legacy'");
  expect(rs.rows[0].displacement).toBe(1.3); // 1250cc rounded to one decimal
  db.close();
});

test('creates the indexes the resolver relies on', async () => {
  const db = createClient({ url: `file:${dbPath}` });
  const rs = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
  );
  const names = rs.rows.map((r) => r.name);
  expect(names).toContain('idx_make_model_year');
  expect(names).toContain('idx_engine');
  db.close();
});
test('preserves original ymm_id source identity', async () => {
  const csvPath = path.join(dir, 'identity.csv');
  const target = path.join(dir, 'identity.db');
  writeFileSync(csvPath, 'Year,Make,Model,ymm_id\n2020,Example,Model,original-42\n');
  await ingestCsv(csvPath, target);
  const db = createClient({ url: `file:${target}` });
  try {
    expect((await db.execute('SELECT source_id FROM vehicles')).rows[0].source_id).toBe(
      'original-42',
    );
  } finally {
    db.close();
  }
});
