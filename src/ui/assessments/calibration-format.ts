/**
 * Pure projections for the calibration view. Every cell states the sample it
 * was read over, and a sample too small to read prints its count rather than a
 * number nobody should act on (SPEC 63). Nothing here computes a statistic:
 * `src/assessment-reporting/outcomes.ts` does, and this says what it found.
 */
import type { OutcomeReport, Reading, Share } from '@/assessment-reporting/outcomes';
import { MIN_OUTCOMES } from '@/assessment-reporting/outcomes';
import type { Quantiles } from '@/assessment-reporting/quantiles';
import { moneyLabel } from './format';

export type CalibrationRow = {
  id: string;
  label: string;
  // The statistic, or the admission that too few outcomes carry it.
  value: string;
  // The denominator this value was read over, and what was left out of it.
  basis: string;
};

/** The disclosure summary, in the collapsed-evidence grammar (DESIGN.md). */
export function calibrationSummary(report: OutcomeReport): string {
  const matched = `${report.matchedOutcomes} matched outcome${report.matchedOutcomes === 1 ? '' : 's'}`;
  const fixtures = report.excludedFixtures
    ? [`${report.excludedFixtures} fixture${report.excludedFixtures === 1 ? '' : 's'} excluded`]
    : [];
  return [`calibration — ${matched}`, ...fixtures].join(' · ');
}

/**
 * What this comparison never counts, with its counts: a recorded
 * demonstration is invented or replayed evidence, and an outcome no earlier
 * forecast answers is not a forecast that was tested.
 */
export function calibrationExclusions(report: OutcomeReport): string {
  return `Recorded demonstrations (${report.excludedFixtures}) and outcomes with no earlier forecast (${report.unmatchedOutcomes}) are excluded.`;
}

/** One row per statistic, in the order a reader asks the questions. */
export function calibrationRows(report: OutcomeReport): CalibrationRow[] {
  const s = report.statistics;
  return [
    row({
      id: 'purchases-above-ceiling',
      label: 'purchases above the decision ceiling',
      reading: s.purchasesAboveCeiling,
      state: shareValue,
      unit: ['lot purchased', 'lots purchased'],
      missing: 'the decision solved no ceiling',
    }),
    row({
      id: 'hammer-vs-your-ceiling',
      label: 'hammer minus your ledger ceiling',
      reading: s.hammerVsBuyerCeiling,
      state: spreadValue,
      unit: ['lot the market priced', 'lots the market priced'],
      missing: 'the decision solved no ceiling of your own',
    }),
    row({
      id: 'hammer-vs-market-ceiling',
      label: 'hammer minus what a pro can pay',
      reading: s.hammerVsMarketCeiling,
      state: spreadValue,
      unit: ['lot the market priced', 'lots the market priced'],
      missing: 'the decision solved no market ceiling',
    }),
    row({
      id: 'repair-range-coverage',
      label: 'repairs inside the estimated range',
      reading: s.repairRangeCoverage,
      state: shareValue,
      unit: ['lot with a recorded repair', 'lots with a recorded repair'],
      missing: 'the decision carried no repair plan',
    }),
    row({
      id: 'repair-residual',
      label: 'repair actual minus expected',
      reading: s.repairResidual,
      state: spreadValue,
      unit: ['lot with a recorded repair', 'lots with a recorded repair'],
      missing: 'the decision carried no repair plan',
    }),
    row({
      id: 'exit-residual',
      label: 'net proceeds minus the typical exit net of selling costs',
      reading: s.exitResidual,
      state: spreadValue,
      unit: ['lot sold', 'lots sold'],
      missing: 'the decision carried no exit band or selling cost line',
    }),
  ];
}

// -- Cells ----------------------------------------------------------------------

/** A sample this small states how far it is from readable, and no number. */
export const tooFew = (n: number) => `too few outcomes to read (${n} of ${MIN_OUTCOMES})`;

const shareValue = (value: Share, n: number) =>
  `${value.count} of ${n} · ${Math.round(value.share * 100)}%`;

const spreadValue = (value: Quantiles) =>
  `${moneyLabel(value.median)} median · ${moneyLabel(value.q1)} to ${moneyLabel(value.q3)} interquartile`;

function row<T>(cell: {
  id: string;
  label: string;
  reading: Reading<T>;
  state: (value: T, n: number) => string;
  unit: [string, string];
  missing: string;
}): CalibrationRow {
  const { n, excluded } = cell.reading;
  const left = excluded ? [`${excluded} excluded: ${cell.missing}`] : [];
  return {
    id: cell.id,
    label: cell.label,
    value: 'value' in cell.reading ? cell.state(cell.reading.value, n) : tooFew(n),
    basis: [`over ${n} ${cell.unit[n === 1 ? 0 : 1]}`, ...left].join(' · '),
  };
}
