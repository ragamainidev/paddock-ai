import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, test } from 'vitest';
import { makeSample } from './make-subset';
import { fnv1a, inSubset, isEnthusiastModel } from './subset-spec';

describe('public EPA sample', () => {
  test('selects EPA configuration spellings and includes unrelated distractors deterministically', () => {
    expect(isEnthusiastModel('Porsche', '911 Carrera S')).toBe(true);
    expect(isEnthusiastModel('Audi', 'R8 Spyder')).toBe(true);
    expect(isEnthusiastModel('Toyota', 'Camry')).toBe(false);
    for (const id of ['1', '2', '3', '111', '222']) {
      expect(inSubset({ id, make: 'Toyota', model: 'Camry' })).toBe(fnv1a(id) % 100 === 0);
    }
  });

  test('preserves source cells and order, including missing fields, with byte-stable output', () => {
    // Synthetic records test serialization only, never production vehicle facts.
    const input = Buffer.from(
      'id,year,make,model,displ,cylinders,drive,trany,fuelType\n1,2000,Audi,R8,,,,,\n2,2001,Porsche,911,3.6,6,Rear-Wheel Drive,Manual 6-spd,Premium\n',
    );
    const first = makeSample(input);
    expect(first).toEqual(makeSample(input));
    expect(parse(first.csv, { columns: true })[0]).toMatchObject({ id: '1', displ: '', trany: '' });
    expect(first.rowCount).toBe(2);
  });

  test('refuses non-EPA inputs and duplicate source identities', () => {
    expect(() => makeSample(Buffer.from('ymm_id,Make,Model,Year\n1,X,Y,2000\n'))).toThrow(
      /official/,
    );
    const header = 'id,year,make,model,displ,cylinders,drive,trany,fuelType\n';
    expect(() =>
      makeSample(Buffer.from(header + '1,2000,Audi,R8,,,,,\n1,2000,Audi,R8,,,,,\n')),
    ).toThrow(/duplicate/);
  });

  test('committed sample agrees with provenance and contains only selected, unique source IDs', () => {
    const csv = readFileSync(new URL('../data/epa-sample.csv', import.meta.url));
    const provenance = JSON.parse(
      readFileSync(new URL('../data/epa-sample.provenance.json', import.meta.url), 'utf8'),
    );
    const rows: Record<string, string>[] = parse(csv, { columns: true });
    expect(createHash('sha256').update(csv).digest('hex')).toBe(provenance.sampleSha256);
    expect(rows.length).toBe(provenance.rowCount);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.every((r) => inSubset({ id: r.id, make: r.make, model: r.model }))).toBe(true);
    expect(rows.some((r) => !isEnthusiastModel(r.make, r.model))).toBe(true);
    expect(Math.min(...rows.map((r) => Number(r.year)))).toBe(provenance.yearMin);
    expect(provenance.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(provenance.licenseUrl).toBe('https://edg.epa.gov/EPA_Data_License.html');
  });
});
