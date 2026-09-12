import { describe, expect, test } from 'vitest';
import { buildLedger, contingencyRate, solveMaxBid, type CeilingInputs } from './ceiling';
import { bidDependentFees, copartBuyerFee } from './fees';
import type { DamageTriage, ExitEstimate, RepairLine, RepairPlan, SalvageLot } from './types';

const lot: SalvageLot = {
  id: 'sf90-front-il',
  title: '2021 Ferrari SF90 Stradale · front hit',
  make: 'Ferrari',
  model: 'SF90 Stradale',
  year: 2021,
  vin: 'ZFF95NLA2M0263155',
  lotNumber: '63198496',
  source: 'test',
  url: 'https://example.com/lot',
  collectedOn: '2026-08-13',
  damage: { primary: 'FRONT END' },
  titleBrand: 'masked on public listing',
  odometer: 3004,
  location: 'IL',
  engine: '4.0L V8 plug-in hybrid',
  fuel: 'Electric and gas hybrid',
  photos: ['https://cs.copart.com/a.jpg'],
};

const triage: DamageTriage = {
  overall: 'borderline',
  areas: [
    {
      area: 'front clip',
      kind: 'structural',
      severity: 'heavy',
      description: 'rails exposed',
      photos: [0],
    },
  ],
  airbagsDeployed: 'no',
  floodEvidence: false,
  fireEvidence: false,
  drivetrainRisk: 'unknown',
  observations: [],
  confidence: 0.6,
};

const line = (
  id: string,
  low: number,
  expected: number,
  high: number,
  over: Partial<RepairLine> = {},
): RepairLine => ({
  id,
  program: 'front',
  task: id,
  who: 'pro',
  reason: 'test',
  low,
  expected,
  high,
  pro: { low, expected, high },
  requires: [],
  evidence: 'curated',
  basis: 'curated: test',
  ...over,
});

function plan(lines: RepairLine[]): RepairPlan {
  const sum = (k: 'low' | 'expected' | 'high') => lines.reduce((s, l) => s + l[k], 0);
  return {
    programs: [
      {
        id: 'front',
        label: 'Front end',
        zones: ['front clip'],
        photos: [0],
        severity: 'heavy',
        structural: true,
        lines,
      },
    ],
    lines,
    diyHoursTotal: lines.reduce((s, l) => s + (l.diyHours ?? 0), 0),
    low: sum('low'),
    expected: sum('expected'),
    high: sum('high'),
    tier: 'exotic',
    tierLabel: 'exotic tier',
    missed: [],
  };
}

const exit: ExitEstimate = {
  low: 260_000,
  typical: 290_000,
  high: 320_000,
  lane: 'clean_sold_derived',
  basis: 'test',
  n: 5,
  comps: [],
  thin: false,
};

const profile: CeilingInputs['profile'] = {
  selling: {
    low: 0.03,
    expected: 0.05,
    high: 0.08,
    channel: 'specialist consignment',
    basis: 'test',
  },
  titleProcess: { low: 250, high: 900, basis: 'test' },
  transport: { low: 800, expected: 1500, high: 3000, basis: 'test' },
  contingencyFloor: 5000,
  hybrid: true,
};

const base = (over: Partial<CeilingInputs> = {}): CeilingInputs => ({
  lot,
  triage,
  plan: plan([
    line('front.structure', 22_000, 32_000, 55_000),
    line('front.parts', 18_000, 26_000, 40_000, { who: 'diy', diyHours: 40 }),
    line('electrical.hv', 2_000, 6_000, 25_000, { program: 'electrical' }),
  ]),
  exit,
  wreck: null,
  profile,
  ...over,
});

const allInAt = (bid: number, fixed: number) => bid + bidDependentFees(bid) + fixed;

describe('the ceiling solve (SPEC 39)', () => {
  test('solveMaxBid returns the highest $500 step whose all-in clears the target', () => {
    const fixed = 100_000;
    const target = 195_000;
    const bid = solveMaxBid(target, fixed);
    expect(bid % 500).toBe(0);
    expect(allInAt(bid, fixed)).toBeLessThanOrEqual(target);
    expect(allInAt(bid + 500, fixed)).toBeGreaterThan(target);
    expect(solveMaxBid(50_000, 100_000)).toBe(0);
  });

  test('the ledger solves ceiling, break-even, and stress consistently with its own lines', () => {
    const ledger = buildLedger(base());
    expect(ledger.ceiling).not.toBeNull();
    expect(ledger.breakEven).not.toBeNull();
    expect(ledger.stress).not.toBeNull();
    const c = ledger.ceiling!;
    // Fees at the ceiling are what the cost table shows.
    const fee = ledger.costs.find((l) => l.id === 'fees.buyer')!;
    expect(fee.expected).toBe(copartBuyerFee(c));
    expect(ledger.costs.filter((l) => l.bidDependent).reduce((s, l) => s + l.expected, 0)).toBe(
      bidDependentFees(c),
    );
    const fixed = ledger.costs.filter((l) => !l.bidDependent).reduce((s, l) => s + l.expected, 0);
    expect(allInAt(c, fixed)).toBeLessThanOrEqual(ledger.discipline.share * exit.low);
    expect(allInAt(c + 500, fixed)).toBeGreaterThan(ledger.discipline.share * exit.low);
    expect(ledger.allInAtCeiling).toBe(allInAt(c, fixed));
    expect(ledger.breakEven!).toBeGreaterThan(c);
    expect(ledger.stress!).toBeLessThanOrEqual(c);
    expect(ledger.discipline.share).toBe(0.75);
  });

  test('the ladder walks from the exit low to the ceiling and its steps sum', () => {
    const ledger = buildLedger(base());
    const [first, ...rest] = ledger.ladder;
    expect(first.kind).toBe('exit');
    expect(first.amount).toBe(exit.low);
    const last = rest[rest.length - 1];
    expect(last.kind).toBe('ceiling');
    expect(last.amount).toBe(ledger.ceiling);
    const removed = rest.filter((s) => s.kind !== 'ceiling').reduce((s, x) => s + x.amount, 0);
    // What is left after every step is the ceiling plus the rounding slack under $500.
    expect(exit.low - removed - ledger.ceiling!).toBeGreaterThanOrEqual(0);
    expect(exit.low - removed - ledger.ceiling!).toBeLessThan(500);
    expect(rest.some((s) => s.kind === 'margin')).toBe(true);
    expect(rest.some((s) => s.kind === 'bid_fee')).toBe(true);
    expect(rest.filter((s) => s.group === 'repair').length).toBeGreaterThan(0);
  });

  test('sensitivity rows re-solve: typical exit raises, all-high equals stress, waived contingency raises', () => {
    const ledger = buildLedger(base());
    const row = (id: string) => ledger.sensitivity.find((r) => r.id === id)!;
    expect(row('exit-typical').ceiling!).toBeGreaterThan(ledger.ceiling!);
    expect(row('all-high').ceiling).toBe(ledger.stress);
    expect(row('contingency-waived').ceiling!).toBeGreaterThan(ledger.ceiling!);
    expect(row('biggest-low').ceiling!).toBeGreaterThan(ledger.ceiling!);
    expect(row('biggest-high').ceiling!).toBeLessThan(ledger.ceiling!);
    expect(row('hv-low')).toBeDefined();
    expect(row('flat-broker').ceiling!).toBeGreaterThan(ledger.ceiling!);
    for (const r of ledger.sensitivity) expect(r.delta).toBe(r.ceiling! - ledger.ceiling!);
  });

  test('a zero ceiling names its killers and what would have to be true', () => {
    const ledger = buildLedger(
      base({
        plan: plan([
          line('front.structure', 60_000, 120_000, 180_000),
          line('front.parts', 40_000, 70_000, 90_000),
        ]),
        exit: { ...exit, low: 180_000, typical: 200_000, high: 220_000 },
      }),
    );
    expect(ledger.ceiling).toBe(0);
    expect(ledger.killers.length).toBeGreaterThan(0);
    expect(ledger.killers[0].id).toBe('front.structure');
    const structure = ledger.unlocks.find((u) => u.id === 'line:front.structure')!;
    expect(structure).toBeDefined();
    // Holding everything else at expected, the structure line must fall by the deficit.
    const fixed = ledger.costs.filter((l) => !l.bidDependent).reduce((s, l) => s + l.expected, 0);
    const deficit = fixed - ledger.discipline.share * 180_000;
    expect(structure.required).toBe(Math.max(0, 120_000 - Math.ceil(deficit)));
    expect(structure.evidence).toBe(120_000);
    expect(structure.note).toMatch(/lands under|cannot rescue/);
    const exitUnlock = ledger.unlocks.find((u) => u.id === 'exit')!;
    expect(exitUnlock.required).toBeGreaterThan(180_000);
    expect(exitUnlock.evidence).toBe(180_000);
    expect(ledger.sensitivity.find((r) => r.id === 'best-case')).toBeDefined();
    expect(ledger.ladder.some((s) => s.killer)).toBe(true);
    expect(ledger.ladder[ledger.ladder.length - 1].amount).toBe(0);
  });

  test('no exit: no ceiling, no selling line, cost side still itemized', () => {
    const ledger = buildLedger(base({ exit: null }));
    expect(ledger.ceiling).toBeNull();
    expect(ledger.breakEven).toBeNull();
    expect(ledger.ladder).toEqual([]);
    expect(ledger.sensitivity).toEqual([]);
    expect(ledger.costs.some((l) => l.group === 'selling')).toBe(false);
    expect(ledger.costs.some((l) => l.group === 'repair')).toBe(true);
    expect(ledger.costs.filter((l) => l.bidDependent).every((l) => l.expected === 0)).toBe(true);
  });

  test('contingency rate follows the damage: heavy structural, HV, low confidence, unknown odometer, capped', () => {
    const light: DamageTriage = { ...triage, areas: [], confidence: 0.8 };
    expect(contingencyRate(light, lot, false).rate).toBe(0.15);
    const heavy = contingencyRate(triage, lot, true);
    expect(heavy.rate).toBe(0.3); // 15 + 10 heavy structural + 5 HV; confidence 0.6 is not low
    expect(heavy.reasons.join(' ')).toMatch(/heavy structural/);
    expect(contingencyRate({ ...triage, confidence: 0.5 }, lot, true).rate).toBe(0.35);
    const worst = contingencyRate(
      { ...triage, confidence: 0.3 },
      { ...lot, odometer: undefined },
      true,
    );
    expect(worst.rate).toBe(0.4);
  });

  test('the contingency line never sits below the tier floor', () => {
    const ledger = buildLedger(
      base({ plan: plan([line('front.parts', 1_000, 2_000, 3_000, { who: 'diy' })]) }),
    );
    const contingency = ledger.costs.find((l) => l.group === 'contingency')!;
    expect(contingency.expected).toBe(5000);
    expect(contingency.low).toBe(5000);
  });
});
