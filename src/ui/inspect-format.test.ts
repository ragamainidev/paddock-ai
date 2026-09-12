import { describe, expect, test } from 'vitest';
import { dollars, hostOf, inspectStageNote, positionLabel, railPercent } from './inspect-format';
import type { MarketPosition } from '@/inspector/types';

const MARKET: MarketPosition = {
  sampleSize: 9,
  low: 13750,
  median: 26500,
  high: 96000,
  asking: 30000,
  position: 'above',
  delta: 3500,
  repairExposure: { low: 0, high: 0, drivers: [] },
  query: 'q',
  comps: [],
};

describe('inspect formatting', () => {
  test('dollars are rounded, comma-grouped, dollar-signed', () => {
    expect(dollars(26046)).toBe('$26,046');
    expect(dollars(1499.6)).toBe('$1,500');
  });

  test('hostOf strips www and paths; garbage passes through', () => {
    expect(hostOf('https://www.m3forum.net/threads/rust.123/')).toBe('m3forum.net');
    expect(hostOf('not a url')).toBe('not a url');
  });

  test('stage notes name the stage and the reason', () => {
    expect(inspectStageNote({ stage: 'web', ok: false, detail: 'no key' })).toBe(
      'web research unavailable: no key',
    );
    expect(inspectStageNote({ stage: 'nhtsa', ok: false })).toBe('NHTSA unavailable');
  });

  test('rail percent clamps and survives a degenerate range', () => {
    expect(railPercent(13750, MARKET)).toBe(0);
    expect(railPercent(96000, MARKET)).toBe(100);
    expect(railPercent(200000, MARKET)).toBe(100);
    expect(railPercent(1, MARKET)).toBe(0);
    expect(railPercent(20000, { low: 20000, high: 20000 })).toBe(50);
  });

  test('position labels read like a negotiator wrote them', () => {
    expect(positionLabel(MARKET)).toBe('$3,500 above median');
    expect(positionLabel({ ...MARKET, position: 'at', delta: 400 })).toBe('at market');
    expect(
      positionLabel({ ...MARKET, asking: undefined, delta: undefined, position: undefined }),
    ).toBe('');
  });
});
