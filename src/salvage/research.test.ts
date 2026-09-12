import { describe, expect, test } from 'vitest';
import {
  isEmptyEvidence,
  needsEvidenceRepair,
  parseComps,
  parseNotes,
  parsePrices,
  runSalvageEvidence,
  salvageEvidenceTopics,
  type SalvageEvidenceCaller,
} from './research';
import { getSalvageLot } from './seed-lots';

const sf90 = getSalvageLot('sf90-front-il')!;

describe('structured evidence parsing (SPEC 44)', () => {
  test('comps parse one at a time: the asked lane is stamped, bad items drop, good ones survive', () => {
    const comps = parseComps(
      {
        comps: [
          {
            price: 412000,
            outcome: 'sold',
            year: 2021,
            mileage: 2100,
            date: '2026-03-14',
            title: 'clean',
            url: 'https://www.classic.com/veh/1',
            source_title: '2021 Ferrari SF90 Stradale',
          },
          { price: '$850,000 retail', outcome: 'ask', url: 'https://x.com/1', source_title: 'x' }, // not a number
          { price: 193000, outcome: 'bid_no_sale', url: 'autoastat.com/x', source_title: 'x' }, // not http(s)
          { price: -5, outcome: 'sold', url: 'https://x.com/2', source_title: 'x' },
          {
            price: 262000,
            outcome: 'bid_no_sale',
            url: 'https://autoastat.com/x',
            source_title: 'lot 5670',
          },
        ],
        notes: [],
      },
      'wreck',
    );
    expect(comps).toHaveLength(2);
    expect(comps.every((c) => c.lane === 'wreck')).toBe(true);
    expect(comps[0].source).toBe('classic.com');
    expect(comps[0].mileage).toBe(2100);
    expect(comps[1].outcome).toBe('bid_no_sale');
    expect(comps[1].note).toBe('lot 5670');
  });

  test('a retail value written into a wreck comp cannot bleed: there is no field for it', () => {
    // The old failure: "$193,000-$262,000 (bids, not sold) vs $850,000 retail
    // value" parsed as a $193k–$850k band. Structured comps carry ONE price.
    const comps = parseComps(
      {
        comps: [
          {
            price: 193000,
            outcome: 'bid_no_sale',
            url: 'https://autoastat.com/x',
            source_title: 'x',
            note: 'retail value $850,000',
          },
        ],
        notes: [],
      },
      'wreck',
    );
    expect(comps.map((c) => c.price)).toEqual([193000]);
  });

  test('prices parse with the line stamped, low/high ordered, and bad rows dropped', () => {
    const prices = parsePrices(
      {
        prices: [
          {
            item: 'LED headlamp assembly, left',
            kind: 'part_new',
            low: 11200,
            high: 9800,
            url: 'https://eurospares.co.uk/x',
            source_title: 'Eurospares',
          },
          {
            item: 'ghost',
            kind: 'part_new',
            low: 1,
            high: 2,
            url: 'ftp://nope',
            source_title: 'x',
          },
          {
            item: 'ghost',
            kind: 'labor',
            low: 'a lot',
            high: 2,
            url: 'https://x.com',
            source_title: 'x',
          },
        ],
        notes: [],
      },
      'front.lamps',
    );
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      line: 'front.lamps',
      low: 9800,
      high: 11200,
      source: 'eurospares.co.uk',
    });
  });

  test('notes become cited findings; uncited notes are dropped', () => {
    const notes = parseNotes(
      {
        notes: [
          { text: 'no rebuilt SF90 has sold publicly', url: 'https://ferrarichat.com/t' },
          { text: 'x', url: 'nope' },
        ],
      },
      'topic',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].sources[0].url).toBe('https://ferrarichat.com/t');
    expect(notes[0].severity).toBe('info');
  });

  test('malformed and empty payloads parse to nothing, never throw', () => {
    expect(parseComps(null, 'clean')).toEqual([]);
    expect(parseComps({ nonsense: true }, 'clean')).toEqual([]);
    expect(parsePrices('text', 'x')).toEqual([]);
    expect(parseNotes(undefined, 'x')).toEqual([]);
  });

  test('repair and empty detection: uncited items need a fix; an honest empty list is empty', () => {
    const uncited = {
      comps: [{ price: 1000, outcome: 'sold', url: 'no-url', source_title: 'x' }],
      notes: [],
    };
    expect(needsEvidenceRepair(uncited, 'comps')).toBe(true);
    expect(isEmptyEvidence(uncited, 'comps')).toBe(false);
    expect(needsEvidenceRepair({ comps: [], notes: [] }, 'comps')).toBe(false);
    expect(isEmptyEvidence({ comps: [], notes: [] }, 'comps')).toBe(true);
    expect(
      needsEvidenceRepair(
        {
          prices: [
            { item: 'x', kind: 'labor', low: 1, high: 2, url: 'https://x.com', source_title: '' },
          ],
          notes: [],
        },
        'prices',
      ),
    ).toBe(false);
  });
});

describe('the evidence plan', () => {
  test('four market lanes plus one worker per repair line; the eBay-covered ask lane is skipped', () => {
    const topics = salvageEvidenceTopics(sf90, [
      { lineId: 'front.structure', topic: 'SF90 front frame repair cost', reason: 'r' },
      { lineId: 'front.lamps', topic: 'SF90 headlamp price', reason: 'r' },
    ]);
    expect(topics.map((t) => t.id)).toEqual([
      'comps.rebuilt',
      'comps.clean_sold',
      'comps.clean_asks',
      'comps.wreck',
      'prices.front.structure',
      'prices.front.lamps',
    ]);
    expect(
      topics.filter((t) => t.kind === 'comps').map((t) => t.kind === 'comps' && t.lane),
    ).toEqual(['rebuilt', 'clean', 'clean', 'wreck']);
    const covered = salvageEvidenceTopics(sf90, [], { cleanAsks: true });
    expect(covered.map((t) => t.id)).toEqual(['comps.rebuilt', 'comps.clean_sold', 'comps.wreck']);
    expect(topics.every((t) => t.topic.includes('SF90') || t.topic.includes('Ferrari'))).toBe(true);
  });

  test('runSalvageEvidence routes each payload to its topic parser and merges the results', async () => {
    const topics = salvageEvidenceTopics(sf90, [
      { lineId: 'front.lamps', topic: 'SF90 headlamp price', reason: 'r' },
    ]);
    const caller: SalvageEvidenceCaller = async ({ topics: asked }) => ({
      results: asked.map((t) => ({
        id: t.id,
        payload:
          t.kind === 'comps'
            ? {
                comps: [
                  {
                    price: 400000,
                    outcome: 'sold',
                    url: 'https://classic.com/1',
                    source_title: 'x',
                  },
                ],
                notes: [{ text: `note for ${t.id}`, url: 'https://classic.com/n' }],
              }
            : {
                prices: [
                  {
                    item: 'headlamp',
                    kind: 'part_new',
                    low: 9000,
                    high: 11000,
                    url: 'https://eurospares.co.uk/1',
                    source_title: 'x',
                  },
                ],
                notes: [],
              },
      })),
    });
    const result = await runSalvageEvidence(sf90, topics, caller);
    expect(result.comps).toHaveLength(4);
    expect(new Set(result.comps.map((c) => c.lane))).toEqual(
      new Set(['rebuilt', 'clean', 'wreck']),
    );
    expect(result.prices).toEqual([
      expect.objectContaining({ line: 'front.lamps', low: 9000, high: 11000 }),
    ]);
    expect(result.notes).toHaveLength(4);
  });

  test('a null payload (worker died) contributes nothing; a malformed result set throws', async () => {
    const topics = salvageEvidenceTopics(sf90, []);
    const dead: SalvageEvidenceCaller = async ({ topics: asked }) => ({
      results: asked.map((t) => ({ id: t.id, payload: null })),
    });
    const result = await runSalvageEvidence(sf90, topics, dead);
    expect(result).toEqual({ comps: [], prices: [], notes: [] });
    await expect(runSalvageEvidence(sf90, topics, async () => 'garbage')).rejects.toThrow(
      /malformed/,
    );
    expect(await runSalvageEvidence(sf90, [], dead)).toEqual({ comps: [], prices: [], notes: [] });
  });
});
