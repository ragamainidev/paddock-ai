/**
 * Deterministic eBay Browse observations for a salvage lot. Active listings
 * are asking prices, never sold results, and only a listing that declares a
 * fixed price is an ask at all. Applicability precedes sampling; non-vehicle
 * amounts and standalone parts are screened out for every tier, and an exotic
 * or premium lot carries a whole-vehicle price floor over its ask lanes,
 * banded by model year because an old premium car is a whole car at four
 * figures. What each screen dropped is counted into the progress note.
 * Missing title status stays unknown, and original provider items survive
 * separately from the fields extracted into the salvage ledger (SPEC 53).
 */
import { createEbayClient, EBAY_CATEGORY_CARS, type EbayItemSummary } from '@/enrich/ebay';
import { usd } from '@/lib/money';
import { tierFor } from './tiers';
import type { Comp, MarqueTier, SalvageLot } from './types';
import { OFF_SPEC, offSpec } from './variants';

export type CompsFetcher = (
  lot: SalvageLot,
  onProgress?: (note: string) => void,
) => Promise<Comp[]>;
export type CompObservation = { comp: Comp; raw: EbayItemSummary };
export type CompObservationsFetcher = (
  lot: SalvageLot,
  onProgress?: (note: string) => void,
) => Promise<CompObservation[]>;

const DAMAGE_WORDS =
  /\b(salvage|rebuildable|damage[ds]?|wreck(?:ed)?|repairable|needs repair|parts only|project|non-?repairable)\b/i;
const BRANDED_WORDS = /\b(rebuilt|reconstructed)\b/i;
// Explicitly nonvehicle amounts and standalone parts are never whole cars,
// whatever the marque charges for them.
const NOT_WHOLE_CAR_PRICE =
  /\b(deposit|down payment|monthly payment|reservation fee|shipping only|brochure|poster|diecast|scale model|toy)\b|\b(engine|transmission|hood|headlight|taillight|bumper|wheel|fender|door|battery)\s+(only|assembly)\b/i;
// A whole exotic does not list under $10,000 at any age, and a premium car
// holds that much for about twelve model years; past that its market is a
// used car's, and a twenty-year-old premium car is a whole car at four
// figures. A mainstream car carries no floor at any age — a cheap mainstream
// whole car is still a car, and a floor would delete real comps. The bands
// are planning assumptions, not sourced figures
// (docs/salvage-economics.md §10).
type FloorBand = { maxAge: number; usd: number; ages: string };
const FLOOR_BANDS: Record<MarqueTier, FloorBand[]> = {
  exotic: [{ maxAge: Infinity, usd: 10_000, ages: 'any model year' }],
  premium: [
    { maxAge: 12, usd: 10_000, ages: '12 model years or newer' },
    { maxAge: 20, usd: 4_000, ages: '13–20 model years' },
    { maxAge: Infinity, usd: 0, ages: 'over 20 model years' },
  ],
  mainstream: [{ maxAge: Infinity, usd: 0, ages: 'any model year' }],
};
const MAX_PER_LANE = 12;
// Match the existing exit kernel's model-year tolerance; a missing year is
// not a comparable with an invented year. A generation resolver may narrow it later.
const YEAR_WINDOW = 2;

type Priced = { title: string; url: string; price: number; year: number; raw: EbayItemSummary };
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const identityPattern = (value: string) =>
  normalize(value)
    .replace(/([a-z])(\d)|(?<=\d)([a-z])/g, '$1 $2$3')
    .trim()
    .split(/\s+/)
    .join('\\s*');
// The date the observations were collected is the clock the age band reads.
// A date-only string parses at local midnight so its calendar year is the
// year the band uses, and a replayed run floors the same way it did live. The
// leading ten characters are taken rather than the whole string, so a caller
// that hands over a full ISO timestamp loses a time rather than the year.
const dayStart = (date: string): Date => new Date(`${date.slice(0, 10)}T00:00:00`);
export function wholeVehicleFloor(
  tier: MarqueTier,
  year: number,
  now: Date,
): { usd: number; basis: string } {
  const age = now.getFullYear() - year;
  const bands = FLOOR_BANDS[tier];
  // An unreadable clock or model year yields a NaN age, which exceeds no
  // bound and so takes the first, strictest band: the screen fails closed.
  const band = bands.find((entry) => !(age > entry.maxAge)) ?? bands[0];
  return {
    usd: band.usd,
    basis:
      band.usd > 0
        ? `${tier}, ${band.ages}: whole cars list from ${usd(band.usd)}`
        : `${tier}, ${band.ages}: no whole-vehicle floor`,
  };
}
const laneOf = (title: string): Comp['lane'] =>
  DAMAGE_WORDS.test(title) ? 'wreck' : BRANDED_WORDS.test(title) ? 'rebuilt' : 'clean';
const yearOf = (title: string): number | undefined => {
  const match = /\b(19\d{2}|20\d{2})\b/.exec(title);
  return match ? Number(match[1]) : undefined;
};
function applicable(title: string, lot: SalvageLot): boolean {
  const identity = new RegExp(
    `\\b${identityPattern(lot.make)}\\s+${identityPattern(lot.model)}\\b`,
    'i',
  );
  if (!identity.test(normalize(title))) return false;
  if (offSpec(title, lot)) return false;
  // Check every special variant, not merely the first keyword in a title.
  const variants = (text: string) =>
    [...text.matchAll(new RegExp(OFF_SPEC.source, 'gi'))].map((match) => normalize(match[0]));
  const desired = new Set(variants(`${lot.model} ${lot.title}`));
  const offered = new Set(variants(title));
  return (
    [...offered].every((value) => desired.has(value)) &&
    [...desired].every((value) => offered.has(value))
  );
}
// What the three counted screens removed, beside what survived them. A Browse
// schema change shows up as a fixed-price count, not as a quiet empty pool
// (SPEC 10–11, 53).
type Screened = {
  items: Priced[];
  noFixedPrice: number;
  underFloor: number;
  outsideMarket: number;
};
function pricedItems(items: EbayItemSummary[], lot: SalvageLot, floor: number): Screened {
  const byListing = new Map<string, Priced>();
  let noFixedPrice = 0;
  let underFloor = 0;
  let outsideMarket = 0;
  for (const item of items) {
    const price = Number(item.price?.value);
    // An auction's price is a bid, not an ask; a listing that does not declare
    // a fixed price is not an ask, so an absent field excludes the item.
    if (!Array.isArray(item.buyingOptions) || !item.buyingOptions.includes('FIXED_PRICE')) {
      noFixedPrice += 1;
      continue;
    }
    const year = yearOf(item.title ?? '');
    if (!item.title || !item.itemWebUrl || item.price?.currency !== 'USD') continue;
    if (!Number.isFinite(price) || price <= 0) continue;
    if (NOT_WHOLE_CAR_PRICE.test(item.title)) continue;
    // The floor guards the ask lanes against parts money; a damaged listing
    // under the floor is wreck evidence, and the wreck market is context that
    // never enters the solve (SPEC 39).
    if (price < floor && laneOf(item.title) !== 'wreck') {
      underFloor += 1;
      continue;
    }
    // A listing for another year, another car or another variant is a whole
    // vehicle this lot has no market in; counted, so the note's arithmetic
    // closes against the eligible pool rather than losing it silently.
    if (!year || Math.abs(year - lot.year) > YEAR_WINDOW || !applicable(item.title, lot)) {
      outsideMarket += 1;
      continue;
    }
    const candidate = {
      title: item.title,
      url: item.itemWebUrl,
      price,
      year,
      raw: structuredClone(item),
    };
    // A duplicated listing cannot acquire extra weight. Conflicting duplicate
    // prices use the lower observed ask, with a stable tie-break for replay.
    const key = item.itemId || item.itemWebUrl.split('?')[0];
    const previous = byListing.get(key);
    if (
      !previous ||
      price < previous.price ||
      (price === previous.price && candidate.url < previous.url)
    )
      byListing.set(key, candidate);
  }
  const sorted = [...byListing.values()].sort(
    (a, b) => a.price - b.price || a.url.localeCompare(b.url),
  );
  return { items: sorted, noFixedPrice, underFloor, outsideMarket };
}
function sample(items: Priced[]): Priced[] {
  if (items.length <= MAX_PER_LANE) return items;
  // Preserve the full eligible search-result distribution, including both
  // tails, without calling a top-price slice a market sample. Browse search
  // itself is not a random sample of all vehicle transactions.
  return Array.from(
    { length: MAX_PER_LANE },
    (_, i) => items[Math.round((i * (items.length - 1)) / (MAX_PER_LANE - 1))],
  );
}
function statedTitle(title: string): Comp['title'] {
  if (/\b(?:no|not|without|unknown)\s+(?:a\s+)?(?:clean\s+)?title\b/i.test(title)) return 'unknown';
  if (/\b(?:rebuilt|reconstructed)\s+title\b/i.test(title)) return 'rebuilt';
  if (/\bsalvage\b/i.test(title)) return 'salvage';
  if (/\bclean\s+title\b/i.test(title)) return 'clean';
  return 'unknown';
}
function toComp(item: Priced, lane: Comp['lane'], collectedOn: string): Comp {
  return {
    lane,
    outcome: 'ask',
    price: Math.round(item.price),
    year: item.year,
    date: collectedOn,
    title: statedTitle(item.title),
    ...(lane === 'wreck' ? { damage: item.title } : {}),
    url: item.url,
    source: 'ebay.com',
    note: item.title.slice(0, 2000),
  };
}
export function createCompsObservationFetcher(
  client: Pick<ReturnType<typeof createEbayClient>, 'searchRaw'> = createEbayClient(),
  today: () => string = () => new Date().toISOString().slice(0, 10),
): CompObservationsFetcher {
  return async (lot, onProgress) => {
    const query = `${lot.make} ${lot.model}`;
    const collectedOn = today();
    const floor = wholeVehicleFloor(tierFor(lot.make), lot.year, dayStart(collectedOn));
    onProgress?.(`[comps] ebay motors: ${query} — ${floor.basis}`);
    const screened = pricedItems(
      await client.searchRaw(query, EBAY_CATEGORY_CARS, 50),
      lot,
      floor.usd,
    );
    const cars = screened.items;
    const observations = (['clean', 'rebuilt', 'wreck'] as const).flatMap((lane) =>
      sample(cars.filter((item) => laneOf(item.title) === lane)).map((item) => ({
        comp: toComp(item, lane, collectedOn),
        raw: item.raw,
      })),
    );
    const unknown = observations.filter((item) => item.comp.title === 'unknown').length;
    const dropped = screened.noFixedPrice + screened.underFloor + screened.outsideMarket;
    onProgress?.(
      `[comps] ${observations.length} applicable asks sampled across ${cars.length} eligible listings; ${dropped} dropped: ${screened.noFixedPrice} no fixed price, ${screened.underFloor} under the whole-vehicle floor, ${screened.outsideMarket} outside this lot's market; ${unknown} title statuses unknown; no completed sales`,
    );
    return observations;
  };
}
export function createCompsFetcher(
  client: Pick<ReturnType<typeof createEbayClient>, 'searchRaw'> = createEbayClient(),
  today: () => string = () => new Date().toISOString().slice(0, 10),
): CompsFetcher {
  const capture = createCompsObservationFetcher(client, today);
  return async (lot, onProgress) => (await capture(lot, onProgress)).map((item) => item.comp);
}
