import { readFileSync } from 'node:fs';
import { userFacingReason } from '@/lib/failure';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { buildListingQuery, createEbayClient } from './ebay';

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ebay-search-e46-m3.json'), 'utf8'),
);

const E46_M3 = { make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 };

const CREDS = { clientId: 'test-id', clientSecret: 'test-secret' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// fetch stub that answers the token endpoint and the search endpoint.
// Typed as `typeof fetch` so mock.calls carries the (url, init) tuple.
function ebayFetch(overrides?: { searchStatus?: number; expiresIn?: number }) {
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('identity/v1/oauth2/token')) {
      return jsonResponse({
        access_token: 'tok-123',
        expires_in: overrides?.expiresIn ?? 7200,
        token_type: 'Application Access Token',
      });
    }
    if (url.includes('item_summary/search')) {
      if (overrides?.searchStatus) return jsonResponse({}, overrides.searchStatus);
      return jsonResponse(SEARCH_FIXTURE);
    }
    throw new Error(`unrouted url: ${url}`);
  };
  return vi.fn(impl);
}

describe('buildListingQuery', () => {
  test('joins make, model, first trim alternative, and forwarded terms', () => {
    const q = buildListingQuery({ ...E46_M3, trims: [['Competition']] }, [
      'manual',
      'interlagos blue',
    ]);
    expect(q).toBe('BMW M3 Competition manual interlagos blue');
  });

  test('LIKE wildcards in the model never leak into the query', () => {
    const q = buildListingQuery({ make: 'Audi', model: 'RS7', yearMin: 2014, yearMax: 2018 }, []);
    expect(q).toBe('Audi RS7');
  });
});

describe('createEbayClient', () => {
  test('missing credentials skip the stage with a said reason, no network call', async () => {
    const fetchImpl = ebayFetch();
    const client = createEbayClient({ env: {}, fetchImpl });
    const r = await client.searchListings(E46_M3, []);
    expect(r.status).toMatchObject({ stage: 'ebay', ok: false });
    expect(r.status.detail).toContain('EBAY_CLIENT_ID');
    expect(r.listings).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('happy path: client-credentials token, then browse search mapped to listings', async () => {
    const fetchImpl = ebayFetch();
    const client = createEbayClient({ env: CREDS, fetchImpl });
    const r = await client.searchListings(E46_M3, ['manual']);
    expect(r.status).toMatchObject({ stage: 'ebay', ok: true });

    const tokenCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('oauth2/token'))!;
    const tokenInit = tokenCall[1] as RequestInit;
    expect(tokenInit.method).toBe('POST');
    expect(
      String(tokenInit.headers && (tokenInit.headers as Record<string, string>).authorization),
    ).toBe(`Basic ${Buffer.from('test-id:test-secret').toString('base64')}`);
    expect(String(tokenInit.body)).toContain('grant_type=client_credentials');

    const searchCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('item_summary'))!;
    const searchUrl = String(searchCall[0]);
    expect(searchUrl).toContain('q=BMW+M3+manual');
    expect(searchUrl).toContain('category_ids=6001');
    const searchInit = searchCall[1] as RequestInit;
    expect((searchInit.headers as Record<string, string>).authorization).toBe('Bearer tok-123');

    expect(r.listings[0]).toEqual({
      id: 'v1|110001|0',
      title: '2003 BMW M3 Coupe 6-Speed Manual Carbon Black',
      price: '$42,500',
      url: 'https://www.ebay.com/itm/110001',
      image: 'https://i.ebayimg.com/images/g/110001/s-l500.jpg',
      condition: 'Used',
      location: 'US',
    });
  });

  test('titles dated outside the year window are dropped, undated titles kept', async () => {
    const client = createEbayClient({ env: CREDS, fetchImpl: ebayFetch() });
    const r = await client.searchListings(E46_M3, []);
    const titles = r.listings.map((l) => l.title);
    expect(titles).not.toContain('1995 BMW M3 E36 Track Build');
    expect(titles).toContain('BMW M3 OEM Style 67 Wheels Set of Four');
    expect(r.listings).toHaveLength(4);
  });

  test('non-USD prices keep their currency visible', async () => {
    const client = createEbayClient({ env: CREDS, fetchImpl: ebayFetch() });
    const r = await client.searchListings(E46_M3, []);
    const euro = r.listings.find((l) => l.id === 'v1|110005|0');
    expect(euro?.price).toBe('51000.00 EUR');
    expect(euro?.image).toBeUndefined();
  });

  test('the token is cached across searches until it expires', async () => {
    const fetchImpl = ebayFetch();
    let t = 1_000_000;
    const client = createEbayClient({ env: CREDS, fetchImpl, now: () => t });
    await client.searchListings(E46_M3, []);
    t += 60_000; // one minute later: cached token still valid
    await client.searchListings(E46_M3, []);
    const tokenCalls = fetchImpl.mock.calls.filter(([u]) => String(u).includes('oauth2/token'));
    expect(tokenCalls).toHaveLength(1);

    t += 7200_000; // past expiry: token must be refetched
    await client.searchListings(E46_M3, []);
    const after = fetchImpl.mock.calls.filter(([u]) => String(u).includes('oauth2/token'));
    expect(after).toHaveLength(2);
  });

  test('a failing search degrades the stage, never throws', async () => {
    const client = createEbayClient({ env: CREDS, fetchImpl: ebayFetch({ searchStatus: 500 }) });
    const r = await client.searchListings(E46_M3, []);
    expect(r.status.ok).toBe(false);
    // eBay's HTTP status and endpoint belong in the log, not in the note.
    expect(r.status.detail).toBe(userFacingReason('unknown'));
    expect(r.status.detail).not.toContain('500');
    expect(r.listings).toEqual([]);
  });
});
