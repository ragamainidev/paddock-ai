/**
 * The bid ceiling: the highest bid at which a disciplined rebuilder's
 * all-in (bid + fees + transport + repairs + hidden-damage contingency +
 * title process + selling costs) stays at or under 75% of the low exit
 * (SPEC 39). Break-even is the same solve at 100%; stress reprices every
 * repair line at its high. A zero ceiling names the lines that ate it and
 * what would have to be true for it to turn positive; the sensitivity rows
 * re-solve the same equation under the assumptions a yard visit could
 * settle. Everything here is pure; constants are sourced in
 * docs/salvage-economics.md.
 */

import { usd } from '@/lib/money';
import {
  bidDependentFees,
  bidFeeLines,
  BROKER_FLAT,
  FEES_SCHEDULE_DATE,
  fixedFeeLines,
} from './fees';
import type {
  CostLine,
  DamageTriage,
  ExitEstimate,
  LadderStep,
  RepairPlan,
  SalvageLedger,
  SalvageLot,
  SensitivityRow,
  Unlock,
  WreckMarket,
} from './types';

export type CeilingProfile = {
  selling: { low: number; expected: number; high: number; channel: string; basis: string };
  titleProcess: { low: number; high: number; basis: string };
  transport: { low: number; expected: number; high: number; basis: string };
  contingencyFloor: number; // dollars: module resets, calibration, alignment, fluids
  hybrid: boolean;
};

export type CeilingInputs = {
  lot: SalvageLot;
  triage: DamageTriage;
  plan: RepairPlan;
  exit: ExitEstimate | null;
  wreck: WreckMarket | null;
  profile: CeilingProfile;
};

// All-in at or under 75% of the low exit: the practitioner 50–70%-of-ARV
// discipline applied to the band's floor instead of its middle
// (docs/salvage-economics.md §2).
export const DISCIPLINE_SHARE = 0.75;
const DISCIPLINE_BASIS =
  'all-in at or under 75% of the low exit; the margin absorbs hidden damage, module work, capital, and time (docs/salvage-economics.md)';
const BID_STEP = 500;

// "Front end structure: heavy (front clip, …)" → "Front end structure": the
// name a summary sentence or a ladder row can carry.
export function shortLabel(label: string): string {
  return label
    .split(':')[0]
    .replace(/\s*\(.*\)\s*$/, '')
    .trim();
}

// -- Solver -----------------------------------------------------------------------

// Highest bid, in $500 steps, whose bid + bid-dependent fees + fixed costs
// stays at or under the target. Fees scale with the bid, so this is a
// search; `fees` defaults to the full broker-inclusive schedule.
export function solveMaxBid(
  target: number,
  fixed: number,
  fees: (bid: number) => number = bidDependentFees,
): number {
  const headroom = target - fixed;
  if (headroom <= 0) return 0;
  let lo = 0;
  let hi = headroom; // fees are non-negative, so the bid cannot exceed the headroom
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (mid + fees(mid) <= headroom) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.floor(lo / BID_STEP) * BID_STEP);
}

// -- Contingency ------------------------------------------------------------------

// A Copart bid is priced from photographs, and photo-based estimates run
// 50–60% in supplements over the first appraisal against 30–35% for an
// in-person one (Mitchell); rebuilders' own rules of thumb sit at 20–50%.
// The plan's expected values already sit above their lows, so the base
// here is 15%, rising with the things photos hide worst
// (docs/salvage-economics.md §6).
export const CONTINGENCY_BASE = 0.15;
export const CONTINGENCY_CAP = 0.4;

export function contingencyRate(
  triage: DamageTriage,
  lot: SalvageLot,
  hvInvolved: boolean,
): { rate: number; reasons: string[] } {
  let rate = CONTINGENCY_BASE;
  const reasons = [`${Math.round(CONTINGENCY_BASE * 100)}% base for what auction photos hide`];
  if (triage.areas.some((a) => a.kind === 'structural' && a.severity === 'heavy')) {
    rate += 0.1;
    reasons.push('+10% heavy structural damage');
  }
  if (hvInvolved) {
    rate += 0.05;
    reasons.push('+5% high-voltage system involved');
  }
  if (triage.confidence < 0.6) {
    rate += 0.05;
    reasons.push('+5% low photo-triage confidence');
  }
  if (lot.odometer === undefined) {
    rate += 0.05;
    reasons.push('+5% odometer unknown');
  }
  return { rate: Math.min(CONTINGENCY_CAP, Math.round(rate * 100) / 100), reasons };
}

// -- Cost lines ------------------------------------------------------------------

type Scenario = {
  exitLow: number | null; // what selling and the target are computed from
  repairScale: 'low' | 'expected' | 'high' | ((line: CostLine) => number);
  contingency: 'expected' | 'high' | 'waived';
};

function repairLines(plan: RepairPlan): CostLine[] {
  return plan.lines.map((l) => ({
    id: l.id,
    label: l.task,
    group: 'repair',
    low: l.low,
    expected: l.expected,
    high: l.high,
    basis: `${l.basis}${l.who === 'diy' ? `; your labor${l.diyHours ? ` (≈${l.diyHours}h)` : ''} at $0` : ''}`,
    evidence: l.evidence,
    program: l.program,
  }));
}

function contingencyLine(
  plan: RepairPlan,
  triage: DamageTriage,
  lot: SalvageLot,
  profile: CeilingProfile,
): CostLine {
  const hv =
    profile.hybrid && plan.lines.some((l) => /hv|hybrid|high-voltage/i.test(l.id + l.task));
  const { rate, reasons } = contingencyRate(triage, lot, hv);
  const floor = profile.contingencyFloor;
  return {
    id: 'contingency',
    label: `hidden-damage contingency (${Math.round(rate * 100)}% of repairs)`,
    group: 'contingency',
    low: Math.max(floor, Math.round(Math.max(0, rate - 0.05) * plan.low)),
    expected: Math.max(floor, Math.round(rate * plan.expected)),
    high: Math.max(floor, Math.round((rate + 0.1) * plan.high)),
    basis: `${reasons.join(', ')}; floor ${usd(floor)} for module resets, fasteners, fluids, and the odd broken clip; photo-based estimates run 50–60% in supplements in industry data (docs/salvage-economics.md §6)`,
    evidence: 'derived',
  };
}

function sellingLine(exitLow: number, profile: CeilingProfile): CostLine {
  const s = profile.selling;
  return {
    id: 'selling',
    label: `selling costs (${Math.round(s.expected * 100)}% via ${s.channel})`,
    group: 'selling',
    low: Math.round(s.low * exitLow),
    expected: Math.round(s.expected * exitLow),
    high: Math.round(s.high * exitLow),
    basis: `${Math.round(s.low * 100)}–${Math.round(s.high * 100)}% of the low exit (${usd(exitLow)}); ${s.basis}`,
    evidence: 'derived',
  };
}

// The bid-independent cost lines at one exit. Only selling costs scale with
// the exit, so re-deriving at another exit reprices that line and nothing
// else; a scenario that sells at a different exit solves against these lines.
export function fixedLines(inputs: CeilingInputs, exitLow: number | null): CostLine[] {
  const { plan, triage, lot, profile } = inputs;
  const t = profile.transport;
  return [
    ...fixedFeeLines(),
    {
      id: 'transport',
      label: 'transport to your garage',
      group: 'transport',
      low: t.low,
      expected: t.expected,
      high: t.high,
      basis: t.basis,
      evidence: 'curated',
    },
    ...repairLines(plan),
    contingencyLine(plan, triage, lot, profile),
    {
      id: 'title',
      label: 'rebuilt title inspection + registration',
      group: 'title',
      low: profile.titleProcess.low,
      expected: Math.round((profile.titleProcess.low + profile.titleProcess.high) / 2),
      high: profile.titleProcess.high,
      basis: profile.titleProcess.basis,
      evidence: 'curated',
    },
    ...(exitLow !== null ? [sellingLine(exitLow, profile)] : []),
  ];
}

// The fixed side of the all-in for one scenario: repairs at the chosen
// scale, contingency expected/high/waived, everything else at expected.
function fixedTotal(lines: CostLine[], scenario: Scenario): number {
  return lines.reduce((sum, l) => {
    if (l.group === 'repair') {
      const s = scenario.repairScale;
      return sum + (typeof s === 'function' ? s(l) : l[s]);
    }
    if (l.group === 'contingency') {
      return (
        sum +
        (scenario.contingency === 'waived'
          ? 0
          : scenario.contingency === 'high'
            ? l.high
            : l.expected)
      );
    }
    return sum + l.expected;
  }, 0);
}

// -- Ladder, killers, unlocks ---------------------------------------------------------

function ladderFor(
  exitLow: number,
  lines: CostLine[],
  plan: RepairPlan,
  ceiling: number,
  killerIds: Set<string>,
): LadderStep[] {
  const steps: LadderStep[] = [
    { id: 'exit', label: 'rebuilt exit, low', amount: exitLow, kind: 'exit' },
    {
      id: 'margin',
      label: `discipline margin (${Math.round((1 - DISCIPLINE_SHARE) * 100)}%)`,
      amount: Math.round(exitLow * (1 - DISCIPLINE_SHARE)),
      kind: 'margin',
    },
  ];
  const step = (l: CostLine, amount = l.expected): LadderStep => ({
    id: l.id,
    label: l.label,
    amount,
    kind: 'cost',
    group: l.group,
    killer: killerIds.has(l.id) || undefined,
  });
  for (const l of lines.filter((l) => l.group === 'selling' || l.group === 'title')) {
    steps.push({
      ...step(l),
      label:
        l.group === 'title'
          ? 'title + registration'
          : `selling costs (${l.label.match(/\d+%/)?.[0] ?? ''})`,
    });
  }
  const contingency = lines.find((l) => l.group === 'contingency');
  if (contingency) {
    steps.push({
      ...step(contingency),
      label: `contingency (${contingency.label.match(/\d+%/)?.[0] ?? ''})`,
    });
  }
  // Repairs roll up per program so the ladder stays readable; a program
  // is a killer when any of its lines is. Grouping keys off the lines so
  // no repair dollar can fall out of the ladder.
  const programIds = [...new Set(lines.filter((l) => l.group === 'repair').map((l) => l.program))];
  for (const id of programIds) {
    const mine = lines.filter((l) => l.group === 'repair' && l.program === id);
    const label = plan.programs.find((p) => p.id === id)?.label ?? String(id ?? 'repairs');
    steps.push({
      id: `program:${id}`,
      label,
      amount: mine.reduce((s, l) => s + l.expected, 0),
      kind: 'cost',
      group: 'repair',
      killer: mine.some((l) => killerIds.has(l.id)) || undefined,
    });
  }
  const fees = lines.filter((l) => l.group === 'fees' || l.group === 'transport');
  steps.push({
    id: 'fees',
    label: 'auction fees + transport',
    amount: fees.reduce((s, l) => s + l.expected, 0),
    kind: 'cost',
    group: 'fees',
  });
  steps.push({
    id: 'bid_fee',
    label: 'bid-dependent fees at the ceiling',
    amount: bidDependentFees(ceiling),
    kind: 'bid_fee',
    group: 'fees',
  });
  steps.push({ id: 'ceiling', label: 'bid ceiling', amount: ceiling, kind: 'ceiling' });
  return steps;
}

// The smallest set of largest REPAIR lines whose removal would make the
// ceiling positive: the reader's answer to "what ate it". Contingency and
// selling costs are derived from repairs and the exit, so they never lead
// the list; the unlocks speak to them.
function killersFor(
  lines: CostLine[],
  deficit: number,
): { id: string; label: string; expected: number }[] {
  if (deficit <= 0) return [];
  const ranked = lines
    .filter((l) => l.group === 'repair' && l.expected > 0)
    .sort((a, b) => b.expected - a.expected);
  const out: { id: string; label: string; expected: number }[] = [];
  let sum = 0;
  for (const l of ranked) {
    out.push({ id: l.id, label: shortLabel(l.label), expected: l.expected });
    sum += l.expected;
    if (sum > deficit) break;
  }
  return out;
}

function unlocksFor(
  lines: CostLine[],
  exit: ExitEstimate,
  profile: CeilingProfile,
  deficit: number,
): Unlock[] {
  if (deficit <= 0) return [];
  const unlocks: Unlock[] = [];
  const biggest = [...lines.filter((l) => l.group === 'repair')].sort(
    (a, b) => b.expected - a.expected,
  )[0];
  // Each note is a clause that completes "it turns positive only if …".
  // `feasible` says whether the evidence leaves room for it at all.
  if (biggest) {
    const required = biggest.expected - Math.ceil(deficit);
    unlocks.push({
      id: `line:${biggest.id}`,
      label: biggest.label,
      required: Math.max(0, required),
      evidence: biggest.expected,
      feasible: required >= biggest.low,
      note:
        required <= 0
          ? `${shortLabel(biggest.label)} cannot rescue it alone: the deficit exceeds the whole line`
          : required < biggest.low
            ? `${shortLabel(biggest.label)} lands under ${usd(required)}, below even its low estimate (${usd(biggest.low)})`
            : `${shortLabel(biggest.label)} lands under ${usd(required)} (expected ${usd(biggest.expected)}, low ${usd(biggest.low)})`,
    });
  }
  // The exit that clears at a $0 bid, with selling costs scaling with it.
  const nonSelling = lines
    .filter((l) => !l.bidDependent && l.group !== 'selling')
    .reduce((s, l) => s + l.expected, 0);
  const share = DISCIPLINE_SHARE - profile.selling.expected;
  if (share > 0) {
    const required = Math.ceil(nonSelling / share / 500) * 500;
    unlocks.push({
      id: 'exit',
      label: 'rebuilt exit',
      required,
      evidence: exit.low,
      feasible: required <= exit.high,
      note: `the rebuilt exit clears ${usd(required)} at the low end (evidence says ${usd(exit.low)} low, ${usd(exit.typical)} typical, ${usd(exit.high)} high)`,
    });
  }
  const contingency = lines.find((l) => l.group === 'contingency');
  if (contingency) {
    unlocks.push({
      id: 'contingency',
      label: 'hidden-damage contingency',
      required: 0,
      evidence: contingency.expected,
      feasible: contingency.expected > deficit,
      note:
        contingency.expected > deficit
          ? `a yard visit rules out hidden damage (keys, ECUs, engine turns, rails as photographed), waiving ${usd(contingency.expected)}`
          : `even waiving the ${usd(contingency.expected)} contingency after a yard visit does not clear it`,
    });
  }
  return unlocks;
}

// -- The ledger -----------------------------------------------------------------------

export function buildLedger(inputs: CeilingInputs): SalvageLedger {
  const { exit, plan, profile } = inputs;
  const exitLow = exit?.low ?? null;
  const lines = fixedLines(inputs, exitLow);
  const discipline = { share: DISCIPLINE_SHARE, basis: DISCIPLINE_BASIS };

  if (!exit || exitLow === null) {
    return {
      exit: null,
      wreck: inputs.wreck,
      costs: [...bidFeeLines(0), ...lines],
      discipline,
      ceiling: null,
      breakEven: null,
      stress: null,
      allInAtCeiling: null,
      ladder: [],
      killers: [],
      unlocks: [],
      sensitivity: [],
      diyHours: plan.diyHoursTotal,
      feesScheduleDate: FEES_SCHEDULE_DATE,
    };
  }

  const solve = (
    scenario: Scenario,
    share = DISCIPLINE_SHARE,
    fees: (bid: number) => number = bidDependentFees,
  ): number => {
    const scenarioLines =
      scenario.exitLow !== null && scenario.exitLow !== exitLow
        ? fixedLines(inputs, scenario.exitLow)
        : lines;
    return solveMaxBid(
      (scenario.exitLow ?? exitLow) * share,
      fixedTotal(scenarioLines, scenario),
      fees,
    );
  };
  const expectedScenario: Scenario = {
    exitLow,
    repairScale: 'expected',
    contingency: 'expected',
  };
  const ceiling = solve(expectedScenario);
  const breakEven = solve(expectedScenario, 1);
  const stress = solve({ exitLow, repairScale: 'high', contingency: 'high' });
  const fixedExpected = fixedTotal(lines, expectedScenario);
  const deficit = fixedExpected - exitLow * DISCIPLINE_SHARE;
  const killerIds = new Set(killersFor(lines, deficit).map((k) => k.id));

  const biggest = [...lines.filter((l) => l.group === 'repair')].sort(
    (a, b) => b.expected - a.expected,
  )[0];
  const hvLine = lines.find(
    (l) => l.group === 'repair' && /hv|hybrid|high-voltage/i.test(l.id + l.label),
  );
  const rows: SensitivityRow[] = [];
  const row = (id: string, label: string, value: number, note: string) =>
    rows.push({ id, label, ceiling: value, delta: value - ceiling, note });
  row(
    'exit-typical',
    'exit lands at typical instead of low',
    solve({ ...expectedScenario, exitLow: exit.typical }),
    `${usd(exit.typical)} instead of ${usd(exitLow)}`,
  );
  if (biggest) {
    row(
      'biggest-low',
      `${shortLabel(biggest.label)} comes in at its low`,
      solve({
        ...expectedScenario,
        repairScale: (l) => (l.id === biggest.id ? l.low : l.expected),
      }),
      `${usd(biggest.low)} instead of ${usd(biggest.expected)}`,
    );
    row(
      'biggest-high',
      `${shortLabel(biggest.label)} hits its high`,
      solve({
        ...expectedScenario,
        repairScale: (l) => (l.id === biggest.id ? l.high : l.expected),
      }),
      `${usd(biggest.high)} instead of ${usd(biggest.expected)}`,
    );
  }
  if (hvLine && hvLine.id !== biggest?.id) {
    row(
      'hv-low',
      `${shortLabel(hvLine.label)} comes in at its low`,
      solve({
        ...expectedScenario,
        repairScale: (l) => (l.id === hvLine.id ? l.low : l.expected),
      }),
      `${usd(hvLine.low)} instead of ${usd(hvLine.expected)}`,
    );
  }
  row(
    'contingency-waived',
    'yard visit rules out hidden damage (contingency waived)',
    solve({ ...expectedScenario, contingency: 'waived' }),
    'keys, ECUs, engine turns, rails as photographed',
  );
  row('all-high', 'every repair line hits its high', stress, 'the stress case');
  row(
    'best-case',
    'exit at typical, every repair at its low, contingency waived',
    solve({ exitLow: exit.typical, repairScale: 'low', contingency: 'waived' }),
    'the most a realistic surprise-free rebuild could justify',
  );
  row(
    'flat-broker',
    'a flat-fee broker instead of a percentage broker',
    solve(expectedScenario, DISCIPLINE_SHARE, (bid) => bidDependentFees(bid, 0) + BROKER_FLAT),
    `${usd(BROKER_FLAT)} flat instead of 4% of the bid`,
  );

  return {
    exit,
    wreck: inputs.wreck,
    costs: [...bidFeeLines(ceiling), ...lines],
    discipline,
    ceiling,
    breakEven,
    stress,
    allInAtCeiling: ceiling + bidDependentFees(ceiling) + fixedExpected,
    ladder: ladderFor(exitLow, lines, plan, ceiling, killerIds),
    killers: killersFor(lines, deficit),
    unlocks: unlocksFor(lines, exit, profile, deficit),
    sensitivity: rows,
    diyHours: plan.diyHoursTotal,
    feesScheduleDate: FEES_SCHEDULE_DATE,
  };
}
