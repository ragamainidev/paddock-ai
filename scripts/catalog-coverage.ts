import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { readCatalogMetadata } from '../src/catalog/metadata';
import type { CatalogMetadata } from '../src/catalog/types';
import { runSearch } from '../src/pipeline/search';
import { FULL_DB } from './ingest';

type CoverageCase = {
  query: string;
  resolverOk: boolean;
  candidates: number;
  // Verification covers parsed query constraints, not vehicle identity or condition.
  verifiedCandidates: number;
  unresolved: string[];
  unparsed: string[];
  examples: Array<{ make: string; model: string }>;
};

export async function inspectCatalogCoverage(
  db: Client,
  queries: string[],
): Promise<{ catalog: CatalogMetadata | null; cases: CoverageCase[] }> {
  const catalog = await readCatalogMetadata(db);
  const cases: CoverageCase[] = [];
  for (const query of queries) {
    const result = await runSearch(query, { db, modelCaller: null });
    const vehicles = result.branches.flatMap((branch) => branch.vehicles);
    cases.push({
      query,
      resolverOk: result.statuses.some((status) => status.stage === 'resolve' && status.ok),
      candidates: vehicles.length,
      verifiedCandidates: result.interpretation.unparsed.length
        ? 0
        : vehicles.filter((vehicle) => !vehicle.unresolved?.length).length,
      unresolved: [...new Set(vehicles.flatMap((vehicle) => vehicle.unresolved ?? []))],
      unparsed: result.interpretation.unparsed,
      examples: vehicles.slice(0, 5).map(({ make, model }) => ({ make, model })),
    });
  }
  return { catalog, cases };
}

async function main() {
  const args = process.argv.slice(2);
  const dbIndex = args.indexOf('--db');
  if (dbIndex >= 0 && (!args[dbIndex + 1] || args[dbIndex + 1].startsWith('--')))
    throw new Error('Missing value for --db');
  const dbPath = dbIndex >= 0 ? path.resolve(args[dbIndex + 1]) : FULL_DB;
  if (!existsSync(dbPath))
    throw new Error(
      'Catalog database missing; run pnpm catalog:install or pass --db data/eval.db.',
    );
  const queries = readFileSync(path.resolve(__dirname, '../evals/queries.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const item: unknown = JSON.parse(line);
      if (!item || typeof item !== 'object' || !('query' in item) || typeof item.query !== 'string')
        throw new Error('Invalid coverage query');
      return item.query;
    });
  const db = createClient({ url: `file:${dbPath}` });
  try {
    const report = await inspectCatalogCoverage(db, queries);
    console.log(JSON.stringify(report, null, 2));
    if (report.cases.some((item) => !item.resolverOk)) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
