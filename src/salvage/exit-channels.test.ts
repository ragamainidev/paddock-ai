import { describe, expect, test } from 'vitest';
import { EXIT_CHANNELS } from './exit-channels';
import type { ExitChannel } from './types';

const CHANNELS: ExitChannel[] = ['private_party', 'wholesale', 'retail', 'keep'];

describe('exit channels (docs/salvage-economics.md §12)', () => {
  test('every channel a buyer profile can name has a band', () => {
    expect(Object.keys(EXIT_CHANNELS).sort()).toEqual([...CHANNELS].sort());
  });

  test('each band is ordered, non-negative, and says where its numbers came from', () => {
    for (const channel of CHANNELS) {
      const c = EXIT_CHANNELS[channel];
      expect(c.sellingPct.low, channel).toBeGreaterThanOrEqual(0);
      expect(c.sellingPct.expected, channel).toBeGreaterThanOrEqual(c.sellingPct.low);
      expect(c.sellingPct.high, channel).toBeGreaterThanOrEqual(c.sellingPct.expected);
      expect(c.exitFactor.low, channel).toBeGreaterThan(0);
      expect(c.exitFactor.high, channel).toBeGreaterThanOrEqual(c.exitFactor.low);
      expect(c.basis.trim().length, channel).toBeGreaterThan(0);
    }
  });

  test('keep charges nothing to sell, because nothing is sold', () => {
    expect(EXIT_CHANNELS.keep.sellingPct).toEqual({ low: 0, expected: 0, high: 0 });
    expect(EXIT_CHANNELS.keep.exitFactor).toEqual({ low: 1, high: 1 });
    expect(EXIT_CHANNELS.keep.basis).toContain('no sale');
  });

  test('the private-party channel is the exit lanes as estimated, and its band is informational', () => {
    expect(EXIT_CHANNELS.private_party.exitFactor).toEqual({ low: 1, high: 1 });
    // The tier's own selling band prices this channel, so nothing solves
    // against these percentages and the basis says so.
    expect(EXIT_CHANNELS.private_party.basis).toContain('informational');
    expect(EXIT_CHANNELS.private_party.basis).toContain('the tier band');
  });

  test('wholesale transacts under private party; retail costs the most to sell', () => {
    expect(EXIT_CHANNELS.wholesale.exitFactor.high).toBeLessThan(1);
    expect(EXIT_CHANNELS.wholesale.exitFactor.low).toBe(0.8);
    expect(EXIT_CHANNELS.retail.exitFactor.high).toBeGreaterThan(1);
    expect(EXIT_CHANNELS.retail.sellingPct.expected).toBeGreaterThan(
      EXIT_CHANNELS.wholesale.sellingPct.expected,
    );
  });

  test('every sourced channel cites a URL or names itself an assumption', () => {
    for (const channel of ['private_party', 'wholesale', 'retail'] as ExitChannel[]) {
      const basis = EXIT_CHANNELS[channel].basis;
      expect(basis, channel).toMatch(/https:\/\/|docs\/salvage-economics\.md|assumption/);
    }
  });
});
