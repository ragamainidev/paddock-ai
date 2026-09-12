// Bring your own original-format catalog explicitly with --csv <path>.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  normalizeAspiration,
  normalizeBlock,
  normalizeDrive,
  normalizeFuel,
  parseLiters,
  toInt,
} from '../src/lib/normalize';
import { importCatalog, columns, type CatalogRow, type CsvRow } from '../src/catalog/import';
export const FULL_DB = path.resolve(__dirname, '../data/ymm.db');
export const EVAL_DB = path.resolve(__dirname, '../data/eval.db');
function displacementOf(row: CsvRow): number | null {
  const liters = parseLiters(row['Engine_Liter_Display'] ?? '');
  if (liters !== null) return liters;
  const cc = toInt(row['Engine_CC'] ?? '');
  return cc !== null ? Math.round(cc / 100) / 10 : null;
}

function textOrNull(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t === '' || t === 'N/A' || t === 'U/K' || t === '-' || t === 'N/R' ? null : t;
}

function mapUserRow(row: CsvRow, index: number): CatalogRow {
  const year = toInt(row['Year'] ?? '');
  const make = textOrNull(row['Make']);
  const model = textOrNull(row['Model']);
  if (year === null || !make || !model) throw new Error('Invalid user catalog row');
  const values = [
    make,
    model,
    year,
    textOrNull(row['Engine']),
    textOrNull(row['Submodel']),
    textOrNull(row['Trim']),
    textOrNull(row['Body']),
    normalizeDrive(row['Drive_Type'] ?? ''),
    normalizeBlock(row['Engine_Block_Type'] ?? ''),
    toInt(row['Engine_Cylinders'] ?? ''),
    displacementOf(row),
    normalizeAspiration(row['Aspiration'] ?? ''),
    normalizeFuel(row['Fuel_Type_Name'] ?? ''),
    toInt(row['NumDoors'] ?? ''),
    textOrNull(row['Cylinder_Type_Name']),
    textOrNull(row['source_id']) ?? textOrNull(row['ymm_id']) ?? String(index + 1),
    row['Model'],
    textOrNull(row['Transmission']),
  ];
  return Object.fromEntries(columns.map((column, index) => [column, values[index]])) as CatalogRow;
}
export function ingestCsv(csvPath: string, dbPath: string): Promise<number> {
  return importCatalog(csvPath, dbPath, {
    requiredColumns: ['Year', 'Make', 'Model'],
    map: mapUserRow,
    metadata: {
      label: 'User-supplied vehicle catalog',
      format: 'user-csv',
      sourceUrl: pathToFileURL(path.resolve(csvPath)).href,
      licenseUrl: 'urn:user-supplied:license-unspecified',
      kind: 'user',
      market: 'unspecified',
    },
  });
}
async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const csv = flag('--csv');
  if (!csv || csv.startsWith('--'))
    throw new Error(
      'Provide --csv <path> for a user catalog, or use catalog:install for public EPA data.',
    );
  const count = await ingestCsv(csv, flag('--db') ?? FULL_DB);
  console.log(`Imported ${count} user catalog rows`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
