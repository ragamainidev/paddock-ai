// Builds data/eval.db from the independently sourced public EPA sample.
// Used by the knowledge-table validation tests and the eval runner so both
// work offline and in CI, where only the subset CSV exists.
//
// Under vitest the build happens once in scripts/vitest-global-setup.ts,
// before any worker starts: concurrent ingests of one file lock each other
// out. Later callers verify the fixture checksum and cached catalog metadata.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { EVAL_DB } from './ingest';
import { ingestEpaCsv } from '../src/catalog/epa';
import { readCatalogMetadata } from '../src/catalog/metadata';

const SAMPLE = path.resolve(__dirname, '../data/epa-sample.csv');
const PROVENANCE = path.resolve(__dirname, '../data/epa-sample.provenance.json');

export async function ensureEvalDb(): Promise<string> {
  const provenance: unknown = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
  if (
    !provenance ||
    typeof provenance !== 'object' ||
    !('sampleSha256' in provenance) ||
    typeof provenance.sampleSha256 !== 'string'
  )
    throw new Error('Missing public sample provenance');
  const digest = createHash('sha256').update(readFileSync(SAMPLE)).digest('hex');
  if (digest !== provenance.sampleSha256)
    throw new Error('Public sample checksum mismatch; regenerate its provenance intentionally.');
  const db = createClient({ url: `file:${EVAL_DB}` });
  let current = false;
  try {
    const metadata = await readCatalogMetadata(db);
    current =
      metadata?.sourceSha256 === digest && metadata.kind === 'fixture' && metadata.format === 'epa';
  } catch {
    // An older derived database may have neither schema nor metadata.
  } finally {
    db.close();
  }
  if (!current)
    await ingestEpaCsv(SAMPLE, EVAL_DB, {
      kind: 'fixture',
      trustedSource: true,
      expectedSha256: digest,
    });
  return EVAL_DB;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureEvalDb()
    .then((db) => console.log(`Public EPA sample ready: ${db}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
