/**
 * Descriptive outcome residuals; no retraining, causal savings or
 * profitability claims (SPEC 55). A forecast is compared only with an outcome
 * observed after it, recorded demonstrations never count, every statistic
 * carries the denominator it was read over, and below `MIN_OUTCOMES` a
 * statistic states its count instead of a number (SPEC 63). Revising a
 * constant from what these statistics say is a documented procedure with a
 * higher bar (`docs/salvage-economics.md` §14); nothing here changes one.
 */
import { quantiles, type Quantiles } from './quantiles';

export type OutcomeCase = {
  id: string;
  mode: 'fixture' | 'live';
  history: readonly {
    revision: number;
    at: string;
    ceiling: number | null;
    report?: { plan: { low: number; expected: number; high: number } };
    // Only the figures the statistics read: the buyer's own ceiling, the
    // market persona's, plus the typical exit and selling costs from the same
    // decision (SPEC 60, `src/assessments/buyer-ledger.ts`).
    buyerEconomics?: {
      maxBid: number;
      market?: { maxBid: number | null };
      exit?: { typical: number };
      lines?: { group: string; expected: number }[];
    };
  }[];
  outcomes: readonly {
    at: string;
    observedAt?: string;
    kind: string;
    decisionRevision?: number;
    amount?: number;
    hammer?: number;
    repairCost?: number;
    saleProceeds?: number;
  }[];
};

type Matched = {
  outcome: OutcomeCase['outcomes'][number];
  forecast: OutcomeCase['history'][number];
};

// -- Readings ------------------------------------------------------------------

/** Below this many matched observations a statistic states its count, not a value. */
export const MIN_OUTCOMES = 5;

/** How many of the observations fell on one side, and what share of them that is. */
export type Share = { count: number; share: number };

/**
 * One statistic: the observations it was read over, the observations it had to
 * leave out because the forecast never held the figure to compare against, and
 * either the value or the admission that the sample is too small to read.
 */
export type Reading<T> = { n: number; excluded: number } & ({ value: T } | { tooFew: true });

type Sample = { values: number[]; excluded: number };
const sample = (): Sample => ({ values: [], excluded: 0 });

function shareReading(from: Sample, hit: (value: number) => boolean): Reading<Share> {
  const n = from.values.length;
  if (n < MIN_OUTCOMES) return { n, excluded: from.excluded, tooFew: true };
  const count = from.values.filter(hit).length;
  return { n, excluded: from.excluded, value: { count, share: count / n } };
}

function spreadReading(from: Sample): Reading<Quantiles> {
  const n = from.values.length;
  const spread = n < MIN_OUTCOMES ? null : quantiles(from.values);
  return spread
    ? { n, excluded: from.excluded, value: spread }
    : { n, excluded: from.excluded, tooFew: true };
}

/**
 * One observation per assessment per statistic: the latest matched outcome
 * that states the figure and whose forecast holds the figure to read it
 * against. A lot reported twice is still one data point. An outcome that
 * states the figure against a forecast that never held its counterpart is
 * excluded from this statistic alone and counted here, never in the global
 * unmatched count, which is for an outcome no forecast answers at all.
 */
function observe(
  into: Sample,
  matched: readonly Matched[],
  states: (m: Matched) => boolean,
  against: (m: Matched) => number | undefined,
): void {
  const stated = matched.filter(states);
  if (stated.length === 0) return;
  const readable = stated.map(against).filter((value): value is number => value !== undefined);
  if (readable.length === 0) into.excluded++;
  else into.values.push(readable[readable.length - 1]);
}

// -- What each statistic reads --------------------------------------------------

// A purchase records its winning bid as `hammer`; a record saved before that
// field existed carries the same number in `amount` (SPEC 62).
const hammerOf = (outcome: OutcomeCase['outcomes'][number]) => outcome.hammer ?? outcome.amount;

const bought = (m: Matched) => m.outcome.kind === 'purchased' && hammerOf(m.outcome) !== undefined;
// The market answered the lot whether or not the owner won it (SPEC 62).
const priced = (m: Matched) =>
  (m.outcome.kind === 'purchased' || m.outcome.kind === 'lost_to_hammer') &&
  hammerOf(m.outcome) !== undefined;
const repaired = (m: Matched) => m.outcome.repairCost !== undefined;
const soldOn = (m: Matched) => m.outcome.kind === 'sold' && m.outcome.saleProceeds !== undefined;

const overCeiling = ({ outcome, forecast }: Matched) => {
  const hammer = hammerOf(outcome);
  return hammer === undefined || forecast.ceiling === null ? undefined : hammer - forecast.ceiling;
};
const overBuyerCeiling = ({ outcome, forecast }: Matched) => {
  const hammer = hammerOf(outcome);
  const ceiling = forecast.buyerEconomics?.maxBid;
  return hammer === undefined || ceiling === undefined ? undefined : hammer - ceiling;
};
const overMarketCeiling = ({ outcome, forecast }: Matched) => {
  const hammer = hammerOf(outcome);
  const ceiling = forecast.buyerEconomics?.market?.maxBid;
  return hammer === undefined || ceiling === undefined || ceiling === null
    ? undefined
    : hammer - ceiling;
};
const repairResidualOf = ({ outcome, forecast }: Matched) => {
  const plan = forecast.report?.plan;
  return outcome.repairCost === undefined || !plan ? undefined : outcome.repairCost - plan.expected;
};
// Coverage is counted as a hit per observation, so its denominator is the same
// sample the residual is read over.
const insideRange = ({ outcome, forecast }: Matched) => {
  const plan = forecast.report?.plan;
  if (outcome.repairCost === undefined || !plan) return undefined;
  return outcome.repairCost >= plan.low && outcome.repairCost <= plan.high ? 1 : 0;
};
const exitResidualOf = ({ outcome, forecast }: Matched) => {
  const typical = forecast.buyerEconomics?.exit?.typical;
  const sellingExpected = forecast.buyerEconomics?.lines?.find(
    (line) => line.group === 'selling',
  )?.expected;
  return outcome.saleProceeds === undefined ||
    typical === undefined ||
    sellingExpected === undefined
    ? undefined
    : outcome.saleProceeds - (typical - sellingExpected);
};

// -- The summary ----------------------------------------------------------------

export type OutcomeReport = ReturnType<typeof summarizeOutcomes>;

export function summarizeOutcomes(cases: readonly OutcomeCase[]) {
  let excludedFixtures = 0;
  let unmatchedOutcomes = 0;
  let matchedOutcomes = 0;
  const rows: {
    assessmentId: string;
    repairError: number | null;
    repairWithinRange: boolean | null;
    purchaseOverCeiling: number | null;
  }[] = [];
  const aboveCeiling = sample();
  const againstBuyer = sample();
  const againstMarket = sample();
  const coverage = sample();
  const repairSpread = sample();
  const exitSpread = sample();
  for (const item of cases) {
    if (item.mode === 'fixture') {
      excludedFixtures++;
      continue;
    }
    const valid = [...item.outcomes]
      .sort((a, b) => a.at.localeCompare(b.at))
      .flatMap((outcome) => {
        const forecast = item.history.find((d) => d.revision === outcome.decisionRevision);
        const observedAt = outcome.observedAt;
        if (
          !forecast ||
          !observedAt ||
          !Number.isFinite(Date.parse(observedAt)) ||
          Date.parse(forecast.at) > Date.parse(observedAt)
        ) {
          unmatchedOutcomes++;
          return [];
        }
        return [{ outcome, forecast }];
      });
    matchedOutcomes += valid.length;
    observe(aboveCeiling, valid, bought, overCeiling);
    observe(againstBuyer, valid, priced, overBuyerCeiling);
    observe(againstMarket, valid, priced, overMarketCeiling);
    observe(coverage, valid, repaired, insideRange);
    observe(repairSpread, valid, repaired, repairResidualOf);
    observe(exitSpread, valid, soldOn, exitResidualOf);
    const repair = valid.findLast(
      ({ outcome, forecast }) => outcome.repairCost !== undefined && forecast.report,
    );
    const purchase = valid.findLast(
      ({ outcome, forecast }) =>
        outcome.kind === 'purchased' &&
        hammerOf(outcome) !== undefined &&
        forecast.ceiling !== null,
    );
    if (!repair && !purchase) continue;
    rows.push({
      assessmentId: item.id,
      repairError: repair
        ? repair.outcome.repairCost! - repair.forecast.report!.plan.expected
        : null,
      repairWithinRange: repair
        ? repair.outcome.repairCost! >= repair.forecast.report!.plan.low &&
          repair.outcome.repairCost! <= repair.forecast.report!.plan.high
        : null,
      purchaseOverCeiling: purchase
        ? Math.max(0, hammerOf(purchase.outcome)! - purchase.forecast.ceiling!)
        : null,
    });
  }
  const repairs = rows.filter((r) => r.repairError !== null);
  const purchases = rows.filter((r) => r.purchaseOverCeiling !== null);
  return {
    rows,
    excludedFixtures,
    unmatchedOutcomes,
    matchedOutcomes,
    repairObservations: repairs.length,
    purchaseObservations: purchases.length,
    meanRepairError: repairs.length
      ? repairs.reduce((sum, r) => sum + r.repairError!, 0) / repairs.length
      : null,
    repairRangeCoverage: repairs.length
      ? repairs.filter((r) => r.repairWithinRange).length / repairs.length
      : null,
    purchasesAboveCeiling: purchases.filter((r) => r.purchaseOverCeiling! > 0).length,
    statistics: {
      purchasesAboveCeiling: shareReading(aboveCeiling, (value) => value > 0),
      hammerVsBuyerCeiling: spreadReading(againstBuyer),
      hammerVsMarketCeiling: spreadReading(againstMarket),
      repairRangeCoverage: shareReading(coverage, (value) => value === 1),
      repairResidual: spreadReading(repairSpread),
      exitResidual: spreadReading(exitSpread),
    },
  };
}
