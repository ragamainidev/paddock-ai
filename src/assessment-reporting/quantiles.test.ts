import { describe, expect, it } from 'vitest';
import { quantiles } from './quantiles';

describe('order statistics over a residual sample', () => {
  it('reads the middle and both quartiles off an odd sample', () => {
    expect(quantiles([5, 1, 3, 2, 4])).toEqual({ q1: 2, median: 3, q3: 4 });
  });
  it('interpolates between the order statistics either side of a quartile', () => {
    expect(quantiles([1, 2, 3, 4])).toEqual({ q1: 1.75, median: 2.5, q3: 3.25 });
  });
  it('keeps a negative residual negative and reports no quantiles for an empty sample', () => {
    expect(quantiles([-3000, -2000, -1000])).toEqual({
      q1: -2500,
      median: -2000,
      q3: -1500,
    });
    expect(quantiles([])).toBeNull();
  });
});
