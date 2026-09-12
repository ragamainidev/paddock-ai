import { failureReason } from '@/lib/failure';
import type { StageStatus } from '@/lib/types';

// eBay Browse enrichment: live listings for a resolved vehicle.
// Client-credentials OAuth (no user login), token cached until shortly
// before expiry. Terms the vehicle data couldn't filter on — color,
// transmission, mods — are forwarded into the listing query, which is
// exactly where they become useful. Credentials are read server-side only;
// when they're absent the stage skips with a said reason instead of failing
// the report.

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const CARS_AND_TRUCKS = '6001'; // eBay Motors > Cars & Trucks
const FETCH_LIMIT = 20;
const MAX_LISTINGS = 8;
const EXPIRY_MARGIN_MS = 60_000;

export type Listing = {
  id: string;
  title: string;
  price: string;
  url: string;
  image?: string;
  condition?: string;
  location?: string;
};

export type EbayEnrichment = {
  listings: Listing[];
  query: string; // shown in the UI so the forwarded terms are visible
  status: StageStatus;
};

export type EbayDeps = {
  env?: { clientId?: string; clientSecret?: string };
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type VehicleForListings = {
  make: string;
  model: string;
  yearMin: number;
  yearMax: number;
  trims?: string[][];
};

// The text query carries identity plus everything unfilterable; years are
// enforced afterwards against listing titles because Browse has no
// model-year filter for arbitrary vehicles.
export function buildListingQuery(vehicle: VehicleForListings, forwarded: string[]): string {
  const firstTrims = (vehicle.trims ?? []).map((group) => group[0]).filter(Boolean);
  return [vehicle.make, vehicle.model.replace(/[%_]/g, ''), ...firstTrims, ...forwarded]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleYear(title: string): number | null {
  const m = title.match(/\b(19[3-9]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : null;
}

function formatPrice(price: { value?: string; currency?: string } | undefined): string {
  if (!price?.value) return '';
  if (price.currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Number(price.value));
  }
  return `${price.value} ${price.currency ?? ''}`.trim();
}

type ItemSummary = {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  condition?: string;
  itemLocation?: { country?: string };
  buyingOptions?: string[];
};

export function createEbayClient(deps: EbayDeps = {}) {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  let cached: { token: string; expiresAt: number } | null = null;

  async function getToken(clientId: string, clientSecret: string): Promise<string> {
    if (cached && now() < cached.expiresAt) return cached.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
    });
    if (!res.ok) throw new Error(`eBay token request failed: ${res.status}`);
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('eBay token response had no access_token');
    cached = {
      token: data.access_token,
      expiresAt: now() + (data.expires_in ?? 7200) * 1000 - EXPIRY_MARGIN_MS,
    };
    return cached.token;
  }

  async function searchListings(
    vehicle: VehicleForListings,
    forwarded: string[],
  ): Promise<EbayEnrichment> {
    const clientId = deps.env ? deps.env.clientId : process.env.EBAY_CLIENT_ID;
    const clientSecret = deps.env ? deps.env.clientSecret : process.env.EBAY_CLIENT_SECRET;
    const query = buildListingQuery(vehicle, forwarded);

    if (!clientId || !clientSecret) {
      return {
        listings: [],
        query,
        status: {
          stage: 'ebay',
          ok: false,
          detail: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set; listings skipped',
        },
      };
    }

    try {
      const token = await getToken(clientId, clientSecret);
      const params = new URLSearchParams({
        q: query,
        category_ids: CARS_AND_TRUCKS,
        limit: String(FETCH_LIMIT),
      });
      const res = await fetchImpl(`${SEARCH_URL}?${params}`, {
        headers: {
          authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      });
      if (!res.ok) throw new Error(`eBay search failed: ${res.status}`);
      const data = (await res.json()) as { itemSummaries?: ItemSummary[] };

      const listings: Listing[] = [];
      for (const item of data.itemSummaries ?? []) {
        if (!item.itemId || !item.title || !item.itemWebUrl) continue;
        // Enforce the year window against the title; undated listings
        // (parts, unlabeled cars) stay in rather than being guessed at.
        const year = titleYear(item.title);
        if (year !== null && (year < vehicle.yearMin || year > vehicle.yearMax)) continue;
        listings.push({
          id: item.itemId,
          title: item.title,
          price: formatPrice(item.price),
          url: item.itemWebUrl,
          image: item.image?.imageUrl,
          condition: item.condition,
          location: item.itemLocation?.country,
        });
        if (listings.length >= MAX_LISTINGS) break;
      }
      return {
        listings,
        query,
        status: { stage: 'ebay', ok: true, detail: `${listings.length} listings for "${query}"` },
      };
    } catch (err) {
      console.error('ebay: listing search failed:', err);
      return {
        listings: [],
        query,
        status: { stage: 'ebay', ok: false, detail: failureReason(err) },
      };
    }
  }

  /**
   * Raw Browse search for other consumers (salvage comps). Returns item
   * summaries untouched; throws on missing credentials or HTTP failure so
   * callers own their degradation story.
   */
  async function searchRaw(query: string, categoryId: string, limit = 20): Promise<ItemSummary[]> {
    const clientId = deps.env ? deps.env.clientId : process.env.EBAY_CLIENT_ID;
    const clientSecret = deps.env ? deps.env.clientSecret : process.env.EBAY_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
    const token = await getToken(clientId, clientSecret);
    const params = new URLSearchParams({
      q: query,
      category_ids: categoryId,
      limit: String(limit),
    });
    const res = await fetchImpl(`${SEARCH_URL}?${params}`, {
      headers: { authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
    });
    if (!res.ok) throw new Error(`eBay search failed: ${res.status}`);
    const data = (await res.json()) as { itemSummaries?: ItemSummary[] };
    return data.itemSummaries ?? [];
  }

  return { searchListings, searchRaw };
}

export type EbayItemSummary = ItemSummary;
export const EBAY_CATEGORY_CARS = CARS_AND_TRUCKS;

// One shared client per server process so the OAuth token cache actually
// caches across requests.
let defaultClient: ReturnType<typeof createEbayClient> | null = null;

export function searchEbayListings(
  vehicle: VehicleForListings,
  forwarded: string[],
): Promise<EbayEnrichment> {
  defaultClient ??= createEbayClient();
  return defaultClient.searchListings(vehicle, forwarded);
}
