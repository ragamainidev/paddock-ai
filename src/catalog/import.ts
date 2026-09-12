import { createClient, type InValue } from '@libsql/client';
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogMetadata } from './types';
import { validateCatalogMetadata } from './metadata';
export type CsvRow = Record<string, string>;
export const columns = [
  'make',
  'model',
  'year',
  'engine',
  'submodel',
  'trim',
  'body',
  'drive',
  'block_type',
  'cylinders',
  'displacement',
  'aspiration',
  'fuel',
  'doors',
  'cylinder_head',
  'source_id',
  'source_model',
  'transmission',
] as const;
export type CatalogRow = Record<(typeof columns)[number], InValue>;
export interface ImportOptions {
  expectedSha256?: string;
  kind?: CatalogMetadata['kind'];
}
export interface CsvAdapter {
  requiredColumns: readonly string[];
  map(row: CsvRow, index: number): CatalogRow;
  metadata: Pick<
    CatalogMetadata,
    'label' | 'sourceUrl' | 'licenseUrl' | 'kind' | 'market' | 'format'
  >;
}
// Validate all bytes and rows before opening the durable database. Only catalog
// tables change, in one transaction; failures roll back DDL as well as inserts.
export async function importCatalog(
  csvPath: string,
  dbPath: string,
  adapter: CsvAdapter,
  options: ImportOptions = {},
): Promise<number> {
  const bytes = readFileSync(csvPath);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (
    options.expectedSha256 &&
    (!/^[a-fA-F0-9]{64}$/.test(options.expectedSha256) ||
      sha !== options.expectedSha256.toLowerCase())
  )
    throw new Error('Catalog checksum mismatch');
  const records: CsvRow[] = parse(bytes, {
    bom: true,
    skip_empty_lines: true,
    columns: (header: string[]) => {
      if (
        new Set(header).size !== header.length ||
        adapter.requiredColumns.some((column) => !header.includes(column))
      )
        throw new Error('Wrong catalog CSV schema');
      return header;
    },
  });
  if (!records.length) throw new Error('Catalog contains zero rows');
  const rows = records.map(adapter.map);
  const ids = new Set<InValue>();
  for (const row of rows) {
    if (
      !row.make ||
      !row.model ||
      typeof row.year !== 'number' ||
      !Number.isInteger(row.year) ||
      row.year < 1886 ||
      row.year > 2200
    )
      throw new Error('Invalid catalog identity/year');
    if (!row.source_id || ids.has(row.source_id)) throw new Error('Duplicate or missing source ID');
    ids.add(row.source_id);
  }
  const years = rows.map((row) => Number(row.year));
  const metadata = validateCatalogMetadata({
    schemaVersion: 1,
    ...adapter.metadata,
    kind: options.kind ?? adapter.metadata.kind,
    id: `${options.kind ?? adapter.metadata.kind}-${sha}`,
    sourceSha256: sha,
    yearMin: years.reduce((min, year) => Math.min(min, year), Infinity),
    yearMax: years.reduce((max, year) => Math.max(max, year), -Infinity),
    rowCount: rows.length,
  });
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = createClient({ url: `file:${dbPath}` });
  try {
    const tx = await db.transaction('write');
    try {
      await tx.execute('DROP TABLE IF EXISTS vehicles');
      await tx.execute(
        `CREATE TABLE vehicles (id INTEGER PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL, engine TEXT,submodel TEXT,trim TEXT,body TEXT,drive TEXT,block_type TEXT,cylinders INTEGER,displacement REAL,aspiration TEXT,fuel TEXT,doors INTEGER,cylinder_head TEXT,source_id TEXT NOT NULL UNIQUE,source_model TEXT,transmission TEXT)`,
      );
      for (let i = 0; i < rows.length; i += 1000)
        await tx.batch(
          rows.slice(i, i + 1000).map((row) => ({
            sql: `INSERT INTO vehicles (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
            args: columns.map((column) => row[column]),
          })),
        );
      for (const [name, fields] of [
        ['make_model_year', 'make,model,year'],
        ['engine', 'cylinders,block_type,aspiration'],
        ['body', 'body'],
        ['fuel', 'fuel'],
      ])
        await tx.execute(`CREATE INDEX idx_${name} ON vehicles (${fields})`);
      await tx.execute(
        'CREATE TABLE IF NOT EXISTS catalog_metadata (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)',
      );
      await tx.execute({
        sql: 'INSERT OR REPLACE INTO catalog_metadata(id,json) VALUES(1,?)',
        args: [JSON.stringify(metadata)],
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  } finally {
    db.close();
  }
  return rows.length;
}
