import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { installCatalog } from './install-catalog';
import { readCatalogMetadata } from '../src/catalog/metadata';
import { EPA_SOURCE_URL, EPA_LICENSE_URL } from '../src/catalog/epa';
test('HTTP failure cannot replace a working database', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'install-'));
  const dbPath = path.join(dir, 'catalog.db');
  const db = createClient({ url: `file:${dbPath}` });
  try {
    await db.execute('CREATE TABLE vehicles (id INTEGER)');
    await db.execute('INSERT INTO vehicles VALUES(42)');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(installCatalog({ dbPath, fetcher })).rejects.toThrow(/503/);
    expect((await db.execute('SELECT id FROM vehicles')).rows[0].id).toBe(42);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test.each([undefined, '0'.repeat(64)])(
  'invalid download preserves cached source and catalog (%s)',
  async (expectedSha256) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'install-'));
    const dbPath = path.join(dir, 'catalog.db');
    const source = path.join(dir, 'source-epa.csv');
    writeFileSync(source, 'prior cache');
    const db = createClient({ url: `file:${dbPath}` });
    try {
      await db.execute('CREATE TABLE vehicles(id INTEGER)');
      await db.execute('INSERT INTO vehicles VALUES(42)');
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('wrong,csv\na,b\n'));
      await expect(installCatalog({ dbPath, fetcher, expectedSha256 })).rejects.toThrow();
      expect(readFileSync(source, 'utf8')).toBe('prior cache');
      expect((await db.execute('SELECT id FROM vehicles')).rows[0].id).toBe(42);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test('cache promotion failure warns and retains bytes after successful install', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'install-'));
  const dbPath = path.join(dir, 'catalog.db');
  mkdirSync(path.join(dir, 'source-epa.csv'));
  const csv =
    'id,year,make,model,cylinders,displ,drive,fuelType1,trany,atvType\n15606,2000,Honda,Insight,3,1.0,Front-Wheel Drive,Regular Gasoline,Manual 5-spd,Hybrid\n';
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(
      installCatalog({
        dbPath,
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(csv)),
      }),
    ).resolves.toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Catalog installed;'));
    const retained = readdirSync(dir).find((name) => name.endsWith('.tmp'));
    expect(retained).toBeTruthy();
    expect(readFileSync(path.join(dir, retained!), 'utf8')).toBe(csv);
    const db = createClient({ url: `file:${dbPath}` });
    try {
      expect((await db.execute('SELECT fuel FROM vehicles')).rows[0].fuel).toBe('HYBRID');
      expect(await readCatalogMetadata(db)).toMatchObject({
        kind: 'epa',
        format: 'epa',
        sourceUrl: EPA_SOURCE_URL,
        licenseUrl: EPA_LICENSE_URL,
      });
    } finally {
      db.close();
    }
  } finally {
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
