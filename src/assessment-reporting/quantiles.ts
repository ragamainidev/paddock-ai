/**
 * Order statistics for outcome residuals using R-7 / PERCENTILE.INC: linear
 * interpolation between order statistics. A residual distribution is read by
 * its middle and its spread rather than by a mean, because one lot whose
 * repair ran away moves a mean and moves neither quartile (SPEC 63).
 */

export type Quantiles = { q1: number; median: number; q3: number };

/**
 * The median and the first and third quartiles, by linear interpolation
 * between the order statistics either side of each position. An empty sample
 * has no quantiles and says so with `null` rather than a zero, which would
 * read as a residual nobody observed.
 */
export function quantiles(values: readonly number[]): Quantiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share: number) => {
    const position = (sorted.length - 1) * share;
    const below = Math.floor(position);
    const above = Math.ceil(position);
    return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
  };
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) };
}
