import { describe, expect, test } from 'vitest';
import {
  applyPriceEvidence,
  deriveRepairPlan,
  lineResearchTopics,
  screenPriceEvidence,
  whatPeopleMiss,
} from './knowledge';
import { getSalvageLot } from './seed-lots';
import { profileFor, SHOP_RATE, SHOP_RATE_BASIS } from './tiers';
import type { DamageArea, DamageTriage, PriceEvidence, SalvageLot } from './types';

const sf90 = getSalvageLot('sf90-front-il')!;
const f458 = getSalvageLot('458-rear-pa')!;
const artura = getSalvageLot('artura-vandalism-ca')!;

const area = (over: Partial<DamageArea> & { area: string }): DamageArea => ({
  kind: 'cosmetic',
  severity: 'moderate',
  description: 'test',
  photos: [0],
  ...over,
});

const triageOf = (areas: DamageArea[], over: Partial<DamageTriage> = {}): DamageTriage => ({
  overall: 'borderline',
  areas,
  airbagsDeployed: 'no',
  floodEvidence: false,
  fireEvidence: false,
  drivetrainRisk: 'unknown',
  observations: [],
  confidence: 0.7,
  ...over,
});

const line = (plan: ReturnType<typeof deriveRepairPlan>, id: string) =>
  plan.lines.find((l) => l.id === id);

describe('repair programs: one damage event is priced once (SPEC 43)', () => {
  test('three heavy structural front zones become ONE front program with ONE structural line', () => {
    const triage = triageOf([
      area({ area: 'front clip', kind: 'structural', severity: 'heavy' }),
      area({ area: 'left front corner', kind: 'structural', severity: 'heavy' }),
      area({ area: 'right front corner', kind: 'structural', severity: 'heavy' }),
      area({ area: 'hood', severity: 'light' }),
    ]);
    const plan = deriveRepairPlan(triage, sf90, profileFor(sf90));
    const front = plan.programs.find((p) => p.id === 'front')!;
    expect(front.zones).toEqual(['front clip', 'left front corner', 'right front corner', 'hood']);
    expect(front.structural).toBe(true);
    expect(front.severity).toBe('heavy');
    const structural = plan.lines.filter((l) => /\.structure$/.test(l.id));
    expect(structural).toHaveLength(1);
    expect(structural[0].program).toBe('front');
    expect(structural[0].who).toBe('pro'); // SPEC 35: aluminum structure is never DIY
    // Heavy rate for the chassis, +25% per extra heavy zone (two extras → ×1.5).
    const rate = profileFor(sf90).structural.heavy;
    expect(structural[0].expected).toBe(Math.round(rate.expected * 1.5));
    expect(structural[0].low).toBe(Math.round(rate.low * 1.5));
    expect(structural[0].basis).toMatch(/3 zones/);
  });

  test('a heavy front hit lists the parts a front hit destroys, sized by the profile', () => {
    const profile = profileFor(sf90);
    const plan = deriveRepairPlan(
      triageOf([area({ area: 'front clip', kind: 'structural', severity: 'heavy' })]),
      sf90,
      profile,
    );
    const panels = line(plan, 'front.panels')!;
    expect(panels.who).toBe('diy');
    expect(panels.expected).toBe(
      profile.parts.bumperCover.expected +
        profile.parts.hood.expected +
        2 * profile.parts.fender.expected,
    );
    const lamps = line(plan, 'front.lamps')!;
    expect(lamps.expected).toBe(2 * profile.parts.headlamp.expected);
    expect(lamps.evidence).toBe('override'); // SF90 headlamps are a model override
    expect(line(plan, 'front.cooling')).toBeDefined();
    expect(line(plan, 'front.sensors')).toBeDefined(); // ADAS car
    expect(line(plan, 'baseline.adas_calibration')?.who).toBe('pro');
    expect(line(plan, 'baseline.hv_isolation')?.who).toBe('pro');
    expect(line(plan, 'baseline.alignment')).toBeDefined();
    expect(plan.tierLabel).toMatch(/exotic tier · SF90 Stradale overrides/);
  });

  test('a light front bumper scuff is a small program: bumper and paint, no lamps, no cooling', () => {
    const plan = deriveRepairPlan(
      triageOf([area({ area: 'front clip', severity: 'light' })]),
      sf90,
      profileFor(sf90),
    );
    expect(line(plan, 'front.panels')).toBeDefined();
    expect(line(plan, 'front.lamps')).toBeUndefined();
    expect(line(plan, 'front.cooling')).toBeUndefined();
    expect(line(plan, 'front.structure')).toBeUndefined();
    expect(line(plan, 'paint.program')).toBeDefined();
    expect(plan.expected).toBeLessThan(25_000);
  });

  test('paint is ONE program across every refinished zone', () => {
    const plan = deriveRepairPlan(
      triageOf([
        area({ area: 'front clip', severity: 'moderate' }),
        area({ area: 'hood', severity: 'light' }),
        area({ area: 'left side', severity: 'moderate' }),
        area({ area: 'interior', severity: 'light' }), // interior is not painted
      ]),
      sf90,
      profileFor(sf90),
    );
    const paint = plan.lines.filter((l) => l.program === 'paint');
    expect(paint).toHaveLength(1);
    expect(paint[0].who).toBe('pro');
    expect(paint[0].task).toMatch(/3 zones/);
  });

  test('a rear hit on a mid-engine car prices the drivetrain exposure once, with the model override', () => {
    const profile = profileFor(f458);
    const plan = deriveRepairPlan(
      triageOf([
        area({ area: 'rear clip', kind: 'structural', severity: 'heavy' }),
        area({ area: 'rear structure', kind: 'mechanical', severity: 'heavy' }),
      ]),
      f458,
      profile,
    );
    const mech = plan.lines.filter((l) => l.id === 'rear.mechanical');
    expect(mech).toHaveLength(1);
    expect(mech[0].expected).toBe(profile.mechanical.heavy.expected);
    expect(mech[0].evidence).toBe('override');
    expect(line(plan, 'baseline.hv_isolation')).toBeUndefined(); // not a hybrid
    expect(line(plan, 'baseline.adas_calibration')).toBeUndefined(); // 2012: no ADAS
    expect(line(plan, 'rear.lamps')?.expected).toBe(2 * profile.parts.tailLamp.expected);
  });

  test('hybrid electrical damage is a pro HV line; a 12V car gets a DIY harness line; deployed airbags add SRS', () => {
    const hv = deriveRepairPlan(
      triageOf([area({ area: 'electrical', kind: 'electrical', severity: 'moderate' })], {
        airbagsDeployed: 'yes',
      }),
      sf90,
      profileFor(sf90),
    );
    expect(line(hv, 'electrical.hv')?.who).toBe('pro');
    expect(line(hv, 'srs.system')?.who).toBe('pro');
    const twelveVolt = deriveRepairPlan(
      triageOf([area({ area: 'electrical', kind: 'electrical', severity: 'moderate' })]),
      f458,
      profileFor(f458),
    );
    expect(line(twelveVolt, 'electrical.harness')?.who).toBe('diy');
    expect(line(twelveVolt, 'electrical.hv')).toBeUndefined();
  });

  test('carbon tub structural work is always pro, priced once for the program', () => {
    const plan = deriveRepairPlan(
      triageOf([area({ area: 'left side', kind: 'structural', severity: 'moderate' })]),
      artura,
      profileFor(artura),
    );
    const s = line(plan, 'side_left.structure')!;
    expect(s.who).toBe('pro');
    expect(s.reason).toMatch(/carbon/i);
  });

  test('flood adds the remediation program; an unknown make falls to the mainstream tier, labeled', () => {
    const civic: SalvageLot = {
      ...sf90,
      id: 'civic',
      make: 'Honda',
      model: 'Civic',
      year: 2019,
      engine: '2.0L I4',
      fuel: 'Gasoline',
    };
    const profile = profileFor(civic);
    expect(profile.tier).toBe('mainstream');
    const plan = deriveRepairPlan(
      triageOf([area({ area: 'interior', severity: 'moderate' })], { floodEvidence: true }),
      civic,
      profile,
    );
    expect(line(plan, 'flood.remediation')?.who).toBe('diy');
    expect(plan.tierLabel).toMatch(/mainstream tier \(default for Honda\)/);
    expect(line(plan, 'baseline.hv_isolation')).toBeUndefined();
  });

  test('plan totals are the sums of the lines and DIY hours are counted', () => {
    const plan = deriveRepairPlan(
      triageOf([
        area({ area: 'front clip', kind: 'structural', severity: 'heavy' }),
        area({ area: 'wheels/suspension', kind: 'mechanical', severity: 'heavy' }),
      ]),
      sf90,
      profileFor(sf90),
    );
    const sum = (k: 'low' | 'expected' | 'high') => plan.lines.reduce((s, l) => s + l[k], 0);
    expect(plan.low).toBe(sum('low'));
    expect(plan.expected).toBe(sum('expected'));
    expect(plan.high).toBe(sum('high'));
    expect(plan.low).toBeLessThan(plan.expected);
    expect(plan.expected).toBeLessThan(plan.high);
    expect(plan.diyHoursTotal).toBeGreaterThan(0);
    for (const l of plan.lines) {
      expect(l.low).toBeLessThanOrEqual(l.expected);
      expect(l.expected).toBeLessThanOrEqual(l.high);
    }
  });
});

describe('the professional price and the equipment a line needs', () => {
  const everything = triageOf(
    [
      area({ area: 'front clip', kind: 'structural', severity: 'heavy' }),
      area({ area: 'wheels/suspension', kind: 'mechanical', severity: 'moderate' }),
      area({ area: 'electrical', kind: 'electrical', severity: 'moderate' }),
    ],
    { airbagsDeployed: 'yes' },
  );

  test('a DIY line prices professionally at its parts plus its hours at the tier rate', () => {
    const plan = deriveRepairPlan(everything, sf90, profileFor(sf90));
    const rate = SHOP_RATE[plan.tier];
    expect(rate).toBe(193); // exotic tier
    const diy = plan.lines.filter((l) => l.who === 'diy');
    expect(diy.length).toBeGreaterThan(0);
    for (const l of diy) {
      const labor = (l.diyHours ?? 0) * rate;
      expect(labor, l.id).toBeGreaterThan(0);
      expect(l.pro, l.id).toEqual({
        low: l.low + labor,
        expected: l.expected + labor,
        high: l.high + labor,
      });
    }
  });

  test('a professional line prices at its own range: there is no second labor charge', () => {
    const plan = deriveRepairPlan(everything, sf90, profileFor(sf90));
    const pro = plan.lines.filter((l) => l.who === 'pro');
    expect(pro.length).toBeGreaterThan(0);
    for (const l of pro) {
      expect(l.pro, l.id).toEqual({ low: l.low, expected: l.expected, high: l.high });
    }
  });

  test('the tier sets the rate: the same DIY task costs more at a shop on an exotic', () => {
    const civic: SalvageLot = { ...sf90, id: 'civic', make: 'Honda', model: 'Civic', year: 2019 };
    const plan = deriveRepairPlan(everything, civic, profileFor(civic));
    expect(plan.tier).toBe('mainstream');
    const panels = line(plan, 'front.panels')!;
    expect(panels.pro.expected - panels.expected).toBe(panels.diyHours! * SHOP_RATE.mainstream);
    expect(SHOP_RATE.mainstream).toBeLessThan(SHOP_RATE.premium);
    expect(SHOP_RATE.premium).toBeLessThan(SHOP_RATE.exotic);
    // The basis is what a reader checks the rates against; it names every one.
    for (const rate of Object.values(SHOP_RATE)) expect(SHOP_RATE_BASIS).toContain(`$${rate}`);
  });

  test('a cited price raises the professional price by exactly what it raises the parts', () => {
    const plan = deriveRepairPlan(everything, sf90, profileFor(sf90));
    const before = line(plan, 'front.lamps')!;
    const { plan: narrowed } = applyPriceEvidence(plan, [
      {
        line: 'front.lamps',
        item: 'LED headlamp assembly, left',
        kind: 'part_new',
        low: 12_000,
        high: 13_500,
        url: 'https://eurospares.co.uk/x',
        source: 'eurospares.co.uk',
      },
    ]);
    const after = line(narrowed, 'front.lamps')!;
    expect(after.low).toBeGreaterThan(before.low);
    expect(after.pro.low - after.low).toBe(before.pro.low - before.low);
    expect(after.pro.expected - after.expected).toBe(after.diyHours! * SHOP_RATE.exotic);
  });

  test('every line names the equipment it needs, and most need none', () => {
    const plan = deriveRepairPlan(everything, sf90, profileFor(sf90));
    for (const l of plan.lines) expect(Array.isArray(l.requires), l.id).toBe(true);
    expect(line(plan, 'front.structure')!.requires).toEqual(['structural']);
    expect(line(plan, 'paint.program')!.requires).toEqual(['paint']);
    // A line requires only what its own task cannot be done without: the
    // alignment the suspension work makes necessary is `baseline.alignment`.
    expect(line(plan, 'wheels_suspension.corner')!.requires).toEqual([]);
    expect(line(plan, 'baseline.alignment')!.requires).toEqual(['alignment']);
    expect(line(plan, 'baseline.hv_isolation')!.requires).toEqual(['hv']);
    expect(line(plan, 'electrical.hv')!.requires).toEqual(['hv']);
    // Bolt-on panels, lamps and trim are hand tools and a driveway.
    expect(line(plan, 'front.panels')!.requires).toEqual([]);
    expect(line(plan, 'front.lamps')!.requires).toEqual([]);
    expect(line(plan, 'srs.system')!.requires).toEqual([]);
  });
});

describe('cited price evidence narrows the plan', () => {
  const plan = deriveRepairPlan(
    triageOf([area({ area: 'front clip', kind: 'structural', severity: 'heavy' })]),
    sf90,
    profileFor(sf90),
  );

  test('part citations raise a line low and expected, never lower them; the chip turns cited', () => {
    const lamps = line(plan, 'front.lamps')!;
    const narrowed = applyPriceEvidence(plan, [
      {
        line: 'front.lamps',
        item: 'LED headlamp assembly, left',
        kind: 'part_new',
        low: 12_000,
        high: 13_500,
        url: 'https://eurospares.co.uk/x',
        source: 'eurospares.co.uk',
      },
      {
        line: 'front.lamps',
        item: 'LED headlamp assembly, right',
        kind: 'part_new',
        low: 12_000,
        high: 13_500,
        url: 'https://eurospares.co.uk/y',
        source: 'eurospares.co.uk',
      },
    ]);
    const after = narrowed.plan.lines.find((l) => l.id === 'front.lamps')!;
    expect(after.low).toBe(24_000);
    expect(after.expected).toBe(Math.max(lamps.expected, 25_500));
    expect(after.high).toBeGreaterThanOrEqual(27_000);
    expect(after.evidence).toBe('cited');
    expect(after.basis).toMatch(/cited: eurospares.co.uk/);
    expect(after.citations).toHaveLength(2);
    expect(narrowed.notes[0]).toMatch(/front.lamps|headlamps/i);
    // A cheap citation cannot pull the line down.
    const cheap = applyPriceEvidence(plan, [
      {
        line: 'front.lamps',
        item: 'used headlamp',
        kind: 'part_used',
        low: 500,
        high: 900,
        url: 'https://ebay.com/x',
        source: 'ebay.com',
      },
    ]).plan.lines.find((l) => l.id === 'front.lamps')!;
    expect(cheap.low).toBe(lamps.low);
    expect(cheap.expected).toBe(lamps.expected);
  });

  test('a job quote sets the expected value; unknown line ids are ignored; totals are recomputed', () => {
    const narrowed = applyPriceEvidence(plan, [
      {
        line: 'front.structure',
        item: 'front frame section replacement, Ferrari-approved shop',
        kind: 'job_quote',
        low: 60_000,
        high: 70_000,
        url: 'https://ferrarichat.com/x',
        source: 'ferrarichat.com',
      },
      {
        line: 'nowhere.nothing',
        item: 'ghost',
        kind: 'part_new',
        low: 1,
        high: 2,
        url: 'https://example.com',
        source: 'example.com',
      },
    ]);
    const s = narrowed.plan.lines.find((l) => l.id === 'front.structure')!;
    expect(s.expected).toBe(65_000);
    expect(s.low).toBe(60_000);
    expect(s.high).toBeGreaterThanOrEqual(70_000);
    expect(narrowed.plan.expected).toBe(narrowed.plan.lines.reduce((a, l) => a + l.expected, 0));
    expect(narrowed.notes).toHaveLength(1);
  });
});

describe('price evidence screening', () => {
  const plan = deriveRepairPlan(
    triageOf([area({ area: 'front clip', kind: 'structural', severity: 'heavy' })]),
    sf90,
    profileFor(sf90),
  );
  const cite = (
    over: Partial<PriceEvidence> & { item: string; low: number; high: number },
  ): PriceEvidence => ({
    line: 'front.panels',
    kind: 'part_new',
    url: `https://parts4usa.com/${encodeURIComponent(over.item)}`,
    source: 'parts4usa.com',
    ...over,
  });

  test('off-spec, aftermarket, comparison, structure, and duplicate items are set aside, never summed', () => {
    const before = line(plan, 'front.panels')!;
    const narrowed = applyPriceEvidence(
      plan,
      [
        cite({
          item: 'Front hood, carbon fiber, OEM (SF90XX variant, painted)',
          low: 49_999,
          high: 49_999,
        }),
        cite({
          item: 'Front frame complete (incl. bumper, fenders, hood structure)',
          low: 25_000,
          high: 25_000,
        }),
        cite({
          item: 'Novitec carbon fiber front bumper center part (aftermarket)',
          low: 2_988,
          high: 2_988,
          source: 'royalbodykits.com',
        }),
        cite({ item: 'Front fender RH, OEM', low: 4_999, high: 4_999 }),
        cite({
          item: 'Front fender RH, OEM',
          low: 4_999,
          high: 4_999,
          url: 'https://parts4usa.com/dup',
        }),
        cite({
          item: 'LaFerrari hybrid battery (comparison data)',
          low: 15_000,
          high: 15_000,
          line: 'electrical.hv',
        }),
      ],
      sf90,
    );
    const after = narrowed.plan.lines.find((l) => l.id === 'front.panels')!;
    // Only the one genuine fender survives, and it sits under the curated floor.
    expect(after.low).toBe(before.low);
    expect(after.expected).toBe(before.expected);
    expect(after.citations).toHaveLength(5);
    expect(narrowed.notes.filter((n) => /set aside/.test(n))).toHaveLength(4);
    expect(narrowed.notes.some((n) => /off-spec/.test(n))).toBe(true);
    expect(narrowed.notes.some((n) => /aftermarket/.test(n))).toBe(true);
    expect(narrowed.notes.some((n) => /structure part/.test(n))).toBe(true);
    expect(narrowed.notes.some((n) => /duplicate/.test(n))).toBe(true);
    const screened = screenPriceEvidence(
      [
        cite({
          item: 'LaFerrari hybrid battery (comparison data)',
          low: 15_000,
          high: 15_000,
          line: 'electrical.hv',
        }),
      ],
      'electrical.hv',
      sf90,
    );
    expect(screened.kept).toHaveLength(0);
    expect(screened.setAside[0].reason).toMatch(/comparison|not a price/);
  });

  test('a cited parts sum lifts a line to at most 1.5× its curated high, and says so', () => {
    const before = line(plan, 'front.panels')!;
    const narrowed = applyPriceEvidence(
      plan,
      [
        cite({ item: 'Front bumper cover, carbon, primed', low: 38_000, high: 38_000 }),
        cite({ item: 'Front hood, carbon', low: 30_000, high: 30_000 }),
        cite({ item: 'Front fenders, pair', low: 30_000, high: 30_000 }),
      ],
      sf90,
    );
    const after = narrowed.plan.lines.find((l) => l.id === 'front.panels')!;
    expect(after.expected).toBe(Math.round(before.high * 1.5));
    expect(after.basis).toMatch(/capped/);
    expect(narrowed.notes.some((n) => /capped/.test(n))).toBe(true);
  });
});

describe('research topics and what people miss', () => {
  test('the top lines by expected cost get a research topic tied to their line id', () => {
    const plan = deriveRepairPlan(
      triageOf([
        area({ area: 'front clip', kind: 'structural', severity: 'heavy' }),
        area({ area: 'electrical', kind: 'electrical', severity: 'moderate' }),
      ]),
      sf90,
      profileFor(sf90),
    );
    const topics = lineResearchTopics(plan, sf90);
    expect(topics.length).toBeLessThanOrEqual(3);
    expect(topics[0].lineId).toBe('front.structure');
    expect(topics.every((t) => /SF90/.test(t.topic))).toBe(true);
    expect(topics.every((t) => t.reason.length > 0)).toBe(true);
  });

  test('what people miss speaks to the damage, the platform, and the model', () => {
    const missed = whatPeopleMiss(
      triageOf([area({ area: 'front clip', kind: 'structural', severity: 'heavy' })]),
      sf90,
      profileFor(sf90),
    );
    expect(missed.some((m) => /e-axle/.test(m))).toBe(true);
    expect(missed.some((m) => /ADAS/.test(m))).toBe(true);
    expect(missed.some((m) => /Hybrid packs/.test(m))).toBe(true);
    const rear = whatPeopleMiss(
      triageOf([area({ area: 'rear clip', severity: 'moderate' })]),
      f458,
      profileFor(f458),
    );
    expect(rear.some((m) => /mid-engine/.test(m))).toBe(true);
  });
});
