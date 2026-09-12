import type { Client } from '@libsql/client';
import { z } from 'zod';
import type { CatalogMetadata } from './types';
export const catalogMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.enum(['epa', 'user-csv']).optional(),
    id: z.string().min(1),
    label: z.string().min(1),
    sourceUrl: z.string().min(1),
    licenseUrl: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(['epa', 'user', 'fixture']),
    market: z.string().min(1),
    yearMin: z.number().int().min(1886).max(2200),
    yearMax: z.number().int().min(1886).max(2200),
    rowCount: z.number().int().positive(),
  })
  .refine((value) => value.yearMin <= value.yearMax, 'yearMin exceeds yearMax');
export function validateCatalogMetadata(value: unknown): CatalogMetadata {
  return catalogMetadataSchema.parse(value);
}
export async function readCatalogMetadata(db: Client): Promise<CatalogMetadata | null> {
  const exists = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_metadata'",
  );
  if (!exists.rows.length) return null;
  const result = await db.execute('SELECT json FROM catalog_metadata WHERE id=1');
  if (!result.rows.length) throw new Error('Catalog metadata table has no catalog document');
  return validateCatalogMetadata(JSON.parse(String(result.rows[0].json)));
}
