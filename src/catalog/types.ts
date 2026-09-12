export interface CatalogMetadata {
  schemaVersion: 1;
  format?: 'epa' | 'user-csv';
  id: string;
  label: string;
  sourceUrl: string;
  licenseUrl: string;
  sourceSha256: string;
  kind: 'epa' | 'user' | 'fixture';
  market: string;
  yearMin: number;
  yearMax: number;
  rowCount: number;
}
