import { readFileSync } from 'node:fs';
import { userFacingReason } from '@/lib/failure';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  enrichNhtsa,
  fetchComplaints,
  fetchRecalls,
  mapToNhtsaNames,
  representativeYears,
  summarizeComponents,
  type Fetcher,
} from './nhtsa';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
}

// Routes URLs to fixtures. Anything unrouted throws, so tests prove exactly
// which requests the code makes.
function fetcherFor(routes: Record<string, unknown>): Fetcher {
  return vi.fn(async (url: string) => {
    for (const [needle, payload] of Object.entries(routes)) {
      if (url.includes(needle)) return payload;
    }
    throw new Error(`unrouted url: ${url}`);
  });
}

const E46_M3 = { make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 };

describe('representativeYears', () => {
  test('spreads first, middle, last over a long window', () => {
    expect(representativeYears(1999, 2006)).toEqual([1999, 2003, 2006]);
  });

  test('short windows return every year without duplicates', () => {
    expect(representativeYears(2001, 2001)).toEqual([2001]);
    expect(representativeYears(2001, 2002)).toEqual([2001, 2002]);
  });
});

describe('mapToNhtsaNames', () => {
  test('maps our model to every NHTSA body-style variant on a word boundary', async () => {
    const fetcher = fetcherFor({ 'products/vehicle/models': fixture('models-bmw-2003.json') });
    const mapping = await mapToNhtsaNames(E46_M3, fetcher);
    // 'M3 COUPE' and 'M3 CONVERTIBLE' match; the fabricated 'M30' must not.
    expect(mapping).toEqual({ make: 'BMW', models: ['M3 CONVERTIBLE', 'M3 COUPE'] });
  });

  test('queries the middle year of the range', async () => {
    const fetcher = fetcherFor({ 'products/vehicle/models': fixture('models-bmw-2003.json') });
    await mapToNhtsaNames(E46_M3, fetcher);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toContain('modelYear=2004');
  });

  test('prefers an exact name match over prefix expansion', async () => {
    const fetcher = fetcherFor({ 'products/vehicle/models': fixture('models-bmw-2003.json') });
    const mapping = await mapToNhtsaNames(
      { make: 'BMW', model: 'Z4', yearMin: 2003, yearMax: 2003 },
      fetcher,
    );
    expect(mapping).toEqual({ make: 'BMW', models: ['Z4'] });
  });

  test('returns null when NHTSA has no matching model name', async () => {
    const fetcher = fetcherFor({ 'products/vehicle/models': fixture('models-bmw-2003.json') });
    const mapping = await mapToNhtsaNames(
      { make: 'BMW', model: 'Zorpmobile', yearMin: 2003, yearMax: 2003 },
      fetcher,
    );
    expect(mapping).toBeNull();
  });

  test('propagates a fetch failure so the stage can report it', async () => {
    const fetcher: Fetcher = async () => {
      throw new Error('nhtsa down');
    };
    await expect(mapToNhtsaNames(E46_M3, fetcher)).rejects.toThrow('nhtsa down');
  });
});

describe('fetchComplaints', () => {
  test('aggregates across models and years, deduped by odiNumber', async () => {
    const fetcher = fetcherFor({ complaintsByVehicle: fixture('complaints-m3-coupe-2003.json') });
    const mapping = { make: 'BMW', models: ['M3 CONVERTIBLE', 'M3 COUPE'] };
    const complaints = await fetchComplaints(mapping, [2003], fetcher);
    // Both model queries return the same fixture; dedupe collapses them.
    expect(complaints.records).toHaveLength(8);
    expect(complaints.records[0]).toMatchObject({ odiNumber: expect.any(Number) });
    expect(complaints).toMatchObject({ attempted: 2, skipped: 0 });
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
  });

  test('a single failing request degrades to partial results, and says so', async () => {
    const payload = fixture('complaints-m3-coupe-2003.json');
    const fetcher: Fetcher = vi.fn(async (url: string) => {
      if (url.includes('M3%20COUPE') || url.includes('M3+COUPE')) return payload;
      throw new Error('flaky');
    });
    const mapping = { make: 'BMW', models: ['M3 CONVERTIBLE', 'M3 COUPE'] };
    const complaints = await fetchComplaints(mapping, [2003], fetcher);
    expect(complaints.records).toHaveLength(8);
    // The lost slice is counted, not swallowed: these 8 are not all there is.
    expect(complaints).toMatchObject({ attempted: 2, skipped: 1 });
  });
});

describe('summarizeComponents', () => {
  test('counts split compound component strings and sorts by count', () => {
    const complaints = [
      { odiNumber: 1, components: 'AIR BAGS', summary: '', crash: false, fire: false },
      {
        odiNumber: 2,
        components: 'AIR BAGS,ELECTRICAL SYSTEM',
        summary: '',
        crash: false,
        fire: false,
      },
      { odiNumber: 3, components: 'POWER TRAIN', summary: '', crash: false, fire: false },
      { odiNumber: 4, components: 'AIR BAGS', summary: '', crash: false, fire: false },
    ];
    expect(summarizeComponents(complaints)).toEqual([
      { component: 'AIR BAGS', count: 3 },
      { component: 'ELECTRICAL SYSTEM', count: 1 },
      { component: 'POWER TRAIN', count: 1 },
    ]);
  });
});

describe('enrichNhtsa', () => {
  test('happy path: mapping, complaints, recalls, and component counts with an ok status', async () => {
    // Real NHTSA quirk: complaints answer to the products-index names
    // ('M3 COUPE'), recalls answer to the plain name ('M3'). The stage must
    // query recalls under the raw name too or it silently finds nothing.
    const recallsFixture = fixture('recalls-m3-2003.json');
    const fetcher: Fetcher = vi.fn(async (url: string) => {
      if (url.includes('products/vehicle/models')) return fixture('models-bmw-2003.json');
      if (url.includes('complaintsByVehicle')) return fixture('complaints-m3-coupe-2003.json');
      if (url.includes('recallsByVehicle')) {
        return /model=M3&/.test(url) ? recallsFixture : { Count: 0, results: [] };
      }
      throw new Error(`unrouted url: ${url}`);
    });
    const r = await enrichNhtsa(E46_M3, fetcher);
    expect(r.status).toMatchObject({ stage: 'nhtsa', ok: true });
    expect(r.mapping).toEqual({ make: 'BMW', models: ['M3 CONVERTIBLE', 'M3 COUPE'] });
    expect(r.complaints).toHaveLength(8);
    expect(r.recalls).toHaveLength(3);
    expect(r.components[0]).toMatchObject({ component: expect.any(String), count: 2 });
  });

  test('an unmappable name fails the stage with a said reason, not a guess', async () => {
    const fetcher = fetcherFor({ 'products/vehicle/models': fixture('models-bmw-2003.json') });
    const r = await enrichNhtsa(
      { make: 'BMW', model: 'Zorpmobile', yearMin: 2003, yearMax: 2003 },
      fetcher,
    );
    expect(r.status.ok).toBe(false);
    expect(r.status.detail).toMatch(/no NHTSA model/i);
    expect(r.complaints).toEqual([]);
    expect(r.recalls).toEqual([]);
  });

  test('unreachable year/model slices are counted in the detail, never silent', async () => {
    const fetcher: Fetcher = vi.fn(async (url: string) => {
      if (url.includes('products/vehicle/models')) return fixture('models-bmw-2003.json');
      // Every complaints slice answers; every recalls slice is unreachable.
      if (url.includes('complaintsByVehicle')) return fixture('complaints-m3-coupe-2003.json');
      throw new Error('nhtsa 503');
    });
    const r = await enrichNhtsa(E46_M3, fetcher);
    expect(r.status.ok).toBe(true);
    // Three representative years across two body-style names for complaints
    // and three for recalls: 9 of 15 slices lost, and the stage says so.
    expect(r.status.detail).toContain('9 of 15 year/model slices unreachable');
    expect(r.complaints).toHaveLength(8);
    expect(r.recalls).toEqual([]);
    // The provenance line still parses the model names after the phrase.
    expect(r.status.detail).toMatch(/ via M3 CONVERTIBLE, M3 COUPE$/);
  });

  test('a total slice loss is a failed stage', async () => {
    const fetcher: Fetcher = vi.fn(async (url: string) => {
      if (url.includes('products/vehicle/models')) return fixture('models-bmw-2003.json');
      throw new Error('nhtsa 503');
    });
    const r = await enrichNhtsa(E46_M3, fetcher);
    // The mapping worked, so the stage has a name to report against — but
    // it fetched none of its slices, and an empty section that claims
    // success is the silent failure SPEC 10 forbids.
    expect(r.status.ok).toBe(false);
    expect(r.status.detail).toContain('15 of 15 year/model slices unreachable');
    expect(r.complaints).toEqual([]);
    expect(r.recalls).toEqual([]);
  });

  test('a complete fetch says nothing about slices', async () => {
    const fetcher: Fetcher = vi.fn(async (url: string) => {
      if (url.includes('products/vehicle/models')) return fixture('models-bmw-2003.json');
      if (url.includes('complaintsByVehicle')) return fixture('complaints-m3-coupe-2003.json');
      return { Count: 0, results: [] };
    });
    const r = await enrichNhtsa(E46_M3, fetcher);
    expect(r.status.detail).not.toContain('unreachable');
  });

  test('a network failure during mapping fails the stage softly', async () => {
    const fetcher: Fetcher = async () => {
      throw new Error('nhtsa down');
    };
    const r = await enrichNhtsa(E46_M3, fetcher);
    expect(r.status.ok).toBe(false);
    expect(r.status.detail).toBe(userFacingReason('unknown'));
    expect(r.status.detail).not.toContain('nhtsa down');
    expect(r.complaints).toEqual([]);
  });
});

describe('fetchRecalls', () => {
  test('dedupes the same campaign appearing across years', async () => {
    const fetcher = fetcherFor({ recallsByVehicle: fixture('recalls-m3-2003.json') });
    const mapping = { make: 'BMW', models: ['M3 CONVERTIBLE', 'M3 COUPE'] };
    const recalls = await fetchRecalls(mapping, [2003, 2004], fetcher);
    expect(recalls.records).toHaveLength(3);
    expect(recalls.records.map((r) => r.campaign)).toContain('20V018000');
    expect(recalls.records[0]).toMatchObject({
      component: expect.any(String),
      summary: expect.any(String),
    });
    expect(recalls).toMatchObject({ attempted: 4, skipped: 0 });
  });
});
