import { describe, expect, test } from 'vitest';
import { selectExit, summarizeWreckMarket, quartiles } from './exit';
import type { Comp, SalvageLot } from './types';

const lot: SalvageLot = {
  id: 'sf90-front-il',
  title: '2021 Ferrari SF90 Stradale · front hit',
  make: 'Ferrari',
  model: 'SF90 Stradale',
  year: 2021,
  vin: 'ZFF95NLA2M0263155',
  lotNumber: '63198496',
  source: 'test',
  url: 'https://example.com/lot',
  collectedOn: '2026-08-13',
  damage: { primary: 'FRONT END' },
  titleBrand: 'masked on public listing',
  odometer: 3004,
  location: 'IL',
  engine: '4.0L V8 plug-in hybrid',
  fuel: 'Electric and gas hybrid',
  photos: ['https://cs.copart.com/a.jpg'],
};

const NOW = new Date('2026-08-17T00:00:00Z');
const discount = { low: 0.6, high: 0.7, basis: 'test band' };
const opts = { discount, askHaircut: 0.07, now: NOW };

const comp = (over: Partial<Comp> & { price: number }): Comp => ({
  lane: 'clean',
  outcome: 'sold',
  year: 2021,
  date: '2026-03-01',
  title: 'clean',
  url: `https://classic.com/${over.price}`,
  source: 'classic.com',
  ...over,
});

describe('exit selection from classified comps (SPEC 38)', () => {
  test('clean sold comps derive the band from quartiles times the discount; an outlier is struck, not averaged', () => {
    const comps = [
      comp({ price: 405_000 }),
      comp({ price: 420_000 }),
      comp({ price: 440_000 }),
      comp({ price: 455_000 }),
      comp({ price: 470_000 }),
      comp({ price: 935_000, variant: 'Assetto Fiorano, 300 miles' }), // struck: off-spec AND outlier
    ];
    const exit = selectExit(comps, lot, opts);
    expect(exit).not.toBeNull();
    expect(exit!.lane).toBe('clean_sold_derived');
    expect(exit!.n).toBe(5);
    expect(exit!.thin).toBe(false);
    const q = quartiles([405_000, 420_000, 440_000, 455_000, 470_000]);
    expect(exit!.low).toBe(Math.round(q.p25 * 0.6));
    expect(exit!.typical).toBe(Math.round(q.median * 0.65));
    expect(exit!.high).toBe(Math.round(q.p75 * 0.7));
    const struck = exit!.comps.find((c) => c.comp.price === 935_000);
    expect(struck?.used).toBe(false);
    expect(struck?.reason).toMatch(/off-spec/i);
    expect(exit!.basis).toMatch(/5 clean sold/);
  });

  test('a lone price outlier without a variant label is struck by the MAD rule', () => {
    const comps = [
      comp({ price: 400_000 }),
      comp({ price: 410_000 }),
      comp({ price: 420_000 }),
      comp({ price: 430_000 }),
      comp({ price: 850_000 }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.n).toBe(4);
    expect(exit.comps.find((c) => c.comp.price === 850_000)?.reason).toMatch(/outlier/i);
  });

  test('asks alone derive the band after a haircut to transacted money', () => {
    const comps = [
      comp({ price: 500_000, outcome: 'ask', source: 'cars.com' }),
      comp({ price: 520_000, outcome: 'ask', source: 'cars.com' }),
      comp({ price: 540_000, outcome: 'ask', source: 'cars.com' }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.lane).toBe('clean_ask_derived');
    expect(exit.comps.every((c) => c.adjusted === Math.round(c.comp.price * 0.93))).toBe(true);
    expect(exit.typical).toBe(Math.round(520_000 * 0.93 * 0.65));
    expect(exit.basis).toMatch(/haircut/);
  });

  test('sold comps outrank asks when both exist', () => {
    const comps = [
      comp({ price: 400_000 }),
      comp({ price: 420_000 }),
      comp({ price: 440_000 }),
      comp({ price: 600_000, outcome: 'ask' }),
      comp({ price: 620_000, outcome: 'ask' }),
      comp({ price: 640_000, outcome: 'ask' }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.lane).toBe('clean_sold_derived');
    expect(exit.n).toBe(3);
    // The asks stay in the table, struck with the reason.
    expect(exit.comps.filter((c) => c.comp.outcome === 'ask').every((c) => !c.used)).toBe(true);
  });

  test('two or more rebuilt-title sold comps anchor the exit directly, capped below clean money', () => {
    const comps = [
      comp({ price: 300_000, lane: 'rebuilt', title: 'rebuilt', source: 'bringatrailer.com' }),
      comp({ price: 320_000, lane: 'rebuilt', title: 'rebuilt', source: 'carsandbids.com' }),
      comp({ price: 440_000 }),
      comp({ price: 450_000 }),
      comp({ price: 460_000 }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.lane).toBe('rebuilt_sold');
    expect(exit.typical).toBe(310_000);
    expect(exit.n).toBe(2);
    expect(exit.thin).toBe(true);
    // Rebuilt sold at clean money is not rebuilt data: capped and labeled.
    const close = selectExit(
      [
        comp({ price: 445_000, lane: 'rebuilt', title: 'rebuilt' }),
        comp({ price: 450_000, lane: 'rebuilt', title: 'rebuilt' }),
        comp({ price: 440_000 }),
        comp({ price: 450_000 }),
        comp({ price: 460_000 }),
      ],
      lot,
      opts,
    )!;
    expect(close.lane).toBe('rebuilt_sold');
    expect(close.typical).toBeLessThanOrEqual(Math.round(450_000 * 0.85));
    expect(close.basis).toMatch(/capped/);
  });

  test('a branded title in the clean lane is struck from clean money and counted as rebuilt evidence', () => {
    const comps = [
      comp({ price: 300_000, title: 'rebuilt' }),
      comp({ price: 440_000 }),
      comp({ price: 450_000 }),
      comp({ price: 460_000 }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.lane).toBe('clean_sold_derived');
    expect(exit.n).toBe(3);
    expect(exit.comps.find((c) => c.comp.price === 300_000)?.reason).toMatch(/branded/i);
  });

  test('model years outside the window and stale sales are struck', () => {
    const comps = [
      comp({ price: 300_000, year: 2016 }),
      comp({ price: 440_000 }),
      comp({ price: 450_000 }),
      comp({ price: 460_000 }),
      comp({ price: 600_000, date: '2022-05-01' }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.n).toBe(3);
    expect(exit.comps.find((c) => c.comp.year === 2016)?.reason).toMatch(/model year/i);
    expect(exit.comps.find((c) => c.comp.price === 600_000)?.reason).toMatch(/stale/i);
  });

  test('one comp is a thin band, widened and labeled', () => {
    const exit = selectExit([comp({ price: 450_000 })], lot, opts)!;
    expect(exit.thin).toBe(true);
    expect(exit.low).toBeLessThan(exit.typical);
    expect(exit.high).toBeGreaterThan(exit.typical);
    expect(exit.basis).toMatch(/1 clean sold/);
    expect(exit.basis).toMatch(/thin/i);
  });

  test('no comps falls to the stated ACV, and no ACV means no exit', () => {
    const acv = selectExit([], { ...lot, estRetailValue: 500_000 }, opts)!;
    expect(acv.lane).toBe('acv_derived');
    expect(acv.low).toBe(300_000);
    expect(acv.high).toBe(350_000);
    expect(selectExit([], lot, opts)).toBeNull();
    // Wreck-lane comps never anchor an exit.
    expect(selectExit([comp({ price: 200_000, lane: 'wreck' })], lot, opts)).toBeNull();
  });
});

describe('lanes are what the evidence is, not what the worker echoed', () => {
  test('a salvage-auction listing filed as "rebuilt sold" is wreck evidence, never an exit anchor', () => {
    const comps = [
      comp({
        price: 193_000,
        lane: 'rebuilt',
        source: 'autoastat.com',
        url: 'https://autoastat.com/x',
      }),
      comp({
        price: 157_000,
        lane: 'rebuilt',
        outcome: 'bid_no_sale',
        source: 'thedrive.com',
        url: 'https://thedrive.com/x',
        note: 'Copart Miami, certificate of destruction',
      }),
      comp({ price: 262_000, lane: 'clean', source: 'bid.cars', url: 'https://bid.cars/x' }),
      comp({ price: 440_000 }),
      comp({ price: 450_000 }),
      comp({ price: 460_000 }),
    ];
    const exit = selectExit(comps, lot, opts)!;
    expect(exit.lane).toBe('clean_sold_derived');
    expect(exit.n).toBe(3);
    // None of the salvage listings sit in the exit table.
    expect(exit.comps.some((u) => /autoastat|thedrive|bid\.cars/.test(u.comp.source))).toBe(false);
    const wreck = summarizeWreckMarket(comps, lot, { cleanTypical: 450_000 })!;
    expect(wreck.n).toBe(3);
    expect(wreck.nSold).toBe(2);
  });
});

describe('the wreck market summary (context, never a verdict input)', () => {
  test('sold and no-sale bids are counted apart; clean money in the wreck lane is struck', () => {
    const wreck = summarizeWreckMarket(
      [
        comp({ price: 193_000, lane: 'wreck', outcome: 'bid_no_sale', source: 'autoastat.com' }),
        comp({ price: 262_000, lane: 'wreck', outcome: 'bid_no_sale', source: 'autoastat.com' }),
        comp({ price: 157_000, lane: 'wreck', outcome: 'sold', source: 'thedrive.com' }),
        comp({ price: 850_000, lane: 'wreck', outcome: 'ask', source: 'autoastat.com' }), // retail value in the wreck lane
        comp({ price: 30, lane: 'wreck', outcome: 'sold' }), // pagination artifact
      ],
      lot,
      { cleanTypical: 450_000 },
    )!;
    expect(wreck.n).toBe(3);
    expect(wreck.nSold).toBe(1);
    expect(wreck.median).toBe(193_000);
    expect(wreck.comps.find((c) => c.comp.price === 850_000)?.reason).toMatch(/clean money/i);
    expect(wreck.comps.find((c) => c.comp.price === 30)?.reason).toMatch(/pocket change/i);
    expect(wreck.basis).toMatch(/1 sold, 2 high bids that did not sell/);
  });

  test('no wreck comps means no summary', () => {
    expect(summarizeWreckMarket([comp({ price: 400_000 })], lot, {})).toBeNull();
  });
});
