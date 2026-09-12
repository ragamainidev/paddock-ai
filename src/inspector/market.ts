import type { DetectedIssue, DetectedModification, MarketComp, MarketPosition } from './types';

// Market position from real comparable sales. The math is deliberately
// simple and stated: low/median/high of comps, the subject car's price
// against the median, and a repair-exposure range derived from what the
// photos actually showed. Exposure bands are estimates and labeled as such
// in the UI; they exist to size the negotiation, not to price the repair.

const AT_BAND = 0.05; // ±5% of median counts as "at market"
const MIN_COMP_PRICE = 500; // below this it's a deposit or a parts listing
const MAX_COMPS_SHOWN = 5;

// Ranges in whole dollars: [low, high] typical US shop pricing.
const ISSUE_EXPOSURE: Record<DetectedIssue['severity'], [number, number]> = {
  critical: [2500, 8000],
  high: [1200, 4000],
  medium: [300, 1200],
  low: [0, 250],
};

// Cheap or unknown-quality modifications cost money to inspect, retune, or
// return to stock — that is real exposure for a buyer.
const MOD_EXPOSURE: [number, number] = [500, 2000];

export function repairExposure(
  issues: DetectedIssue[],
  modifications: DetectedModification[],
): MarketPosition['repairExposure'] {
  let low = 0;
  let high = 0;
  const drivers: string[] = [];
  for (const issue of issues) {
    const [l, h] = ISSUE_EXPOSURE[issue.severity];
    low += l;
    high += h;
    if (issue.severity !== 'low') {
      drivers.push(`${issue.severity} ${issue.type.replace(/_/g, ' ')}`);
    }
  }
  for (const mod of modifications) {
    if (mod.quality !== 'budget_aftermarket' && mod.quality !== 'unknown') continue;
    low += MOD_EXPOSURE[0];
    high += MOD_EXPOSURE[1];
    drivers.push(`${mod.quality.replace(/_/g, ' ')} ${mod.type.replace(/_/g, ' ')}`);
  }
  return { low, high, drivers };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Pure: comps → market position. Returns null when no usable comps exist;
// the stage degrades visibly instead of guessing.
export function marketFromComps(
  rawComps: MarketComp[],
  query: string,
  asking: number | undefined,
  exposure: MarketPosition['repairExposure'],
): MarketPosition | null {
  const comps = rawComps.filter((c) => c.price >= MIN_COMP_PRICE);
  if (comps.length === 0) return null;

  const prices = comps.map((c) => c.price).sort((a, b) => a - b);
  const med = median(prices);

  let position: MarketPosition['position'];
  let delta: number | undefined;
  if (asking !== undefined) {
    delta = asking - med;
    position = Math.abs(delta) <= med * AT_BAND ? 'at' : delta < 0 ? 'below' : 'above';
  }

  return {
    sampleSize: comps.length,
    low: prices[0],
    median: med,
    high: prices[prices.length - 1],
    asking,
    position,
    delta,
    repairExposure: exposure,
    query,
    comps: [...comps].sort((a, b) => a.price - b.price).slice(0, MAX_COMPS_SHOWN),
  };
}
