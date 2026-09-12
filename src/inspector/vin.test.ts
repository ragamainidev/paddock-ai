import { describe, expect, test } from 'vitest';
import {
  checkDigitValid,
  checkVin,
  decodeVinVpic,
  decodeYearCandidates,
  normalizeVin,
  parseVpicResponse,
} from './vin';

// Real VINs from the seeded listings — the checks must decode them cleanly.
const M3_VIN = 'WBSBL93424PN58876'; // 2004 BMW M3
const P996_VIN = 'WP0AA2997XS625539'; // 1999 Porsche 911
const FRS_VIN = 'JF1ZNAA11E9707557'; // 2014 Scion FR-S (Subaru-built)
const WRX_VIN = 'JF1GR7E6XEG250506'; // 2014 Subaru WRX
const NC_VIN = 'JM1NC25F860111135'; // 2006 Mazda MX-5

describe('checkVin — clean decodes', () => {
  test('E46 M3 VIN decodes to BMW, 2004, Germany, no mismatches', () => {
    const check = checkVin(M3_VIN, { make: 'BMW', year: 2004 });
    expect(check.valid).toBe(true);
    expect(check.mismatches).toEqual([]);
    expect(check.decoded).toMatchObject({ make: 'BMW M', year: 2004, country: 'Germany' });
  });

  test('Subaru-built Scion FR-S does not false-flag the make', () => {
    const check = checkVin(FRS_VIN, { make: 'Scion', year: 2014 });
    expect(check.mismatches).toEqual([]);
    expect(check.decoded?.year).toBe(2014);
  });

  test('the rest of the seed VINs decode without mismatches', () => {
    expect(checkVin(P996_VIN, { make: 'Porsche', year: 1999 }).mismatches).toEqual([]);
    expect(checkVin(WRX_VIN, { make: 'Subaru', year: 2014 }).mismatches).toEqual([]);
    expect(checkVin(NC_VIN, { make: 'Mazda', year: 2006 }).mismatches).toEqual([]);
  });

  test('never reports a history verdict — the note says what was not checked', () => {
    const check = checkVin(M3_VIN, { make: 'BMW', year: 2004 });
    expect(check.note).toMatch(/not checked/i);
    expect(JSON.stringify(check)).not.toMatch(/"clean"/);
  });
});

describe('checkVin — mismatch red flags', () => {
  test('claimed make contradicting the WMI is flagged', () => {
    const check = checkVin(P996_VIN, { make: 'Honda', year: 1999 });
    expect(check.mismatches).toHaveLength(1);
    expect(check.mismatches[0]).toContain('Porsche');
    expect(check.mismatches[0]).toContain('Honda');
  });

  test('claimed year far from the VIN year code is flagged', () => {
    const check = checkVin(P996_VIN, { make: 'Porsche', year: 2005 });
    expect(check.mismatches.some((m) => m.includes('1999') && m.includes('2005'))).toBe(true);
  });

  test('year codes disambiguate their 30-year cycle toward the claimed year', () => {
    // 'E' is 1984 and 2014; a 2014 claim must pick 2014.
    expect(decodeYearCandidates('E')).toEqual([1984, 2014]);
    const check = checkVin(FRS_VIN, { make: 'Scion', year: 2014 });
    expect(check.decoded?.year).toBe(2014);
  });

  test('unknown WMI decodes no make and never flags one', () => {
    const check = checkVin('YV1SW61R012345678', { make: 'Volvo', year: 2001 });
    expect(check.mismatches.filter((m) => m.includes('decodes to'))).toEqual([]);
  });
});

describe('check digit (North-American VINs only)', () => {
  test('the canonical valid example passes', () => {
    expect(checkDigitValid('1HGCM82633A004352')).toBe(true);
  });

  test('one corrupted character fails and flags a NA VIN', () => {
    const corrupted = '1HGCM82634A004352';
    expect(checkDigitValid(corrupted)).toBe(false);
    const check = checkVin(corrupted, { make: 'Honda', year: 2004 });
    expect(check.mismatches.some((m) => m.includes('check digit'))).toBe(true);
  });

  test('European VINs are not judged by the check digit', () => {
    const check = checkVin(M3_VIN, { make: 'BMW', year: 2004 });
    expect(check.mismatches.every((m) => !m.includes('check digit'))).toBe(true);
  });
});

describe('malformed input', () => {
  test('wrong length is invalid with an exact message', () => {
    const check = checkVin('WBS123', { make: 'BMW', year: 2004 });
    expect(check.valid).toBe(false);
    expect(check.mismatches[0]).toContain('6 characters');
  });

  test('I, O, Q never appear in a real VIN', () => {
    const check = checkVin('WBSBL93424PN5887O', { make: 'BMW', year: 2004 });
    expect(check.valid).toBe(false);
    expect(check.mismatches[0]).toMatch(/I, O, or Q/);
  });

  test('normalizeVin uppercases and strips separators', () => {
    expect(normalizeVin('wbs-bl934 24pn58876')).toBe(M3_VIN);
  });
});

describe('vPIC federal decode', () => {
  const vpicPayload = (over: Record<string, string> = {}) => ({
    Count: 1,
    Results: [
      {
        Make: 'BMW',
        Model: 'M3',
        ModelYear: '2004',
        Trim: '',
        BodyClass: 'Coupe',
        DisplacementL: '3.2',
        EngineCylinders: '6',
        PlantCity: 'REGENSBURG',
        PlantCountry: 'GERMANY',
        ...over,
      },
    ],
  });

  test('parses the real response shape into a typed decode', () => {
    const decoded = parseVpicResponse(vpicPayload());
    expect(decoded).toMatchObject({
      make: 'Bmw',
      model: 'M3',
      year: 2004,
      bodyClass: 'Coupe',
      engine: '3.2L 6cyl',
      plant: 'Regensburg, Germany',
    });
  });

  test('empty strings become undefined, not empty fields', () => {
    const decoded = parseVpicResponse(
      vpicPayload({
        Trim: '',
        DisplacementL: '',
        EngineCylinders: '',
        PlantCity: '',
        PlantCountry: '',
      }),
    );
    expect(decoded.trim).toBeUndefined();
    expect(decoded.engine).toBeUndefined();
    expect(decoded.plant).toBeUndefined();
  });

  test('no results throws instead of returning an empty decode', () => {
    expect(() => parseVpicResponse({ Results: [] })).toThrow(/no results/);
    expect(() => parseVpicResponse(null)).toThrow(/no results/);
  });

  test('decodeVinVpic hits the DecodeVinValues endpoint with the cleaned VIN', async () => {
    let requested = '';
    const decoded = await decodeVinVpic('wbs-bl93424pn58876', async (url) => {
      requested = url;
      return vpicPayload();
    });
    expect(requested).toBe(
      'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/WBSBL93424PN58876?format=json',
    );
    expect(decoded.model).toBe('M3');
  });
});

describe('history links (SPEC 26: link, never claim)', () => {
  test('every check carries Carfax, NICB, and NHTSA recall links for this VIN', () => {
    const check = checkVin(M3_VIN, { make: 'BMW', year: 2004 });
    const urls = check.links.map((l) => l.url).join(' ');
    expect(urls).toContain(`carfax.com/vehicle/${M3_VIN}`);
    expect(urls).toContain('nicb.org/vincheck');
    expect(urls).toContain(`nhtsa.gov/recalls?vin=${M3_VIN}`);
  });

  test('even malformed VINs carry the links — the buyer can still look', () => {
    expect(checkVin('WBS123', { make: 'BMW', year: 2004 }).links.length).toBeGreaterThan(0);
  });
});
