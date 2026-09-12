import { describe, expect, it } from 'vitest';
import { summarizeOutcomes, type OutcomeCase } from '@/assessment-reporting/outcomes';
import { calibrationExclusions, calibrationRows, calibrationSummary } from './calibration-format';

function lot(
  id: string,
  o: { hammer: number; repairCost: number; market?: number | null },
): OutcomeCase {
  return {
    id,
    mode: 'live',
    history: [
      {
        revision: 1,
        at: '2026-09-01T00:00:00Z',
        ceiling: 20000,
        report: { plan: { low: 10000, expected: 15000, high: 20000 } },
        buyerEconomics: {
          maxBid: 20000,
          market: { maxBid: o.market === undefined ? 26000 : o.market },
          exit: { typical: 40000 },
          lines: [{ group: 'selling', expected: 2000 }],
        },
      },
    ],
    outcomes: [
      {
        kind: 'purchased',
        at: '2026-09-02T00:00:00Z',
        observedAt: '2026-09-02T00:00:00Z',
        decisionRevision: 1,
        hammer: o.hammer,
      },
      {
        kind: 'observed',
        at: '2026-09-03T00:00:00Z',
        observedAt: '2026-09-03T00:00:00Z',
        decisionRevision: 1,
        repairCost: o.repairCost,
      },
    ],
  };
}

const read = summarizeOutcomes([
  lot('a', { hammer: 19000, repairCost: 12000 }),
  lot('b', { hammer: 20000, repairCost: 14000 }),
  lot('c', { hammer: 21000, repairCost: 15000 }),
  lot('d', { hammer: 22000, repairCost: 16000 }),
  lot('e', { hammer: 23000, repairCost: 25000, market: null }),
]);
const cell = (id: string) => calibrationRows(read).find((row) => row.id === id)!;

describe('the calibration view states what it read and over what', () => {
  it('summarizes the section by what was matched and what was set aside', () => {
    expect(calibrationSummary(read)).toBe('calibration — 10 matched outcomes');
    expect(
      calibrationSummary(
        summarizeOutcomes([{ ...lot('f', { hammer: 1, repairCost: 1 }), mode: 'fixture' }]),
      ),
    ).toBe('calibration — 0 matched outcomes · 1 fixture excluded');
    expect(calibrationExclusions(read)).toBe(
      'Recorded demonstrations (0) and outcomes with no earlier forecast (0) are excluded.',
    );
  });

  it('states a share as its count over its denominator, and money with its spread', () => {
    expect(cell('purchases-above-ceiling')).toEqual({
      id: 'purchases-above-ceiling',
      label: 'purchases above the decision ceiling',
      value: '3 of 5 · 60%',
      basis: 'over 5 lots purchased',
    });
    expect(cell('repair-range-coverage').value).toBe('4 of 5 · 80%');
    expect(cell('hammer-vs-your-ceiling')).toEqual({
      id: 'hammer-vs-your-ceiling',
      label: 'hammer minus your ledger ceiling',
      value: '$1,000 median · $0 to $2,000 interquartile',
      basis: 'over 5 lots the market priced',
    });
    expect(cell('repair-residual').value).toBe('$0 median · −$1,000 to $1,000 interquartile');
    expect(cell('repair-residual').basis).toBe('over 5 lots with a recorded repair');
    expect(cell('repair-range-coverage').basis).toBe('over 5 lots with a recorded repair');
  });

  it('prints no number under five outcomes and says what the statistic could not read', () => {
    expect(cell('hammer-vs-market-ceiling')).toEqual({
      id: 'hammer-vs-market-ceiling',
      label: 'hammer minus what a pro can pay',
      value: 'too few outcomes to read (4 of 5)',
      basis: 'over 4 lots the market priced · 1 excluded: the decision solved no market ceiling',
    });
    const empty = calibrationRows(summarizeOutcomes([]));
    expect(empty.map((row) => row.value)).toEqual(
      Array(6).fill('too few outcomes to read (0 of 5)'),
    );
    expect(empty.find((row) => row.id === 'exit-residual')!.basis).toBe('over 0 lots sold');
  });

  it('names one lot as one observation in the basis it states', () => {
    const one = summarizeOutcomes([lot('a', { hammer: 21000, repairCost: 12000 })]);
    expect(calibrationRows(one).find((row) => row.id === 'purchases-above-ceiling')!.basis).toBe(
      'over 1 lot purchased',
    );
    expect(calibrationRows(one).find((row) => row.id === 'repair-residual')!.basis).toBe(
      'over 1 lot with a recorded repair',
    );
    expect(calibrationSummary(one)).toBe('calibration — 2 matched outcomes');
  });

  it('distinguishes the decision ceiling from the buyer ledger ceiling after a veto', () => {
    const vetoed = [19000, 20000, 21000, 22000, 23000].map((hammer, index) => {
      const item = lot(String(index), { hammer, repairCost: 15000 });
      return { ...item, history: [{ ...item.history[0], ceiling: 0 }] };
    });
    const rows = calibrationRows(summarizeOutcomes(vetoed));
    expect(rows.find((row) => row.id === 'purchases-above-ceiling')).toMatchObject({
      label: 'purchases above the decision ceiling',
      value: '5 of 5 · 100%',
    });
    expect(rows.find((row) => row.id === 'hammer-vs-your-ceiling')).toMatchObject({
      label: 'hammer minus your ledger ceiling',
      value: '$1,000 median · $0 to $2,000 interquartile',
    });
  });

  it('states the net exit comparison and the selling line a sold lot needs', () => {
    const sold = {
      ...lot('sold', { hammer: 21000, repairCost: 12000 }),
      outcomes: [
        {
          kind: 'sold',
          at: '2026-09-04T00:00:00Z',
          observedAt: '2026-09-04T00:00:00Z',
          decisionRevision: 1,
          saleProceeds: 38000,
        },
      ],
    };
    const missingSelling = {
      ...sold,
      id: 'missing-selling',
      history: [
        {
          ...sold.history[0],
          buyerEconomics: { ...sold.history[0].buyerEconomics!, lines: undefined },
        },
      ],
    };
    expect(
      calibrationRows(summarizeOutcomes([sold, missingSelling])).find(
        (row) => row.id === 'exit-residual',
      ),
    ).toEqual({
      id: 'exit-residual',
      label: 'net proceeds minus the typical exit net of selling costs',
      value: 'too few outcomes to read (1 of 5)',
      basis: 'over 1 lot sold · 1 excluded: the decision carried no exit band or selling cost line',
    });
  });
});
