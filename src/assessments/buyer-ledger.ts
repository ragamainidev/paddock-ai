/**
 * The bidder-relative ledger. The kernel prices the lot vehicle-relatively;
 * this module prices the same lot for one buyer, over the kernel's plan and
 * cost lines: the equipment the buyer does not own converts DIY work to
 * professional work at the tier's shop rate, the fee mode selects what the
 * auction and a broker charge them, the exit channel selects where the car
 * transacts and what selling it costs, the stated jurisdiction replaces the
 * national title band, and the buyer's own labor and holding costs join the
 * ledger as lines. Every line this layer adds or changes states its basis and
 * reads `derived`; a line it does not touch keeps the kernel's own basis and
 * evidence chip (SPEC 59).
 *
 * The kernel's lines are never edited: `CeilingInputs` is read and new lines
 * are returned, so `report.ledger` keeps the kernel's own number. The buyer's
 * economic target is the lesser of their own discipline, the low exit minus
 * their required surplus, and the kernel's disciplined target, so a looser
 * discipline can never lift the ceiling above the kernel's (SPEC 58). A buyer
 * who genuinely pays less — a licensed account with no broker cut, a car that
 * is never sold — clears a higher bid than the market persona, and the ledger
 * says which lines did it.
 *
 * The ceiling belongs to (lot, bidder), so one lot has two of them: the
 * bidder's, and the market persona's on the same plan, the same exit evidence,
 * the same jurisdiction and the same solver (`MARKET_PERSONA`,
 * docs/salvage-economics.md §8). Their difference is the edge, and a negative
 * edge means the bidder would have to pay above their own ceiling to win the
 * lot (SPEC 60).
 *
 * Constants and bands are sourced in docs/salvage-economics.md §8, §11–13.
 */

import { usd } from '@/lib/money';
import { type CeilingInputs, DISCIPLINE_SHARE, fixedLines, solveMaxBid } from '@/salvage/ceiling';
import { EXIT_CHANNELS } from '@/salvage/exit-channels';
import { bidDependentFees, bidFeeLines, fixedFeeLines } from '@/salvage/fees';
import { proPrice } from '@/salvage/knowledge';
import { titleProcessFor } from '@/salvage/title-process';
import type {
  BuyerAccess,
  CostLine,
  Equipment,
  ExitChannel,
  ExitEstimate,
  RepairLine,
  RepairPlan,
  SalvageLedger,
} from '@/salvage/types';
import { MARKET_PERSONA } from './buyer-profile';
import type { AssessmentDecision, BuyerCeilingBound, BuyerProfile } from './types';

export type BuyerEconomics = NonNullable<AssessmentDecision['buyerEconomics']>;
// One bidder's side of the ledger: everything but the comparison between two
// bidders, which needs two of these.
type OneBidder = Omit<BuyerEconomics, 'market' | 'edge'>;

// Who the market ceiling belongs to, stated wherever that number is shown.
const MARKET_BASIS =
  "the professional rebuilder who sets the room's price: shop equipment, direct account, retail exit; docs/salvage-economics.md §8";

// -- Bases ------------------------------------------------------------------------

const ACCESS_BASIS: Record<BuyerAccess, string> = {
  broker: 'your access: a non-dealer bids through a broker, so the broker charges apply',
  direct: 'your access: a direct licensed account, so no broker charges apply',
};

const CHANNEL_LABEL: Record<ExitChannel, string> = {
  private_party: 'a private sale',
  wholesale: 'a dealer auction',
  retail: 'retail from a lot',
  keep: 'no sale',
};

const EXIT_BASIS: Record<ExitChannel, string> = {
  private_party:
    'your exit: a private sale, the money the exit lanes already estimate, so the band is unchanged',
  wholesale:
    'your exit: a dealer auction, where wholesale money sits at 0.80–0.90 of private-party money',
  retail:
    'your exit: retail from a lot, where a reconditioned car asks 1.00–1.05 of private-party money',
  keep: 'no sale planned; value retained at private-party typical',
};

// -- Capability gates ---------------------------------------------------------------

// A DIY line the buyer has no rack, booth, jig or high-voltage tooling for is
// work they buy: it prices at `pro` and its hours leave the labor line. A
// professional line is never handed back to the buyer, so the kernel's own
// split (carbon and aluminum structure, SPEC 35) survives every profile.
function gatePlan(plan: RepairPlan, buyer: BuyerProfile): RepairPlan {
  let gated = false;
  const lines = plan.lines.map((line) => {
    if (line.who !== 'diy') return line;
    const missing = line.requires.filter((e: Equipment) => !buyer.capabilities[e]);
    if (!missing.length) return line;
    gated = true;
    const converted: RepairLine = {
      ...line,
      who: 'pro',
      low: line.pro.low,
      expected: line.pro.expected,
      high: line.pro.high,
      evidence: 'derived',
      basis: `${line.basis}; converted to professional: buyer lacks ${missing.join(' and ')}; the same task bought at the ${plan.tier} shop rate (docs/salvage-economics.md §4.1)`,
    };
    delete converted.diyHours;
    return { ...converted, pro: proPrice(converted, plan.tier) };
  });
  if (!gated) return plan;
  const byId = new Map(lines.map((l) => [l.id, l] as const));
  return {
    ...plan,
    lines,
    programs: plan.programs.map((p) => ({
      ...p,
      lines: p.lines.map((l) => byId.get(l.id) ?? l),
    })),
    low: lines.reduce((s, l) => s + l.low, 0),
    expected: lines.reduce((s, l) => s + l.expected, 0),
    high: lines.reduce((s, l) => s + l.high, 0),
    diyHoursTotal: lines.filter((l) => l.who === 'diy').reduce((s, l) => s + (l.diyHours ?? 0), 0),
  };
}

// -- The ledger ---------------------------------------------------------------------

/**
 * Both ceilings for one lot: this buyer's, and the market persona's over the
 * same plan, exit and ledger. They are solved together, so a decision that
 * carries one carries the other (SPEC 60).
 */
export function buyerLedger(args: {
  inputs: CeilingInputs;
  exit: ExitEstimate;
  ledger: SalvageLedger;
  buyer: BuyerProfile;
}): BuyerEconomics {
  const own = ledgerFor(args);
  // The rebuilt title is issued where the car is registered, and both bidders
  // register it in the same place, so the persona is priced through the
  // buyer's own title process: a state's fees move both ceilings together and
  // never create or destroy an edge. The exported constant keeps
  // `US-unspecified`, because the persona describes resources and an exit
  // rather than a residence.
  const market = ledgerFor({
    ...args,
    buyer: { ...MARKET_PERSONA, jurisdiction: args.buyer.jurisdiction },
  });
  return {
    ...own,
    market: { maxBid: market.maxBid, basis: MARKET_BASIS, lines: market.lines },
    // What this bidder can pay beyond the room's price setter. Negative is the
    // winner's curse: the lot can only be won above this buyer's own ceiling.
    edge: own.maxBid - market.maxBid,
  };
}

function ledgerFor(args: {
  inputs: CeilingInputs;
  exit: ExitEstimate;
  ledger: SalvageLedger;
  buyer: BuyerProfile;
}): OneBidder {
  const { inputs, exit, ledger, buyer } = args;
  const plan = gatePlan(inputs.plan, buyer);
  const channel = EXIT_CHANNELS[buyer.exit];
  const title = titleProcessFor(buyer.jurisdiction, inputs.profile.titleProcess);

  // Where this channel transacts against the private-party money the exit
  // lanes estimate; the typical is the midpoint of the buyer's own band.
  const low = Math.round(exit.low * channel.exitFactor.low);
  const high = Math.round(exit.high * channel.exitFactor.high);
  const band = {
    low,
    typical: Math.round((low + high) / 2),
    high,
    basis: `${EXIT_BASIS[buyer.exit]} (docs/salvage-economics.md §12)`,
  };

  const sellingLines = (line: CostLine, exitLow: number): CostLine[] => {
    // Nothing is sold, so nothing is paid to sell it; the line stays at zero
    // so `lines` remains the whole of the buyer's ledger.
    if (buyer.exit === 'keep')
      return [
        {
          ...line,
          label: 'selling costs (no sale planned)',
          low: 0,
          expected: 0,
          high: 0,
          basis: `${EXIT_BASIS.keep} (docs/salvage-economics.md §12)`,
          evidence: 'derived',
        },
      ];
    // The tier's own band prices the private-party channel for this car, and
    // is model-specific where the channel table is national.
    if (buyer.exit === 'private_party')
      return [
        {
          ...line,
          basis: `${line.basis}; ${EXIT_BASIS.private_party}`,
          evidence: 'derived',
        },
      ];
    const s = channel.sellingPct;
    return [
      {
        id: 'selling',
        label: `selling costs (${Math.round(s.expected * 100)}% via ${CHANNEL_LABEL[buyer.exit]})`,
        group: 'selling',
        low: Math.round(s.low * exitLow),
        expected: Math.round(s.expected * exitLow),
        high: Math.round(s.high * exitLow),
        basis: `${Math.round(s.low * 100)}–${Math.round(s.high * 100)}% of the low exit (${usd(exitLow)}); ${EXIT_BASIS[buyer.exit]}; ${channel.basis}`,
        evidence: 'derived',
      },
    ];
  };

  // The bid-independent lines at one exit, as this buyer pays them.
  const linesAt = (exitLow: number): CostLine[] =>
    fixedLines({ ...inputs, plan }, exitLow).flatMap((line) => {
      if (line.id === 'fees.fixed')
        return fixedFeeLines({ access: buyer.access }).map((fees) => ({
          ...fees,
          basis: `${fees.basis}; ${ACCESS_BASIS[buyer.access]}`,
          evidence: 'derived' as const,
        }));
      // An untabulated jurisdiction keeps the kernel's national band exactly
      // as the kernel states it, reason included.
      if (line.id === 'title' && title.tabulated)
        return [
          {
            ...line,
            low: title.low,
            expected: Math.round((title.low + title.high) / 2),
            high: title.high,
            basis: title.basis,
            evidence: 'derived' as const,
          },
        ];
      if (line.group === 'selling') return sellingLines(line, exitLow);
      return [line];
    });

  const expected = (l: CostLine) => l.expected;
  const stressed = (l: CostLine) =>
    ['repair', 'contingency'].includes(l.group) ? l.high : l.expected;
  const optimistic = (l: CostLine) =>
    l.group === 'repair' ? l.low : l.group === 'contingency' ? 0 : l.expected;
  const total = (lines: CostLine[], scale: (l: CostLine) => number) =>
    lines.reduce((s, l) => s + scale(l), 0);
  // Cash at acquisition excludes selling costs, which are paid from proceeds; labor is not cash.
  const cashLines = (lines: CostLine[]) => lines.filter((l) => l.group !== 'selling');

  const costLines = linesAt(band.low);
  const fixed = total(costLines, expected);
  const labor = plan.diyHoursTotal * buyer.laborRatePerHour;
  const holding = buyer.holdingDays * buyer.holdingCostPerDay;
  const fees = (bid: number) => bidDependentFees(bid, { access: buyer.access });
  // SPEC 58: the target never exceeds the kernel's own, so a discipline above
  // the market persona's cannot lift the ceiling above the kernel's.
  const kernelTarget = band.low * DISCIPLINE_SHARE;
  const surplusTarget = band.low - buyer.minSurplus;
  const disciplineTarget = band.low * buyer.discipline;
  const target = Math.min(disciplineTarget, surplusTarget, kernelTarget);
  // Which of the three arms set the target. The kernel's clamp is only named
  // when it is strictly tighter than the buyer's own share, because an equal
  // one is the buyer's discipline holding rather than a cap taking effect.
  const targetArm: BuyerCeilingBound =
    surplusTarget <= Math.min(disciplineTarget, kernelTarget)
      ? 'surplus'
      : kernelTarget < disciplineTarget
        ? 'kernel'
        : 'discipline';
  // The economic solve against the target and the cash solve against the
  // stated limit, kept apart so the smaller one can be named. Cash excludes
  // selling costs and labor; the economic arm carries both.
  const arms = (lines: CostLine[], scale: (l: CostLine) => number, at: number) => ({
    target: solveMaxBid(at, total(lines, scale) + labor + holding, fees),
    cash: solveMaxBid(buyer.maxAllIn, total(cashLines(lines), scale) + holding, fees),
  });
  const bidFor = (lines: CostLine[], scale: (l: CostLine) => number, at = target) => {
    const solved = arms(lines, scale, at);
    return Math.min(solved.target, solved.cash);
  };
  const solved = arms(costLines, expected, target);
  const maxBid = Math.min(solved.target, solved.cash);
  // A cash limit that returns the smaller bid is what stopped this bidder, and
  // the decision's sentence names it rather than the margin it left intact.
  const bound: BuyerCeilingBound = solved.cash < solved.target ? 'cash' : targetArm;
  // The optimistic bound sells at the high exit, so its selling costs are
  // re-derived there rather than left at the low-exit line (SPEC 39).
  const bestCaseLines = linesAt(band.high);
  const cashFixed = total(cashLines(costLines), expected);

  // The share of the low exit the target actually holds, whichever of the
  // three constraints set it: the sentence that quotes it names the binding
  // number rather than the stated discipline. A required surplus above the low
  // exit drives the target below zero, and no share is retained at all.
  const share =
    band.low > 0 ? Math.max(0, target / band.low) : Math.min(buyer.discipline, DISCIPLINE_SHARE);
  const disciplineBasis = [
    `your discipline: all-in stays at ${Math.round(buyer.discipline * 100)}% of the low exit`,
    ...(buyer.discipline > DISCIPLINE_SHARE
      ? [
          `capped at the market persona's ${Math.round(DISCIPLINE_SHARE * 100)}%, which no buyer input may exceed (SPEC 58)`,
        ]
      : []),
    ...(surplusTarget < Math.min(band.low * buyer.discipline, kernelTarget)
      ? [`your ${usd(buyer.minSurplus)} required surplus binds first`]
      : []),
  ].join('; ');

  const laborLine: CostLine = {
    id: 'labor',
    label: `your time (${plan.diyHoursTotal} h at ${usd(buyer.laborRatePerHour)}/h)`,
    group: 'labor',
    low: labor,
    expected: labor,
    high: labor,
    basis: `your stated opportunity cost for ${plan.diyHoursTotal} DIY hours; time rather than money, so it is outside the cash limit and inside the economic one (docs/salvage-economics.md §11)`,
    evidence: 'derived',
  };
  const holdingLine: CostLine = {
    id: 'holding',
    label: `holding (${buyer.holdingDays} d at ${usd(buyer.holdingCostPerDay)}/d)`,
    group: 'holding',
    low: holding,
    expected: holding,
    high: holding,
    basis:
      'your stated holding cost while the car is yours: insurance, storage and capital (docs/salvage-economics.md §11)',
    evidence: 'derived',
  };

  return {
    laborOpportunityCost: Math.round(labor),
    holdingCost: Math.round(holding),
    fixedCost: Math.round(fixed),
    maxBid,
    // The kernel's own vehicle-relative ceiling for this lot, beside which the
    // vehicle baseline is read; null when the kernel solved nothing (SPEC 59).
    kernelMaxBid: ledger.ceiling,
    maxAllIn: buyer.maxAllIn,
    minSurplus: buyer.minSurplus,
    stressMaxBid: bidFor(costLines, stressed),
    bestCaseMaxBid: bidFor(
      bestCaseLines,
      optimistic,
      Math.min(
        band.high * buyer.discipline,
        band.high - buyer.minSurplus,
        band.high * DISCIPLINE_SHARE,
      ),
    ),
    cashAtCeiling: Math.round(maxBid + fees(maxBid) + cashFixed + holding),
    totalEconomicCostAtCeiling: Math.round(maxBid + fees(maxBid) + fixed + holding + labor),
    exit: band,
    discipline: { share, basis: disciplineBasis, bound },
    // Every dollar the buyer's arithmetic used, each with its basis: the bid
    // plus these lines is the all-in at the ceiling.
    lines: [
      ...costLines,
      laborLine,
      holdingLine,
      ...bidFeeLines(maxBid, { access: buyer.access }).map((l) => ({
        ...l,
        basis: `${l.basis}; ${ACCESS_BASIS[buyer.access]}`,
        evidence: 'derived' as const,
      })),
    ],
  };
}
