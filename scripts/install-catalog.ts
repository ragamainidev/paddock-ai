// Explicit public-source installer. Importing this module never downloads data.
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPA_SOURCE_URL, ingestEpaCsv } from '../src/catalog/epa';
import { FULL_DB } from './ingest';
export interface InstallOptions {
  dbPath?: string;
  csvPath?: string;
  expectedSha256?: string;
  fetcher?: typeof fetch;
}
export async function installCatalog(options: InstallOptions = {}): Promise<number> {
  const dbPath = options.dbPath ?? FULL_DB;
  if (options.csvPath)
    return ingestEpaCsv(options.csvPath, dbPath, { expectedSha256: options.expectedSha256 });
  const source = path.join(path.dirname(dbPath), 'source-epa.csv');
  await mkdir(path.dirname(source), { recursive: true });
  const temp = `${source}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let retainTemp = false;
  try {
    const response = await (options.fetcher ?? fetch)(EPA_SOURCE_URL, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`EPA download failed: HTTP ${response.status}`);
    await writeFile(temp, Buffer.from(await response.arrayBuffer()));
    const count = await ingestEpaCsv(temp, dbPath, {
      expectedSha256: options.expectedSha256,
      trustedSource: true,
    });
    try {
      await rename(temp, source);
    } catch {
      retainTemp = true;
      console.warn(
        `Catalog installed; unable to update cached source at ${source}. Download retained at ${temp}.`,
      );
    }
    return count;
  } finally {
    if (!retainTemp) await rm(temp, { force: true });
  }
}
async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    return args[i + 1];
  };
  const count = await installCatalog({
    csvPath: flag('--csv'),
    dbPath: flag('--db'),
    expectedSha256: flag('--sha256'),
  });
  console.log(`Installed ${count} EPA configuration rows`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
