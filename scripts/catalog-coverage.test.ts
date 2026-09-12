import { createClient } from '@libsql/client';
import { describe, expect, test } from 'vitest';
import { ensureEvalDb } from './ensure-eval-db';
import { inspectCatalogCoverage } from './catalog-coverage';

describe('catalog coverage report', () => {
  test('separates verified query constraints, unknown evidence and missing candidates', async () => {
    const db = createClient({ url: `file:${await ensureEvalDb()}` });
    try {
      const report = await inspectCatalogCoverage(db, [
        'e46 m3',
        'v10',
        'zzr9000 blorp',
        'gen 1 facelift audi r8',
      ]);
      expect(report.catalog?.format).toBe('epa');
      expect(report.cases[0].verifiedCandidates).toBeGreaterThan(0);
      expect(report.cases[0].examples.some((row) => row.make === 'BMW' && row.model === 'M3')).toBe(
        true,
      );
      expect(report.cases[1].candidates).toBeGreaterThan(0);
      expect(report.cases[1].verifiedCandidates).toBe(0);
      expect(report.cases[1].unresolved.some((term) => term.includes('engine layout'))).toBe(true);
      expect(report.cases[2].candidates).toBe(0);
      expect(report.cases[2].unparsed).toContain('blorp');
      expect(report.cases[3].candidates).toBeGreaterThan(0);
      expect(report.cases[3].verifiedCandidates).toBe(0);
      expect(report.cases[3].unresolved.some((term) => term.includes('generation'))).toBe(true);
      expect(report.cases.every((row) => row.resolverOk)).toBe(true);
    } finally {
      db.close();
    }
  });
});
