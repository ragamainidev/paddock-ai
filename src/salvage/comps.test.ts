import { describe, expect, test, vi } from 'vitest';
import { createCompsFetcher, createCompsObservationFetcher, wholeVehicleFloor } from './comps';
import { getSalvageLot } from './seed-lots';
import type { SalvageLot } from './types';

/**
 * The comps fetcher turns raw eBay Browse results into typed comps.
 * Fixtures stand in for the API; the screening rules (clean vs damaged
 * titles, cross-model rejection, fixed-price-only asks, the exotic and
 * premium whole-vehicle floor over the ask lanes, parts and non-vehicle
 * amounts, currency) are what these tests pin.
 */

const lot = () => getSalvageLot('sf90-front-il') as SalvageLot;
// The floor reads the lot's age off the collection date, so every case that
// depends on a band states the clock (SPEC 53).
const COLLECTED_ON = '2026-08-17';
const on2026 = () => COLLECTED_ON;
const otherLot = (make: string, model: string, year: number): SalvageLot => ({
  ...lot(),
  make,
  model,
  title: `${year} ${make} ${model}`,
  year,
});
// Premium tier (`tierFor`): the whole-vehicle floor applies to its ask lanes.
const premiumLot = (): SalvageLot => otherLot('Porsche', '911', 2015);

// Browse returns buyingOptions on every real item summary; the fixtures
// carry it so the absent-field case stays a case of its own.
const car = (title: string, value: string, currency = 'USD') => ({
  itemId: title,
  title,
  itemWebUrl: `https://ebay.com/itm/${encodeURIComponent(title)}`,
  price: { value, currency },
  buyingOptions: ['FIXED_PRICE'],
});

function fakeClient(byCategory: Record<string, unknown[]>) {
  return {
    searchRaw: vi.fn(async (query: string, categoryId: string) => {
      return (byCategory[categoryId] ?? []).filter(Boolean) as never[];
    }),
  };
}

describe('comps fetcher', () => {
  test('clean and damaged asks split by title language into typed comps, each cited', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 Ferrari SF90 Stradale low miles', '450000'),
        car('2022 Ferrari SF90 Stradale spider', '520000'),
        car('2021 Ferrari SF90 Stradale salvage rebuildable front damage', '210000'),
        car('2020 Ferrari SF90 Stradale wrecked project', '180000'),
      ],
    });
    const notes: string[] = [];
    const comps = await createCompsFetcher(client, () => '2026-08-17')(lot(), (n) => notes.push(n));
    const clean = comps.filter((c) => c.lane === 'clean');
    const wreck = comps.filter((c) => c.lane === 'wreck');
    expect(clean.map((c) => c.price)).toEqual([450000]);
    expect(clean.every((c) => c.outcome === 'ask' && c.title === 'unknown')).toBe(true);
    expect(clean[0].year).toBe(2021);
    expect(clean[0].date).toBe('2026-08-17');
    expect(wreck.map((c) => c.price)).toEqual([180000, 210000]);
    expect(wreck.every((c) => c.outcome === 'ask')).toBe(true);
    expect(wreck.map((c) => c.title)).toEqual(['unknown', 'salvage']);
    expect(comps.every((c) => c.url.includes('ebay.com/itm/') && c.source === 'ebay.com')).toBe(
      true,
    );
    expect(notes.some((n) => n.startsWith('[comps]'))).toBe(true);
  });

  test('cross-model listings, non-USD prices, and nonpositive asks are rejected', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 Ferrari 296 GTB', '340000'), // wrong model
        car('2021 Ferrari SF90 Stradale', '30000', 'EUR'), // wrong currency
        car('2021 Ferrari SF90 Stradale', '0'), // not a positive asking price
      ],
    });
    const comps = await createCompsFetcher(client)(lot());
    expect(comps).toHaveLength(0);
  });

  test('a rebuilt-title listing without damage words is rebuilt-lane evidence, not a wreck', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 Ferrari SF90 Stradale rebuilt title', '260000'),
        car('2021 Ferrari SF90 Stradale rebuilt title salvage damage project', '190000'),
      ],
    });
    const comps = await createCompsFetcher(client)(lot());
    expect(comps.map((c) => [c.lane, c.title])).toEqual([
      ['rebuilt', 'rebuilt'],
      ['wreck', 'rebuilt'],
    ]);
  });
});

describe('market applicability and sampling', () => {
  test('rejects partial model matches, other makes, absent years, distant years and incompatible variants', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 Ferrari SF900 Stradale', '350000'),
        car('2021 McLaren SF90 Stradale', '350000'),
        car('Ferrari SF90 Stradale', '350000'),
        car('2010 Ferrari SF90 Stradale', '350000'),
        car('2021 Ferrari SF90 XX Stradale', '350000'),
        car('2021 Ferrari SF90 Stradale Spider', '350000'),
        car('2021 Ferrari SF90 Stradale Assetto Fiorano', '350000'),
        car('2021 Ferrari SF 90 Stradale', '330000'),
      ],
    });
    const values = await createCompsFetcher(client)(lot());
    expect(values.map((value) => value.price)).toEqual([330000]);
  });

  test('does not convert a clean-looking listing or the word sold into a title or sale fact', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 Ferrari SF90 Stradale immaculate sold elsewhere', '350000'),
        car('2021 Ferrari SF90 Stradale clean title', '360000'),
        car('2021 Ferrari SF90 Stradale no clean title', '370000'),
        car('2021 Ferrari SF90 Stradale rebuilt title damage project', '180000'),
      ],
    });
    const values = await createCompsFetcher(client)(lot());
    expect(values.every((value) => value.outcome === 'ask')).toBe(true);
    expect(values.find((value) => value.price === 350000)?.title).toBe('unknown');
    expect(values.find((value) => value.price === 360000)?.title).toBe('clean');
    expect(values.find((value) => value.price === 370000)?.title).toBe('unknown');
    expect(values.find((value) => value.price === 180000)).toMatchObject({
      lane: 'wreck',
      title: 'rebuilt',
    });
  });

  test('retains the eligible price distribution instead of selecting the most expensive asks', async () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      car(`2021 Ferrari SF90 Stradale clean title stock ${i}`, String(200000 + 10000 * i)),
    );
    const client = fakeClient({ '6001': [...items].reverse().concat(items.slice(10, 20)) });
    const selected = await createCompsFetcher(client)(lot());
    expect(selected).toHaveLength(12);
    expect(selected[0].price).toBe(200000);
    expect(selected.at(-1)?.price).toBe(490000);
    expect((selected[5].price + selected[6].price) / 2).toBe(345000);
    const reordered = await createCompsFetcher(fakeClient({ '6001': items }))(lot());
    expect(reordered).toEqual(selected);
  });

  test('retains sub-$10k enthusiast cars and rejects standalone parts or deposit amounts', async () => {
    const target = otherLot('Mazda', 'MX-5 Miata', 2001);
    const client = fakeClient({
      '6001': [
        car('2001 Mazda MX-5 Miata clean title', '5500'),
        car('2001 Mazda MX-5 Miata refundable deposit', '1500'),
        car('2001 Mazda MX-5 Miata monthly payment', '250'),
        car('2001 Mazda MX-5 Miata engine only', '2000'),
        car('2001 Mazda MX-5 Miata OEM headlight assembly', '500'),
      ],
    });
    expect((await createCompsFetcher(client)(target)).map((value) => value.price)).toEqual([5500]);
  });

  test('excludes an AUCTION item: a current bid is not a fixed asking price', async () => {
    const client = fakeClient({
      '6001': [
        {
          ...car('2021 Ferrari SF90 Stradale clean title auction', '150000'),
          buyingOptions: ['AUCTION'],
          currentBidPrice: { value: '150000', currency: 'USD' },
        },
        {
          ...car('2021 Ferrari SF90 Stradale clean title buy now', '350000'),
          buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
        },
      ],
    });
    expect((await createCompsFetcher(client)(lot())).map((value) => value.price)).toEqual([350000]);
  });

  test('excludes an item that does not declare FIXED_PRICE', async () => {
    const silent = {
      itemId: 'silent',
      title: '2021 Ferrari SF90 Stradale clean title',
      itemWebUrl: 'https://ebay.com/itm/silent',
      price: { value: '340000', currency: 'USD' },
    };
    const client = fakeClient({
      '6001': [silent, car('2021 Ferrari SF90 Stradale clean title buy now', '350000')],
    });
    expect((await createCompsFetcher(client)(lot())).map((value) => value.price)).toEqual([350000]);
  });

  test('applies the whole-vehicle floor to exotic and premium tiers', async () => {
    const exotic = fakeClient({
      '6001': [
        car('2021 Ferrari SF90 Stradale carbon rear spoiler', '6500'),
        car('2021 Ferrari SF90 Stradale clean title', '350000'),
      ],
    });
    expect((await createCompsFetcher(exotic, on2026)(lot())).map((value) => value.price)).toEqual([
      350000,
    ]);

    const premium = fakeClient({
      '6001': [
        car('2015 Porsche 911 leather seat set', '6500'),
        car('2015 Porsche 911 clean title', '62000'),
      ],
    });
    expect(
      (await createCompsFetcher(premium, on2026)(premiumLot())).map((value) => value.price),
    ).toEqual([62000]);
  });

  test('a sub-floor damaged listing on a premium lot survives into the wreck lane', async () => {
    const client = fakeClient({
      '6001': [
        car('2015 Porsche 911 salvage rebuildable front damage', '8500'),
        car('2015 Porsche 911 clean title', '62000'),
      ],
    });
    const comps = await createCompsFetcher(client, on2026)(premiumLot());
    expect(comps.map((value) => [value.lane, value.price])).toEqual([
      ['clean', 62000],
      ['wreck', 8500],
    ]);
  });

  test('a sub-floor clean-titled listing on a premium lot is excluded', async () => {
    const client = fakeClient({
      '6001': [
        car('2015 Porsche 911 clean title', '8500'),
        car('2015 Porsche 911 clean title low miles', '62000'),
      ],
    });
    expect(
      (await createCompsFetcher(client, on2026)(premiumLot())).map((value) => value.price),
    ).toEqual([62000]);
  });

  test('keeps a cheap mainstream whole car', async () => {
    const target = otherLot('Mazda', 'MX-5 Miata', 2001);
    const client = fakeClient({ '6001': [car('2001 Mazda MX-5 Miata clean title', '6500')] });
    expect((await createCompsFetcher(client)(target)).map((value) => value.price)).toEqual([6500]);
  });

  test('the whole-vehicle floor states its tier and its age band', () => {
    const now = new Date('2026-08-17T00:00:00');
    expect(wholeVehicleFloor('exotic', 1995, now)).toEqual({
      usd: 10_000,
      basis: 'exotic, any model year: whole cars list from $10,000',
    });
    expect(wholeVehicleFloor('premium', 2021, now)).toEqual({
      usd: 10_000,
      basis: 'premium, 12 model years or newer: whole cars list from $10,000',
    });
    expect(wholeVehicleFloor('premium', 2006, now)).toEqual({
      usd: 4_000,
      basis: 'premium, 13–20 model years: whole cars list from $4,000',
    });
    expect(wholeVehicleFloor('premium', 2003, now)).toEqual({
      usd: 0,
      basis: 'premium, over 20 model years: no whole-vehicle floor',
    });
    expect(wholeVehicleFloor('mainstream', 2021, now)).toEqual({
      usd: 0,
      basis: 'mainstream, any model year: no whole-vehicle floor',
    });
  });

  test('an unreadable model year or clock takes the strictest band: the screen fails closed', () => {
    // A NaN age exceeds no bound, so the first band answers rather than the
    // loosest one: a year nobody could read never buys a lot its floor.
    expect(wholeVehicleFloor('premium', Number.NaN, new Date('2026-08-17T00:00:00'))).toEqual({
      usd: 10_000,
      basis: 'premium, 12 model years or newer: whole cars list from $10,000',
    });
    expect(wholeVehicleFloor('premium', 2003, new Date('not a date'))).toEqual({
      usd: 10_000,
      basis: 'premium, 12 model years or newer: whole cars list from $10,000',
    });
  });

  test('a collection date that carries a time reads its calendar year', async () => {
    // The band is read off the collection date, and a caller that hands the
    // fetcher a full ISO timestamp must not lose the year to an invalid clock.
    const target = otherLot('BMW', '330i', 2003);
    const client = fakeClient({ '6001': [car('2003 BMW 330i clean title', '6500')] });
    const notes: string[] = [];
    const comps = await createCompsFetcher(client, () => '2026-09-11T14:32:07.000Z')(
      target,
      (note) => notes.push(note),
    );
    expect(notes[0]).toContain('premium, over 20 model years: no whole-vehicle floor');
    expect(comps.map((value) => value.price)).toEqual([6500]);
  });

  test('an old premium car is a whole car under $10,000: a 2003 330i and a 2006 IS survive', async () => {
    const bmw = fakeClient({ '6001': [car('2003 BMW 330i clean title', '6500')] });
    const notes: string[] = [];
    const bmwComps = await createCompsFetcher(bmw, on2026)(otherLot('BMW', '330i', 2003), (n) =>
      notes.push(n),
    );
    expect(bmwComps.map((value) => [value.lane, value.price])).toEqual([['clean', 6500]]);
    expect(notes[0]).toContain('premium, over 20 model years: no whole-vehicle floor');

    const lexus = fakeClient({ '6001': [car('2006 Lexus IS clean title', '6500')] });
    const lexusComps = await createCompsFetcher(lexus, on2026)(otherLot('Lexus', 'IS', 2006));
    expect(lexusComps.map((value) => [value.lane, value.price])).toEqual([['clean', 6500]]);
  });

  test('a recent premium car keeps the $10,000 floor: a 2021 M3 at $6,500 is parts money', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 BMW M3 clean title', '6500'),
        car('2021 BMW M3 clean title low miles', '68000'),
      ],
    });
    const notes: string[] = [];
    const comps = await createCompsFetcher(client, on2026)(otherLot('BMW', 'M3', 2021), (n) =>
      notes.push(n),
    );
    expect(comps.map((value) => value.price)).toEqual([68000]);
    expect(notes[0]).toContain('premium, 12 model years or newer: whole cars list from $10,000');
    expect(notes.at(-1)).toContain('1 under the whole-vehicle floor');
  });

  test('the premium floor is $4,000 between thirteen and twenty model years', async () => {
    const target = otherLot('Audi', 'S5', 2010);
    const notes: string[] = [];
    const below = fakeClient({ '6001': [car('2010 Audi S5 clean title', '3500')] });
    expect(await createCompsFetcher(below, on2026)(target, (n) => notes.push(n))).toEqual([]);
    expect(notes[0]).toContain('premium, 13–20 model years: whole cars list from $4,000');

    const above = fakeClient({ '6001': [car('2010 Audi S5 clean title', '4500')] });
    expect((await createCompsFetcher(above, on2026)(target)).map((value) => value.price)).toEqual([
      4500,
    ]);
  });

  test('an exotic carries the whole-vehicle floor at any model year', async () => {
    const client = fakeClient({
      '6001': [
        car('1995 Lamborghini Diablo carbon rear spoiler', '6500'),
        car('1995 Lamborghini Diablo clean title', '285000'),
      ],
    });
    expect(
      (await createCompsFetcher(client, on2026)(otherLot('Lamborghini', 'Diablo', 1995))).map(
        (value) => value.price,
      ),
    ).toEqual([285000]);
  });

  test('the progress note counts the listings the screens dropped', async () => {
    const client = fakeClient({
      '6001': [
        car('2021 Ferrari SF90 Stradale clean title', '350000'),
        car('2021 Ferrari SF90 Stradale clean title low miles', '365000'),
        {
          ...car('2021 Ferrari SF90 Stradale no reserve', '255000'),
          buyingOptions: ['AUCTION'],
        },
        {
          itemId: 'silent',
          title: '2021 Ferrari SF90 Stradale rebuilt title',
          itemWebUrl: 'https://ebay.com/itm/silent',
          price: { value: '310000', currency: 'USD' },
        },
        car('2021 Ferrari SF90 Stradale carbon fiber rear spoiler', '6500'),
        car('2019 Lamborghini Huracan clean title', '250000'),
      ],
    });
    const notes: string[] = [];
    await createCompsFetcher(client, on2026)(lot(), (n) => notes.push(n));
    // Six results in, two eligible: every one the screens removed is counted,
    // so the arithmetic closes against what survived them.
    expect(notes.at(-1)).toBe(
      "[comps] 2 applicable asks sampled across 2 eligible listings; 4 dropped: 2 no fixed price, 1 under the whole-vehicle floor, 1 outside this lot's market; 0 title statuses unknown; no completed sales",
    );
  });

  test('preserves the original provider item separately from the extracted comp', async () => {
    const original = {
      ...car('2021 Ferrari SF90 Stradale clean title', '350000'),
      condition: 'Used',
      futureProviderField: { detail: 'retained' },
    };
    const observations = await createCompsObservationFetcher(
      fakeClient({ '6001': [original] }),
      () => '2026-09-06',
    )(lot());
    expect(observations[0].raw).toEqual(original);
    expect(observations[0].comp).toMatchObject({ price: 350000, title: 'clean', outcome: 'ask' });
    expect(observations[0].raw).not.toHaveProperty('outcome');
  });
});
