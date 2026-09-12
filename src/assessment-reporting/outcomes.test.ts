import { describe, expect, it } from 'vitest';
import { summarizeOutcomes, type OutcomeCase } from './outcomes';

const example: OutcomeCase = {
  id: 'car',
  mode: 'live',
  history: [
    {
      revision: 2,
      at: '2026-09-01T00:00:00Z',
      ceiling: 20000,
      report: { plan: { low: 10000, expected: 15000, high: 20000 } },
    },
  ],
  outcomes: [
    {
      kind: 'purchased',
      at: '2026-09-03T00:00:00Z',
      observedAt: '2026-09-02T00:00:00Z',
      decisionRevision: 2,
      amount: 21000,
      repairCost: 18000,
    },
  ],
};
describe('outcome calibration without hindsight or synthetic inflation', () => {
  it('measures observed repair error and over-ceiling purchase against the selected earlier forecast', () => {
    const report = summarizeOutcomes([example]);
    expect(report.repairObservations).toBe(1);
    expect(report.meanRepairError).toBe(3000);
    expect(report.repairRangeCoverage).toBe(1);
    expect(report.purchasesAboveCeiling).toBe(1);
    expect(report.rows[0].purchaseOverCeiling).toBe(1000);
  });
  it('reads a purchase price from the hammer field a newer record states (SPEC 62)', () => {
    const hammered = {
      ...example,
      outcomes: [{ ...example.outcomes[0], amount: undefined, hammer: 21000 }],
    };
    expect(summarizeOutcomes([hammered]).rows[0].purchaseOverCeiling).toBe(1000);
    // A lot the owner did not buy states a price but never a purchase.
    const lost = {
      ...example,
      outcomes: [
        { ...example.outcomes[0], kind: 'lost_to_hammer', amount: undefined, hammer: 21000 },
      ],
    };
    expect(summarizeOutcomes([lost]).purchaseObservations).toBe(0);
  });
  it('excludes fixture cases and future forecasts rather than counting them as success', () => {
    const fixture = { ...example, mode: 'fixture' as const };
    const future = {
      ...example,
      id: 'future',
      outcomes: [{ ...example.outcomes[0], observedAt: '2026-08-01T00:00:00Z' }],
    };
    const report = summarizeOutcomes([fixture, future]);
    expect(report.repairObservations).toBe(0);
    expect(report.meanRepairError).toBeNull();
    expect(report.repairRangeCoverage).toBeNull();
    expect(report.excludedFixtures).toBe(1);
    expect(report.unmatchedOutcomes).toBe(1);
  });
  it('uses one latest repair observation per car and treats zero as observed', () => {
    const report = summarizeOutcomes([
      {
        ...example,
        outcomes: [
          ...example.outcomes,
          {
            kind: 'observed',
            at: '2026-09-04T00:00:00Z',
            observedAt: '2026-09-04T00:00:00Z',
            decisionRevision: 2,
            repairCost: 0,
          },
        ],
      },
    ]);
    expect(report.repairObservations).toBe(1);
    expect(report.meanRepairError).toBe(-15000);
    expect(report.repairRangeCoverage).toBe(0);
  });
});

// Five lots priced against the same forecast: a ceiling of $20,000, a repair
// plan of $10,000–20,000 expecting $15,000, a buyer ceiling of $20,000, a
// market ceiling of $26,000 and a typical exit of $40,000 with no selling fee.
function lot(
  id: string,
  o: { hammer: number; repairCost: number; saleProceeds: number; market?: number | null },
): OutcomeCase {
  const market =
    o.market === undefined ? { market: { maxBid: 26000 } } : { market: { maxBid: o.market } };
  return {
    id,
    mode: 'live',
    history: [
      {
        revision: 2,
        at: '2026-09-01T00:00:00Z',
        ceiling: 20000,
        report: { plan: { low: 10000, expected: 15000, high: 20000 } },
        buyerEconomics: {
          maxBid: 20000,
          ...market,
          exit: { typical: 40000 },
          lines: [{ group: 'selling', expected: 0 }],
        },
      },
    ],
    outcomes: [
      {
        kind: 'purchased',
        at: '2026-09-02T00:00:00Z',
        observedAt: '2026-09-02T00:00:00Z',
        decisionRevision: 2,
        hammer: o.hammer,
      },
      {
        kind: 'observed',
        at: '2026-09-03T00:00:00Z',
        observedAt: '2026-09-03T00:00:00Z',
        decisionRevision: 2,
        repairCost: o.repairCost,
      },
      {
        kind: 'sold',
        at: '2026-09-04T00:00:00Z',
        observedAt: '2026-09-04T00:00:00Z',
        decisionRevision: 2,
        saleProceeds: o.saleProceeds,
      },
    ],
  };
}

const five = [
  lot('a', { hammer: 19000, repairCost: 12000, saleProceeds: 38000 }),
  lot('b', { hammer: 20000, repairCost: 14000, saleProceeds: 39000 }),
  lot('c', { hammer: 21000, repairCost: 15000, saleProceeds: 40000 }),
  lot('d', { hammer: 22000, repairCost: 16000, saleProceeds: 41000 }),
  lot('e', { hammer: 23000, repairCost: 25000, saleProceeds: 46000 }),
];

describe('calibration statistics, each with its own denominator (SPEC 63)', () => {
  it('reads every statistic off the observations it could match against an earlier forecast', () => {
    const report = summarizeOutcomes(five);
    expect(report.matchedOutcomes).toBe(15);
    expect(report.statistics.purchasesAboveCeiling).toEqual({
      n: 5,
      excluded: 0,
      value: { count: 3, share: 0.6 },
    });
    expect(report.statistics.hammerVsBuyerCeiling).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: 0, median: 1000, q3: 2000 },
    });
    expect(report.statistics.hammerVsMarketCeiling).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: -6000, median: -5000, q3: -4000 },
    });
    expect(report.statistics.repairRangeCoverage).toEqual({
      n: 5,
      excluded: 0,
      value: { count: 4, share: 0.8 },
    });
    expect(report.statistics.repairResidual).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: -1000, median: 0, q3: 1000 },
    });
    expect(report.statistics.exitResidual).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: -1000, median: 0, q3: 1000 },
    });
  });

  it('prints no number below five matched outcomes, and a recorded demonstration is not one', () => {
    const report = summarizeOutcomes([{ ...five[0], mode: 'fixture' }, ...five.slice(1)]);
    expect(report.excludedFixtures).toBe(1);
    expect(report.matchedOutcomes).toBe(12);
    for (const statistic of Object.values(report.statistics)) {
      expect(statistic).toMatchObject({ n: 4, tooFew: true });
      expect(statistic).not.toHaveProperty('value');
    }
  });

  it('excludes a forecast that never held the figure from that statistic alone', () => {
    const report = summarizeOutcomes([
      lot('a', { hammer: 19000, repairCost: 12000, saleProceeds: 38000, market: null }),
      ...five.slice(1),
    ]);
    expect(report.statistics.hammerVsMarketCeiling).toEqual({ n: 4, excluded: 1, tooFew: true });
    expect(report.statistics.hammerVsBuyerCeiling).toMatchObject({ n: 5, excluded: 0 });
    expect(report.unmatchedOutcomes).toBe(0);
  });

  it("compares net proceeds with the typical exit net of the compared revision's selling costs", () => {
    const cases = five.map((item) => ({
      ...item,
      history: [
        {
          ...item.history[0],
          buyerEconomics: {
            ...item.history[0].buyerEconomics!,
            lines: [
              { group: 'labor', expected: 9000 },
              { group: 'selling', expected: 2000 },
            ],
          },
        },
        {
          ...item.history[0],
          revision: 3,
          at: '2026-09-05T00:00:00Z',
          buyerEconomics: {
            maxBid: 30000,
            exit: { typical: 70000 },
            lines: [{ group: 'selling', expected: 9000 }],
          },
        },
      ],
    }));
    // Revision 2 forecast $38,000 net. Net proceeds of $38k, $39k, $40k,
    // $41k and $46k leave residuals of $0, $1k, $2k, $3k and $8k.
    expect(summarizeOutcomes(cases).statistics.exitResidual).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: 1000, median: 2000, q3: 3000 },
    });
  });

  it.each([
    { name: 'no cost lines', lines: undefined },
    { name: 'only other cost lines', lines: [{ group: 'labor', expected: 2000 }] },
  ])('excludes a lot with $name from the exit statistic alone', ({ lines }) => {
    const missingSelling = {
      ...five[0],
      history: [
        {
          ...five[0].history[0],
          buyerEconomics: { ...five[0].history[0].buyerEconomics!, lines },
        },
      ],
      outcomes: [
        ...five[0].outcomes,
        { ...five[0].outcomes[2], at: '2026-09-05T00:00:00Z', saleProceeds: 39000 },
      ],
    };
    const report = summarizeOutcomes([missingSelling, ...five.slice(1)]);
    expect(report.statistics.exitResidual).toEqual({ n: 4, excluded: 1, tooFew: true });
    expect(report.statistics.repairResidual).toMatchObject({ n: 5, excluded: 0 });
    expect(report.statistics.hammerVsBuyerCeiling).toMatchObject({ n: 5, excluded: 0 });
    expect(report.matchedOutcomes).toBe(16);
    expect(report.unmatchedOutcomes).toBe(0);
  });

  it('measures a lot the market answered without the owner buying it, but never as a purchase', () => {
    const lost = {
      ...five[0],
      outcomes: five[0].outcomes.map((o) =>
        o.kind === 'purchased' ? { ...o, kind: 'lost_to_hammer' } : o,
      ),
    };
    const report = summarizeOutcomes([lost, ...five.slice(1)]);
    expect(report.statistics.hammerVsBuyerCeiling).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: 0, median: 1000, q3: 2000 },
    });
    expect(report.statistics.purchasesAboveCeiling).toEqual({ n: 4, excluded: 0, tooFew: true });
  });

  it('counts a lot once per statistic however many times it was reported', () => {
    const twice = {
      ...five[4],
      outcomes: [
        ...five[4].outcomes,
        {
          kind: 'sold',
          at: '2026-09-05T00:00:00Z',
          observedAt: '2026-09-05T00:00:00Z',
          decisionRevision: 2,
          saleProceeds: 39500,
        },
      ],
    };
    const report = summarizeOutcomes([...five.slice(0, 4), twice]);
    // The later sale is the one read: $39,500 against the $40,000 typical exit,
    // which moves the middle the first sale of the same lot had set.
    expect(report.statistics.exitResidual).toEqual({
      n: 5,
      excluded: 0,
      value: { q1: -1000, median: -500, q3: 0 },
    });
    expect(report.matchedOutcomes).toBe(16);
  });
});
