import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { importCatalog, type CatalogRow, type CsvAdapter, type ImportOptions } from './import';
export const EPA_SOURCE_URL = 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv';
export const EPA_LICENSE_URL = 'https://edg.epa.gov/EPA_Data_License.html';
const text = (value: string | undefined) => value?.trim() || null;
const numeric = (value: string | undefined) =>
  value && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;
export const epaAdapter: CsvAdapter = {
  requiredColumns: [
    'id',
    'year',
    'make',
    'model',
    'cylinders',
    'displ',
    'drive',
    'fuelType1',
    'trany',
  ],
  metadata: {
    format: 'epa',
    label: 'DOE/EPA FuelEconomy.gov configurations',
    sourceUrl: EPA_SOURCE_URL,
    licenseUrl: EPA_LICENSE_URL,
    kind: 'epa',
    market: 'US',
  },
  map(row): CatalogRow {
    const drive: Record<string, string> = {
      'Front-Wheel Drive': 'FWD',
      'Rear-Wheel Drive': 'RWD',
      'All-Wheel Drive': 'AWD',
      '4-Wheel Drive': '4WD',
      'Part-time 4-Wheel Drive': '4WD',
    };
    const fuel: Record<string, string> = {
      'Regular Gasoline': 'GAS',
      'Premium Gasoline': 'GAS',
      'Midgrade Gasoline': 'GAS',
      Diesel: 'DIESEL',
      Electricity: 'ELECTRIC',
    };
    return {
      make: text(row.make),
      model: text(row.model),
      year: numeric(row.year),
      engine: text(row.eng_dscr),
      submodel: null,
      trim: null,
      body: null,
      drive: drive[row.drive] ?? null,
      block_type: null,
      cylinders: numeric(row.cylinders),
      displacement: numeric(row.displ),
      aspiration:
        row.tCharger === 'T'
          ? row.sCharger === 'S'
            ? 'Twincharged'
            : 'Turbo'
          : row.sCharger === 'S'
            ? 'Supercharged'
            : null,
      fuel: /^(Plug-in Hybrid|Hybrid)$/.test(row.atvType)
        ? 'HYBRID'
        : row.atvType === 'FFV'
          ? 'FLEX'
          : (fuel[row.fuelType1] ?? null),
      doors: null,
      cylinder_head: null,
      source_id: text(row.id),
      source_model: row.model,
      transmission: text(row.trany),
    };
  },
};
export interface EpaImportOptions extends Omit<ImportOptions, 'kind'> {
  kind?: 'user' | 'fixture';
  // Only acquisition code that fetched the official URL, or verified fixture
  // provenance against a committed manifest, may assert this origin.
  trustedSource?: boolean;
}
export function ingestEpaCsv(csvPath: string, dbPath: string, options: EpaImportOptions = {}) {
  const metadata = options.trustedSource
    ? epaAdapter.metadata
    : {
        ...epaAdapter.metadata,
        kind: 'user' as const,
        label: 'User-supplied EPA-format configurations',
        sourceUrl: pathToFileURL(path.resolve(csvPath)).href,
        licenseUrl: 'urn:user-supplied:license-unspecified',
        market: 'unspecified',
      };
  return importCatalog(csvPath, dbPath, { ...epaAdapter, metadata }, options);
}
