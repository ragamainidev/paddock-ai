/** The ceiling is a property of (lot, bidder): same lot, different bidders, different numbers. */
import { describe, expect, test } from 'vitest';
import { buildLedger, DISCIPLINE_SHARE, type CeilingInputs } from '@/salvage/ceiling';
import { brokerFee, copartBuyerFee, virtualBidFee } from '@/salvage/fees';
import { SHOP_RATE } from '@/salvage/tiers';
import { TITLE_PROCESS } from '@/salvage/title-process';
import type {
  CostLine,
  DamageTriage,
  ExitEstimate,
  RepairLine,
  RepairPlan,
  SalvageLot,
} from '@/salvage/types';
import { buyerLedger } from './buyer-ledger';
import { BUYER_PRESETS, MARKET_PERSONA, type PartialBuyerProfile } from './buyer-profile';
import type { BuyerProfile } from './types';

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

const PAINT_HOURS = 30;
const PAINT_PARTS = { low: 6_000, expected: 9_000, high: 14_000 };
const shopLabor = PAINT_HOURS * SHOP_RATE.exotic;

const mkLine = (
  id: string,
  range: { low: number; expected: number; high: number },
  over: Partial<RepairLine>,
): RepairLine => ({
  id,
  program: 'front',
  task: id,
  who: 'pro',
  reason: 'test',
  ...range,
  pro: range,
  requires: [],
  evidence: 'curated',
  basis: `curated: ${id}`,
  ...over,
});

// A curated plan prices paint professionally for everyone (SPEC 35), so the
// booth gate needs a plan that does not: this fixture states the DIY paint
// line the gate exists to convert.
const lines: RepairLine[] = [
  mkLine(
    'front.structure',
    { low: 22_000, expected: 32_000, high: 55_000 },
    {
      requires: ['structural'],
    },
  ),
  mkLine('paint.program', PAINT_PARTS, {
    program: 'paint',
    who: 'diy',
    diyHours: PAINT_HOURS,
    requires: ['paint'],
    pro: {
      low: PAINT_PARTS.low + shopLabor,
      expected: PAINT_PARTS.expected + shopLabor,
      high: PAINT_PARTS.high + shopLabor,
    },
  }),
  mkLine(
    'front.panels',
    { low: 12_000, expected: 18_000, high: 26_000 },
    {
      who: 'diy',
      diyHours: 40,
    },
  ),
];

const plan: RepairPlan = {
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
  diyHoursTotal: PAINT_HOURS + 40,
  low: lines.reduce((s, l) => s + l.low, 0),
  expected: lines.reduce((s, l) => s + l.expected, 0),
  high: lines.reduce((s, l) => s + l.high, 0),
  tier: 'exotic',
  tierLabel: 'exotic tier',
  missed: [],
};

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

const inputs: CeilingInputs = {
  lot,
  triage,
  plan,
  exit,
  wreck: null,
  profile: {
    selling: {
      low: 0.015,
      expected: 0.04,
      high: 0.09,
      channel: 'online enthusiast auction',
      basis: 'tier selling band',
    },
    titleProcess: { low: 150, high: 600, basis: 'national band' },
    transport: { low: 800, expected: 1_500, high: 3_000, basis: 'test' },
    contingencyFloor: 5_000,
    hybrid: true,
  },
};

const ledger = buildLedger(inputs);

const buyer = (over: PartialBuyerProfile = {}): BuyerProfile => ({
  ...BUYER_PRESETS.hobbyist,
  ...over,
  capabilities: { ...BUYER_PRESETS.hobbyist.capabilities, ...over.capabilities },
});

// Everything the kernel assumes and nothing more: no labor, no holding, no
// required surplus, cash that never binds, every tool owned, the kernel's own
// discipline, fee mode and channel, and no stated jurisdiction.
const NEUTRAL = buyer({
  jurisdiction: 'US-unspecified',
  access: 'broker',
  exit: 'private_party',
  discipline: DISCIPLINE_SHARE,
  capabilities: {
    tools: true,
    workspace: true,
    lift: true,
    diagnostics: true,
    specialistAccess: true,
    structural: true,
    paint: true,
    alignment: true,
    hv: true,
  },
  laborRatePerHour: 0,
  holdingDays: 0,
  holdingCostPerDay: 0,
  minSurplus: 0,
  maxAllIn: 10_000_000,
});

const priceFor = (b: BuyerProfile) => buyerLedger({ inputs, exit, ledger, buyer: b });
const lineOf = (l: CostLine[], id: string) => l.find((x) => x.id === id);

describe('the bidder-relative ledger (SPEC 59)', () => {
  test('a profile that assumes what the kernel assumes reproduces the kernel exactly', () => {
    const economics = priceFor(NEUTRAL);
    expect(ledger.ceiling).toBeGreaterThan(0);
    expect(economics.maxBid).toBe(ledger.ceiling);
    expect(economics.kernelMaxBid).toBe(ledger.ceiling);
    expect(economics.laborOpportunityCost).toBe(0);
    expect(economics.holdingCost).toBe(0);
    expect(economics.fixedCost).toBe(
      ledger.costs.filter((c) => !c.bidDependent).reduce((s, c) => s + c.expected, 0),
    );
    expect(economics.exit).toEqual({
      low: exit.low,
      typical: Math.round((exit.low + exit.high) / 2),
      high: exit.high,
      basis: expect.stringContaining('a private sale'),
    });
  });

  test('no buyer input edits the kernel: same inputs and ledger before and after', () => {
    const before = structuredClone({ inputs, ledger });
    for (const preset of ['hobbyist', 'shop', 'dealer'] as const) priceFor(BUYER_PRESETS[preset]);
    priceFor(
      buyer({ jurisdiction: 'US-CA', exit: 'wholesale', access: 'direct', discipline: 0.9 }),
    );
    expect({ inputs, ledger }).toEqual(before);
  });

  test('three presets bid three different ceilings on one lot, every line with a basis', () => {
    const ceilings = (['hobbyist', 'shop', 'dealer'] as const).map((preset) => {
      const economics = priceFor(BUYER_PRESETS[preset]);
      for (const line of economics.lines) {
        expect(line.basis.trim(), `${preset}:${line.id}`).not.toBe('');
        expect(line.expected, `${preset}:${line.id}`).toBeGreaterThanOrEqual(0);
      }
      // Every line this layer decided says so with a derived chip.
      for (const id of ['fees.fixed', 'fees.buyer', 'selling', 'labor', 'holding'])
        expect(lineOf(economics.lines, id)?.evidence, `${preset}:${id}`).toBe('derived');
      // Every buyer-side dollar is in a line: the bid plus the lines is the
      // all-in, and the cash arm is the same sum without selling or labor.
      expect(economics.maxBid + economics.lines.reduce((s, l) => s + l.expected, 0)).toBe(
        economics.totalEconomicCostAtCeiling,
      );
      expect(
        economics.maxBid +
          economics.lines
            .filter((l) => l.group !== 'selling' && l.group !== 'labor')
            .reduce((s, l) => s + l.expected, 0),
      ).toBe(economics.cashAtCeiling);
      return economics.maxBid;
    });
    // Three bidders, three answers on one lot. The hobbyist's $40,000 cash
    // limit cannot buy an exotic rebuild at all; the shop owns every tool and
    // buys direct but sells into the wholesale lane at 0.80 of private-party
    // money, which the dealer's retail exit beats even after subcontracting
    // every line of the work.
    expect(ceilings).toEqual([0, 60_500, 83_500]);
  });

  test('a buyer without a booth buys the paint line, at the shop price and with the reason', () => {
    const equipped = priceFor(NEUTRAL);
    const noBooth = priceFor(
      buyer({ ...NEUTRAL, capabilities: { ...NEUTRAL.capabilities, paint: false } }),
    );
    const line = lineOf(noBooth.lines, 'paint.program')!;
    expect(line.expected).toBe(PAINT_PARTS.expected + shopLabor);
    expect(line.basis).toContain('converted to professional: buyer lacks paint');
    expect(line.basis).toContain('exotic shop rate');
    expect(line.evidence).toBe('derived');
    // Its hours leave the labor line rather than being charged twice.
    const hourly = buyer({
      ...NEUTRAL,
      laborRatePerHour: 50,
      capabilities: { ...NEUTRAL.capabilities, paint: false },
    });
    expect(priceFor(hourly).laborOpportunityCost).toBe(40 * 50);
    expect(lineOf(equipped.lines, 'paint.program')!.expected).toBe(PAINT_PARTS.expected);
    // Buying the work costs more than doing it, so the ceiling can only fall.
    expect(noBooth.maxBid).toBeLessThan(equipped.maxBid);
  });

  test('a capability gate never hands professional work back to the buyer (SPEC 35)', () => {
    const structural = lineOf(priceFor(BUYER_PRESETS.shop).lines, 'front.structure')!;
    expect(structural.expected).toBe(32_000);
    expect(structural.basis).not.toContain('converted to professional');
    expect(structural.evidence).toBe('curated');
  });

  test('direct access drops the broker lines and lifts what this buyer can pay', () => {
    const broker = priceFor(NEUTRAL);
    const direct = priceFor(buyer({ ...NEUTRAL, access: 'direct' }));
    expect(lineOf(broker.lines, 'fees.broker')).toBeDefined();
    expect(lineOf(direct.lines, 'fees.broker')).toBeUndefined();
    // Copart's own per-vehicle broker charge leaves the flat total with it.
    expect(lineOf(broker.lines, 'fees.fixed')!.expected).toBe(230);
    expect(lineOf(direct.lines, 'fees.fixed')!.expected).toBe(130);
    expect(lineOf(direct.lines, 'fees.fixed')!.basis).toContain('a direct licensed account');
    expect(lineOf(broker.lines, 'fees.fixed')!.basis).toContain('through a broker');
    // The auction's own bid-dependent lines are untouched by the fee mode.
    expect(lineOf(direct.lines, 'fees.buyer')!.expected).toBe(copartBuyerFee(direct.maxBid));
    expect(lineOf(direct.lines, 'fees.virtual')!.expected).toBe(virtualBidFee(direct.maxBid));
    expect(direct.maxBid).toBeGreaterThan(broker.maxBid);
    expect(direct.maxBid - broker.maxBid).toBeGreaterThan(brokerFee(broker.maxBid));
  });

  test('wholesale lowers the exit and charges the lane its own seller costs', () => {
    const wholesale = priceFor(buyer({ ...NEUTRAL, exit: 'wholesale' }));
    expect(wholesale.exit.low).toBe(Math.round(exit.low * 0.8));
    expect(wholesale.exit.high).toBe(Math.round(exit.high * 0.9));
    expect(wholesale.exit.basis).toContain('0.80–0.90 of private-party money');
    const selling = lineOf(wholesale.lines, 'selling')!;
    expect(selling.expected).toBe(Math.round(0.04 * wholesale.exit.low));
    expect(selling.label).toContain('dealer auction');
    expect(selling.basis).toContain('Manheim');
    expect(selling.evidence).toBe('derived');
    expect(wholesale.maxBid).toBeLessThan(priceFor(NEUTRAL).maxBid);
  });

  test('retail sells for more and costs more to sell', () => {
    const retail = priceFor(buyer({ ...NEUTRAL, exit: 'retail' }));
    expect(retail.exit.low).toBe(exit.low);
    expect(retail.exit.high).toBe(Math.round(exit.high * 1.05));
    const selling = lineOf(retail.lines, 'selling')!;
    expect(selling.expected).toBe(Math.round(0.08 * exit.low));
    // 8% of the exit against the tier's own 4%: the ceiling pays for the lot.
    expect(retail.maxBid).toBeLessThan(priceFor(NEUTRAL).maxBid);
  });

  test('a car that is never sold carries a zero selling line, and says so', () => {
    const keep = priceFor(buyer({ ...NEUTRAL, exit: 'keep' }));
    // The line stays in the ledger at zero, so `lines` is the whole of it.
    const selling = lineOf(keep.lines, 'selling')!;
    expect([selling.low, selling.expected, selling.high]).toEqual([0, 0, 0]);
    expect(selling.label).toBe('selling costs (no sale planned)');
    expect(selling.basis).toContain('no sale planned; value retained at private-party typical');
    expect(selling.evidence).toBe('derived');
    expect(keep.exit).toEqual({
      low: exit.low,
      typical: Math.round((exit.low + exit.high) / 2),
      high: exit.high,
      basis: expect.stringContaining('no sale planned; value retained at private-party typical'),
    });
    expect(keep.maxBid).toBeGreaterThan(priceFor(NEUTRAL).maxBid);
  });

  test('a tabulated state replaces the title line; an untabulated one keeps the kernel band', () => {
    const ca = lineOf(priceFor(buyer({ ...NEUTRAL, jurisdiction: 'US-CA' })).lines, 'title')!;
    expect([ca.low, ca.high]).toEqual([TITLE_PROCESS['US-CA'].low, TITLE_PROCESS['US-CA'].high]);
    expect(ca.expected).toBe(
      Math.round((TITLE_PROCESS['US-CA'].low + TITLE_PROCESS['US-CA'].high) / 2),
    );
    expect(ca.basis).toContain('US-CA California revived salvage');
    expect(ca.basis).toContain('https://');
    expect(ca.evidence).toBe('derived');
    // An untabulated jurisdiction keeps the kernel's national band exactly as
    // the kernel states it: no "state not tabulated" suffix on a kernel line.
    const ks = lineOf(priceFor(buyer({ ...NEUTRAL, jurisdiction: 'US-KS' })).lines, 'title')!;
    expect([ks.low, ks.expected, ks.high]).toEqual([150, 375, 600]);
    expect(ks.basis).toBe('national band');
  });

  test('the title process moves both ceilings, so the state never makes the edge', () => {
    // The persona registers the car where the buyer does (SPEC 60), so a
    // tabulated state's fees are paid by both bidders: only the ceilings move.
    const stated = priceFor(buyer({ ...NEUTRAL, jurisdiction: 'US-CA' }));
    const unstated = priceFor(buyer({ ...NEUTRAL, jurisdiction: 'US-unspecified' }));
    expect(stated.edge).toBe(unstated.edge);
    expect(lineOf(stated.market.lines, 'title')!.basis).toContain(
      'US-CA California revived salvage',
    );
    expect(lineOf(unstated.market.lines, 'title')!.basis).toBe('national band');
    // California's process costs more than the national band, and both
    // ceilings carry it.
    expect(stated.maxBid).toBeLessThanOrEqual(unstated.maxBid);
    expect(stated.market.maxBid!).toBeLessThanOrEqual(unstated.market.maxBid!);
  });

  test('discipline tightens the ceiling and can never loosen it past the kernel (SPEC 58)', () => {
    const kernel = priceFor(NEUTRAL);
    const loose = priceFor(buyer({ ...NEUTRAL, discipline: 0.9 }));
    const tight = priceFor(buyer({ ...NEUTRAL, discipline: 0.5 }));
    expect(loose.maxBid).toBe(kernel.maxBid);
    expect(loose.maxBid).toBeLessThanOrEqual(ledger.ceiling!);
    expect(loose.discipline.share).toBe(DISCIPLINE_SHARE);
    expect(loose.discipline.basis).toContain(
      'your discipline: all-in stays at 90% of the low exit',
    );
    expect(loose.discipline.basis).toContain("capped at the market persona's 75%");
    expect(tight.maxBid).toBeLessThan(kernel.maxBid);
    expect(tight.discipline.share).toBe(0.5);
    expect(tight.discipline.basis).toBe('your discipline: all-in stays at 50% of the low exit');
    // A required surplus larger than the discipline margin binds instead, and
    // the reported share is the one that bound, not the one stated.
    const surplus = priceFor(buyer({ ...NEUTRAL, minSurplus: 100_000 }));
    expect(surplus.discipline.share).toBe((exit.low - 100_000) / exit.low);
    expect(surplus.discipline.basis).toContain('$100,000 required surplus binds first');
    expect(surplus.maxBid).toBeLessThan(kernel.maxBid);
  });

  test('the ceiling names the arm that bound it, and a cash limit is one of them', () => {
    // Four arms solve the same ceiling and the smallest wins, so a sentence
    // quoting the ceiling has to read which one produced it rather than the
    // margin the ceiling merely kept (SPEC 58).
    const kernel = priceFor(NEUTRAL);
    expect(kernel.discipline.bound).toBe('discipline');
    // A discipline above the kernel's is clamped by it; an equal one is not a
    // clamp taking effect.
    expect(priceFor(buyer({ ...NEUTRAL, discipline: 0.9 })).discipline.bound).toBe('kernel');
    expect(priceFor(buyer({ ...NEUTRAL, minSurplus: 100_000 })).discipline.bound).toBe('surplus');
    const capped = priceFor(buyer({ ...NEUTRAL, maxAllIn: 60_000 }));
    expect(capped.discipline.bound).toBe('cash');
    expect(capped.maxBid).toBeLessThan(kernel.maxBid);
    // A cash limit binds the bid, never the target: the share the discipline
    // arm holds is unchanged by it.
    expect(capped.discipline.share).toBe(DISCIPLINE_SHARE);
    expect(capped.discipline.basis).toBe(kernel.discipline.basis);
    // The persona has no cash arm by construction (SPEC 60), so the room's
    // price is never a cash bind.
    expect(priceFor(MARKET_PERSONA).discipline.bound).toBe('discipline');
  });

  test('the market persona prices the same lot for the room, and the hobbyist has no edge on it', () => {
    // One lot, two ceilings: the professional rebuilder who sets the room's
    // price against the wedge, on the same plan and the same exit evidence
    // (SPEC 60).
    const hobbyist = priceFor(BUYER_PRESETS.hobbyist);
    const persona = priceFor(MARKET_PERSONA);
    expect(persona.maxBid).toBeGreaterThan(0);
    expect(hobbyist.market.maxBid).toBe(persona.maxBid);
    expect(hobbyist.maxBid).toBeLessThan(persona.maxBid);
    expect(hobbyist.edge).toBe(hobbyist.maxBid - persona.maxBid);
    expect(hobbyist.edge!).toBeLessThan(0);
    // The persona's own ledger, not a second arithmetic: every line states its
    // basis, and the market basis names whose ceiling this is.
    expect(hobbyist.market.lines).toEqual(persona.lines);
    for (const line of hobbyist.market.lines) expect(line.basis.trim(), line.id).not.toBe('');
    expect(hobbyist.market.basis).toContain("the professional rebuilder who sets the room's price");
    // The kernel's own vehicle-relative ceiling is a third number and stays it.
    expect(hobbyist.kernelMaxBid).toBe(ledger.ceiling);
    expect(persona.maxBid).not.toBe(ledger.ceiling);
  });

  test('a shop with a retail exit and no cash arm is the market persona: the edge is zero', () => {
    const persona = priceFor(MARKET_PERSONA);
    expect(persona.edge).toBe(0);
    // The persona is the shop preset's resources, selling retail through a
    // direct account, with no cash limit to bind (docs/salvage-economics.md §8).
    const shop = priceFor(
      buyer({
        ...BUYER_PRESETS.shop,
        exit: 'retail',
        access: 'direct',
        maxAllIn: MARKET_PERSONA.maxAllIn,
      }),
    );
    expect(shop.maxBid).toBe(persona.maxBid);
    expect(shop.edge).toBe(0);
    // The shop preset's own $150,000 limit binds on an exotic rebuild, and a
    // limit that binds is itself a reason a bidder cannot reach the room.
    const capped = priceFor(buyer({ ...BUYER_PRESETS.shop, exit: 'retail' }));
    expect(capped.maxBid).toBeLessThan(persona.maxBid);
    expect(capped.edge!).toBeLessThan(0);
  });

  test("the buyer's own time and holding are lines, priced and outside the cash arm", () => {
    const economics = priceFor(
      buyer({ ...NEUTRAL, laborRatePerHour: 25, holdingDays: 90, holdingCostPerDay: 10 }),
    );
    const labor = lineOf(economics.lines, 'labor')!;
    const holding = lineOf(economics.lines, 'holding')!;
    expect(labor.expected).toBe(70 * 25);
    expect(labor.group).toBe('labor');
    expect(labor.basis).toContain('70 DIY hours');
    expect(holding.expected).toBe(900);
    expect(economics.laborOpportunityCost).toBe(labor.expected);
    expect(economics.holdingCost).toBe(holding.expected);
    expect(economics.totalEconomicCostAtCeiling - economics.cashAtCeiling).toBe(
      labor.expected + lineOf(economics.lines, 'selling')!.expected,
    );
  });
});
