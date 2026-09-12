import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createEbayClient } from '@/enrich/ebay';
import type { Fetcher } from '@/enrich/nhtsa';
import type { ThemeCaller } from '@/enrich/themes';
import { enrichVehicle } from './enrich';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', 'enrich', 'fixtures', name), 'utf8'));
}

const E46_M3 = { make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 };

const nhtsaFetcher: Fetcher = async (url) => {
  if (url.includes('products/vehicle/models')) return fixture('models-bmw-2003.json');
  if (url.includes('complaintsByVehicle')) return fixture('complaints-m3-coupe-2003.json');
  if (url.includes('recallsByVehicle')) return fixture('recalls-m3-2003.json');
  throw new Error(`unrouted url: ${url}`);
};

const ebayFetch: typeof fetch = async (input) => {
  const url = String(input);
  const body = url.includes('oauth2/token')
    ? { access_token: 'tok', expires_in: 7200 }
    : fixture('ebay-search-e46-m3.json');
  return new Response(JSON.stringify(body), { status: 200 });
};

const workingEbay = () =>
  createEbayClient({ env: { clientId: 'id', clientSecret: 'secret' }, fetchImpl: ebayFetch });

describe('enrichVehicle', () => {
  test('happy path: all three sections arrive with ok statuses', async () => {
    const themeCaller: ThemeCaller = vi.fn(async () => ({
      themes: [{ component: 'AIR BAGS', title: 'Takata inflators', detail: 'Recall parts.' }],
    }));
    const r = await enrichVehicle(E46_M3, ['manual'], {
      nhtsaFetcher,
      themeCaller,
      ebay: workingEbay(),
    });
    expect(r.statuses.map((s) => [s.stage, s.ok])).toEqual([
      ['nhtsa', true],
      ['themes', true],
      ['ebay', true],
    ]);
    expect(r.nhtsa.recalls.length).toBeGreaterThan(0);
    expect(r.themes.find((t) => t.component === 'AIR BAGS')?.title).toBe('Takata inflators');
    expect(r.listings.query).toBe('BMW M3 manual');
    expect(r.listings.listings.length).toBeGreaterThan(0);
  });

  test('failure isolation: NHTSA down and eBay unconfigured still yields listings-free report', async () => {
    const downFetcher: Fetcher = async () => {
      throw new Error('nhtsa down');
    };
    const themeCaller: ThemeCaller = vi.fn(async () => ({ themes: [] }));
    const r = await enrichVehicle(E46_M3, [], {
      nhtsaFetcher: downFetcher,
      themeCaller,
      ebay: createEbayClient({ env: {} }),
    });
    expect(r.statuses.find((s) => s.stage === 'nhtsa')).toMatchObject({ ok: false });
    expect(r.statuses.find((s) => s.stage === 'ebay')).toMatchObject({ ok: false });
    // No complaints reached the themes stage, so it reports ok with nothing.
    expect(r.statuses.find((s) => s.stage === 'themes')).toMatchObject({ ok: true });
    expect(themeCaller).not.toHaveBeenCalled();
    expect(r.themes).toEqual([]);
    expect(r.nhtsa.complaints).toEqual([]);
    expect(r.listings.listings).toEqual([]);
  });

  test('a failing theme model keeps raw component counts', async () => {
    const themeCaller: ThemeCaller = async () => {
      throw new Error('haiku down');
    };
    const r = await enrichVehicle(E46_M3, [], {
      nhtsaFetcher,
      themeCaller,
      ebay: workingEbay(),
    });
    expect(r.statuses.find((s) => s.stage === 'themes')).toMatchObject({ ok: false });
    expect(r.themes.length).toBeGreaterThan(0);
    expect(r.themes[0].title).toBe(r.themes[0].component);
  });

  test('trim groups shape the listing query', async () => {
    const themeCaller: ThemeCaller = async () => ({ themes: [] });
    const r = await enrichVehicle({ ...E46_M3, trims: [['Competition']] }, [], {
      nhtsaFetcher,
      themeCaller,
      ebay: workingEbay(),
    });
    expect(r.listings.query).toBe('BMW M3 Competition');
  });
});
