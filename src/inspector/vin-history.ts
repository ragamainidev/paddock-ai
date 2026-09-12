import { createEbayClient, EBAY_CATEGORY_CARS } from '@/enrich/ebay';

/**
 * Free vehicle-history discovery for an exact VIN, deterministic and
 * model-free: search live listings for the VIN, fetch the listing page,
 * and surface only history-report links that are actually present on it.
 * A link is either verified on a live listing or it is not offered at all.
 *
 * Source: the eBay Browse API (client-credential OAuth, no login) plus one
 * plain HTML fetch per hit. Cars.com and the Carfax partner URL both sit
 * behind bot protection (403 to non-browser fetches), and AutoTempest's
 * queue API signs requests with a salted hash of its full client param
 * set; none of those are dependable without a headless browser, so they
 * are deliberately not used.
 */

export type HistoryLink = { label: string; url: string };

export type VinHistoryProbe = (vin: string) => Promise<HistoryLink[]>;

const REPORT_HOSTS = /https:\/\/[^"'\s>]*(?:carfax\.com|autocheck\.com)[^"'\s>]*/gi;
const MAX_LISTINGS_TO_SCAN = 2;
const FETCH_TIMEOUT_MS = 6_000;

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export function createVinHistoryProbe(
  client: Pick<ReturnType<typeof createEbayClient>, 'searchRaw'> = createEbayClient(),
  fetchImpl: typeof fetch = fetch,
): VinHistoryProbe {
  return async (vin) => {
    const items = await client.searchRaw(vin, EBAY_CATEGORY_CARS, 5).catch(() => []);
    const links: HistoryLink[] = [];
    const seen = new Set<string>();
    for (const item of items.slice(0, MAX_LISTINGS_TO_SCAN)) {
      if (!item.itemWebUrl) continue;
      const html = await fetchText(item.itemWebUrl, fetchImpl);
      for (const match of html.matchAll(REPORT_HOSTS)) {
        const url = match[0].replace(/&amp;/g, '&');
        const host = url.includes('carfax') ? 'CARFAX' : 'AutoCheck';
        const key = `${host}:${url.split('?')[0]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ label: `Free ${host} report (verified on a live listing)`, url });
      }
      if (links.length > 0) break;
    }
    return links;
  };
}
