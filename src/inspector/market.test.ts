import { describe, expect, test } from 'vitest';
import { marketFromComps, repairExposure } from './market';
import type { DetectedIssue, DetectedModification, MarketComp } from './types';

const issue = (severity: DetectedIssue['severity'], type: DetectedIssue['type'] = 'rust') =>
  ({ type, severity, description: 'x', photos: [0] }) as DetectedIssue;

const comps: MarketComp[] = [
  { title: 'a', price: 20000, url: 'https://x.test/a' },
  { title: 'b', price: 30000, url: 'https://x.test/b' },
  { title: 'c', price: 25000, url: 'https://x.test/c' },
  { title: 'd', price: 90000, url: 'https://x.test/d' },
  { title: 'e', price: 15000, url: 'https://x.test/e' },
];

describe('repairExposure', () => {
  test('sums severity bands and names the drivers', () => {
    const exposure = repairExposure([issue('critical', 'frame_damage'), issue('medium')], []);
    expect(exposure.low).toBe(2800);
    expect(exposure.high).toBe(9200);
    expect(exposure.drivers).toEqual(['critical frame damage', 'medium rust']);
  });

  test('budget and unknown mods add exposure; quality ones do not', () => {
    const mods: DetectedModification[] = [
      { type: 'suspension', description: 'x', quality: 'budget_aftermarket', photos: [] },
      { type: 'exhaust', description: 'x', quality: 'quality_aftermarket', photos: [] },
    ];
    const exposure = repairExposure([], mods);
    expect(exposure.low).toBe(500);
    expect(exposure.high).toBe(2000);
    expect(exposure.drivers).toEqual(['budget aftermarket suspension']);
  });

  test('clean car has zero exposure', () => {
    expect(repairExposure([], [])).toEqual({ low: 0, high: 0, drivers: [] });
  });
});

describe('marketFromComps', () => {
  const exposure = { low: 0, high: 0, drivers: [] };

  test('computes low/median/high from comps', () => {
    const m = marketFromComps(comps, 'test comps', undefined, exposure)!;
    expect(m.low).toBe(15000);
    expect(m.median).toBe(25000);
    expect(m.high).toBe(90000);
    expect(m.sampleSize).toBe(5);
    expect(m.position).toBeUndefined();
  });

  test('even sample size medians the middle pair', () => {
    const m = marketFromComps(comps.slice(0, 4), 'q', undefined, exposure)!;
    expect(m.median).toBe(27500);
  });

  test('asking below median positions below with a delta', () => {
    const m = marketFromComps(comps, 'q', 20000, exposure)!;
    expect(m.position).toBe('below');
    expect(m.delta).toBe(-5000);
  });

  test('asking within ±5% of median counts as at market', () => {
    const m = marketFromComps(comps, 'q', 26000, exposure)!;
    expect(m.position).toBe('at');
  });

  test('junk prices (deposits, parts) are excluded from the math', () => {
    const dirty = [...comps, { title: 'deposit', price: 100, url: 'https://x.test/f' }];
    const m = marketFromComps(dirty, 'q', undefined, exposure)!;
    expect(m.sampleSize).toBe(5);
    expect(m.low).toBe(15000);
  });

  test('no usable comps returns null, never a fake rail', () => {
    expect(marketFromComps([], 'q', 20000, exposure)).toBeNull();
    expect(
      marketFromComps(
        [{ title: 'deposit', price: 100, url: 'https://x.test/f' }],
        'q',
        1,
        exposure,
      ),
    ).toBeNull();
  });

  test('displayed comps are the cheapest few, sorted', () => {
    const m = marketFromComps(comps, 'q', undefined, exposure)!;
    expect(m.comps.map((c) => c.price)).toEqual([15000, 20000, 25000, 30000, 90000]);
  });
});
