// Explicit official-source input only; ordinary setup never downloads data.
// pnpm exec tsx scripts/make-subset.ts --csv /path/to/vehicles.csv
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inSubset } from './subset-spec';

export function makeSample(input: Buffer): {
  csv: string;
  sourceRows: number;
  rowCount: number;
  yearMin: number;
  yearMax: number;
} {
  const records: string[][] = parse(input, { bom: true, skip_empty_lines: true });
  const [header, ...rows] = records;
  const required = [
    'id',
    'year',
    'make',
    'model',
    'displ',
    'cylinders',
    'drive',
    'trany',
    'fuelType',
  ];
  if (!header || required.some((name) => !header.includes(name))) {
    throw new Error('Expected an official FuelEconomy.gov vehicles.csv header');
  }
  const index = (name: string) => header.indexOf(name);
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row[index('id')];
    if (!/^\d+$/.test(id) || ids.has(id) || !/^\d{4}$/.test(row[index('year')])) {
      throw new Error('Invalid or duplicate EPA source identity/year');
    }
    ids.add(id);
  }
  const kept = rows.filter((row) =>
    inSubset({ id: row[index('id')], make: row[index('make')], model: row[index('model')] }),
  );
  if (!kept.length) throw new Error('EPA sample is empty');
  const years = kept.map((row) => Number(row[index('year')]));
  return {
    csv: stringify([header, ...kept], { quoted: true }),
    sourceRows: rows.length,
    rowCount: kept.length,
    yearMin: Math.min(...years),
    yearMax: Math.max(...years),
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args[args.indexOf(name) + 1];
  if (!args.includes('--csv') || !flag('--csv'))
    throw new Error('Provide --csv pointing to official EPA vehicles.csv');
  const input = readFileSync(flag('--csv'));
  const out = args.includes('--out') ? flag('--out') : 'data/epa-sample.csv';
  const sample = makeSample(input);
  const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, sample.csv);
  writeFileSync(
    out.replace(/\.csv$/, '') + '.provenance.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        source: 'DOE/EPA FuelEconomy.gov',
        sourceUrl: 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv',
        documentationUrl: 'https://www.fueleconomy.gov/feg/ws/index.shtml',
        catalogUrl: 'https://catalog.data.gov/dataset/fuel-economy-label-and-cafe-data',
        licenseUrl: 'https://edg.epa.gov/EPA_Data_License.html',
        sourceSha256: sha256(input),
        sampleSha256: sha256(sample.csv),
        sourceRows: sample.sourceRows,
        rowCount: sample.rowCount,
        yearMin: sample.yearMin,
        yearMax: sample.yearMax,
        selection:
          'scripts/subset-spec.ts: enthusiast EPA model families plus FNV-1a(source id) modulo 100 = 0; source order and columns preserved',
        granularity:
          'EPA vehicle configuration; not exhaustive trims, fitment or generation evidence',
        generationCommand:
          'pnpm exec tsx scripts/make-subset.ts --csv /path/to/official/vehicles.csv --out data/epa-sample.csv',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`EPA sample: ${sample.rowCount} of ${sample.sourceRows} source rows`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
