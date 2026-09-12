import { describe, expect, test, vi } from 'vitest';
import { userFacingReason } from '@/lib/failure';
import { assessSalvageStream, priceLot, synthesizeSalvage } from './assess';
import { deriveRepairPlan } from './knowledge';
import type { SalvageEvidenceCaller } from './research';
import { getSalvageLot } from './seed-lots';
import { profileFor } from './tiers';
import type { Comp, DamageTriage, SalvageEvent, SalvageLot } from './types';

// The assessor mirrors the inspector's discipline: injected callers, offline
// orchestration, validation on every model boundary, visible degradation.

const RAW_TRIAGE_FRONT = {
  observations: [
    { photo: 0, note: 'front clip crushed back to the strut towers' },
    { photo: 1, note: 'both front airbag covers open' },
  ],
  overall: 'borderline',
  areas: [
    {
      area: 'front structure',
      kind: 'structural',
      severity: 'heavy',
      description: 'rails deformed behind the bumper beam',
      photos: [0],
    },
    {
      area: 'front clip',
      kind: 'cosmetic',
      severity: 'heavy',
      description: 'bumper, hood, both fenders, lamps destroyed',
      photos: [0, 1],
    },
  ],
  airbagsDeployed: 'yes',
  floodEvidence: false,
  fireEvidence: false,
  drivetrainRisk: 'engine sits behind the cabin; likely untouched',
  confidence: 0.7,
};

const RAW_TRIAGE_LIGHT = {
  observations: [{ photo: 0, note: 'key scratches down both doors' }],
  overall: 'rebuildable',
  areas: [
    {
      area: 'left side',
      kind: 'cosmetic',
      severity: 'light',
      description: 'deep key scratches, no dents',
      photos: [0],
    },
  ],
  airbagsDeployed: 'no',
  floodEvidence: false,
  fireEvidence: false,
  drivetrainRisk: 'no evidence of mechanical damage',
  confidence: 0.85,
};

const lot = () => getSalvageLot('sf90-front-il') as SalvageLot;
const artura = () => getSalvageLot('artura-vandalism-ca') as SalvageLot;
const huracan = () => getSalvageLot('huracan-front-mi') as SalvageLot;

const NOW = new Date('2026-08-17T00:00:00Z');

const comp = (over: Partial<Comp> & { price: number }): Comp => ({
  lane: 'clean',
  outcome: 'sold',
  year: 2021,
  date: '2026-04-01',
  title: 'clean',
  url: `https://bringatrailer.com/listing/${over.price}`,
  source: 'bringatrailer.com',
  ...over,
});

// The SF90 clean market as recorded 2026-08 (BaT sold results, MY2021–22).
const SF90_CLEAN: Comp[] = [363_000, 385_000, 391_000, 410_000, 416_500].map((price) =>
  comp({ price }),
);
const SF90_WRECK: Comp[] = [
  comp({
    price: 152_000,
    lane: 'wreck',
    outcome: 'sold',
    date: '2026-03-10',
    source: 'bidfax.info',
    url: 'https://en.bidfax.info/ferrari/1',
    damage: 'front end',
  }),
  comp({
    price: 226_000,
    lane: 'wreck',
    outcome: 'sold',
    date: '2026-03-12',
    source: 'bidfax.info',
    url: 'https://en.bidfax.info/ferrari/2',
    damage: 'rear end',
  }),
  comp({
    price: 193_000,
    lane: 'wreck',
    outcome: 'bid_no_sale',
    date: '2025-05-06',
    source: 'autoastat.com',
    url: 'https://autoastat.com/x',
  }),
];

// An evidence caller that answers every topic with a fixed payload.
function evidence(
  byLane: Partial<Record<'clean' | 'rebuilt' | 'wreck', Comp[]>>,
  prices: unknown[] = [],
): SalvageEvidenceCaller {
  return async ({ topics }) => ({
    results: topics.map((t) => ({
      id: t.id,
      payload:
        t.kind === 'comps'
          ? {
              // One answer per lane: the clean-ask worker reports nothing.
              comps: (t.id === 'comps.clean_asks' ? [] : (byLane[t.lane] ?? [])).map((c) => ({
                price: c.price,
                outcome: c.outcome,
                year: c.year,
                date: c.date,
                title: c.title,
                url: c.url,
                source_title: c.source,
                damage: c.damage,
              })),
              notes: [],
            }
          : { prices, notes: [] },
    })),
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    triageCaller: vi.fn().mockResolvedValue(RAW_TRIAGE_FRONT),
    evidenceCaller: null,
    sweepCaller: null,
    vpicFetcher: null,
    photoProbe: null,
    comps: null,
    vinHistory: null,
    now: () => NOW,
    ...overrides,
  };
}

async function collect(l: SalvageLot, d: ReturnType<typeof deps>): Promise<SalvageEvent[]> {
  const events: SalvageEvent[] = [];
  for await (const event of assessSalvageStream(l, d)) events.push(event);
  return events;
}

const reportOf = (events: SalvageEvent[]) => {
  const r = events.find((e) => e.type === 'report');
  if (r?.type !== 'report') throw new Error('no report');
  return r.report;
};

const triageOf = (raw: typeof RAW_TRIAGE_FRONT): DamageTriage => raw as unknown as DamageTriage;

describe('assessment stream', () => {
  test('a full run: begin events per stage, triage, plan, ledger, report last', async () => {
    const events = await collect(lot(), deps());
    const types = events.map((e) => e.type);
    expect(types.at(-1)).toBe('report');
    expect(types).not.toContain('fatal');
    for (const stage of ['triage', 'plan', 'research', 'vin', 'ledger', 'synthesis'] as const) {
      const beginAt = events.findIndex((e) => e.type === 'begin' && e.stage === stage);
      const statusAt = events.findIndex((e) => e.type === 'stage' && e.status.stage === stage);
      expect(beginAt, stage).toBeGreaterThanOrEqual(0);
      expect(beginAt).toBeLessThan(statusAt);
    }
  });

  test('the repair plan splits DIY from professional with stated reasons (SPEC 35)', async () => {
    const events = await collect(lot(), deps());
    const plan = events.find((e) => e.type === 'repair-plan');
    if (plan?.type !== 'repair-plan') throw new Error('no plan');
    const pro = plan.plan.lines.filter((t) => t.who === 'pro');
    const diy = plan.plan.lines.filter((t) => t.who === 'diy');
    expect(pro.length).toBeGreaterThan(0);
    expect(diy.length).toBeGreaterThan(0);
    for (const line of plan.plan.lines) expect(line.reason.length).toBeGreaterThan(10);
    // Heavy structural on an aluminum Ferrari must be pro, never DIY.
    expect(plan.plan.lines.find((t) => t.id === 'front.structure')?.who).toBe('pro');
    // SRS from deployed airbags shows up as its own pro line.
    expect(plan.plan.lines.find((t) => t.id === 'srs.system')?.who).toBe('pro');
    // One front hit: one front program, one structural line.
    expect(plan.plan.programs.filter((p) => p.id === 'front')).toHaveLength(1);
    expect(plan.plan.lines.filter((l) => /\.structure$/.test(l.id))).toHaveLength(1);
  });

  test('triage anchors are clamped to photos that exist (SPEC 21 discipline)', async () => {
    const bad = {
      ...RAW_TRIAGE_FRONT,
      areas: [{ ...RAW_TRIAGE_FRONT.areas[0], photos: [0, 99] }],
    };
    const events = await collect(lot(), deps({ triageCaller: vi.fn().mockResolvedValue(bad) }));
    const triage = events.find((e) => e.type === 'triage');
    if (triage?.type !== 'triage') throw new Error('no triage');
    expect(triage.triage.areas[0].photos).toEqual([0]);
  });

  test('a triage failure is fatal and visible; nothing is mocked', async () => {
    const events = await collect(
      lot(),
      deps({ triageCaller: vi.fn().mockRejectedValue(new Error('model down')) }),
    );
    expect(events.some((e) => e.type === 'fatal')).toBe(true);
    const status = events.find((e) => e.type === 'stage' && e.status.stage === 'triage');
    if (status?.type !== 'stage') throw new Error('no status');
    expect(status.status.ok).toBe(false);
  });

  test('typed comps set the exit and typed prices narrow the plan; the ledger solves a ceiling', async () => {
    const moderateSide = {
      ...RAW_TRIAGE_LIGHT,
      areas: [{ ...RAW_TRIAGE_LIGHT.areas[0], severity: 'moderate' }],
    };
    const events = await collect(
      lot(),
      deps({
        triageCaller: vi.fn().mockResolvedValue(moderateSide),
        evidenceCaller: evidence({ clean: SF90_CLEAN, wreck: SF90_WRECK }, [
          {
            item: 'door shell, left',
            kind: 'part_new',
            low: 9000,
            high: 9500,
            url: 'https://eurospares.co.uk/d',
            source_title: 'x',
          },
        ]),
      }),
    );
    const report = reportOf(events);
    const door = report.plan.lines.find((l) => l.id === 'side_left.panels')!;
    expect(door.evidence).toBe('cited');
    expect(door.low).toBeGreaterThanOrEqual(9000);
    expect(
      events.some((e) => e.type === 'thought' && /evidence narrows the plan/.test(e.text)),
    ).toBe(true);
    expect(report.evidence.comps.length).toBe(SF90_CLEAN.length + SF90_WRECK.length);
    expect(report.ledger?.exit?.lane).toBe('clean_sold_derived');
    expect(report.ledger?.exit?.n).toBe(5);
    expect(report.ledger?.wreck?.n).toBe(3);
    expect(report.ledger?.ceiling).toBeGreaterThan(0);
    expect(report.assessment.verdict).toBe('build');
    expect(report.assessment.summary).toMatch(/^Worth up to \$[\d,]+ in the room\. Bid to/);
    expect(report.assessment.summary).toMatch(/Wrecked SF90 Stradales hammer/);
    // Comps and prices ride the stream as their own events.
    expect(events.some((e) => e.type === 'comps')).toBe(true);
    expect(events.some((e) => e.type === 'prices')).toBe(true);
    // The research stage names what it found.
    const status = events.find((e) => e.type === 'stage' && e.status.stage === 'research');
    if (status?.type !== 'stage') throw new Error('no status');
    expect(status.status.detail).toMatch(/8 comp\(s\): 5 clean, 0 rebuilt, 3 wreck; 1 cited price/);
  });

  test('a heavy front hit on the SF90 at 2026 clean money is a zero ceiling that names its killers', async () => {
    const events = await collect(
      lot(),
      deps({ evidenceCaller: evidence({ clean: SF90_CLEAN, wreck: SF90_WRECK }) }),
    );
    const report = reportOf(events);
    const ledger = report.ledger!;
    expect(ledger.exit).not.toBeNull();
    // Front structure + parts + SRS + HV on a ~$200k exit: nothing clears.
    expect(ledger.ceiling).toBe(0);
    expect(report.assessment.verdict).toBe('walk');
    expect(report.assessment.summary).toMatch(/^Don't bid\. No bid at any price/);
    expect(report.assessment.summary).toMatch(/What ate it:/);
    expect(report.assessment.summary).toMatch(/It turns positive only if/);
    expect(ledger.killers[0].id).toBe('front.structure');
    expect(ledger.unlocks.some((u) => u.id === 'exit')).toBe(true);
    // The wreck market explains who wins these lots.
    expect(report.assessment.summary).toMatch(/structural edge/);
    const status = events.find((e) => e.type === 'stage' && e.status.stage === 'ledger');
    if (status?.type !== 'stage') throw new Error('no status');
    expect(status.status.detail).toMatch(/^ceiling \$0:/);
  });

  test('the non-repairable Huracán walks regardless of money, and says why (SPEC 36)', async () => {
    const events = await collect(
      huracan(),
      deps({
        triageCaller: vi.fn().mockResolvedValue(RAW_TRIAGE_LIGHT),
        evidenceCaller: evidence({
          clean: [comp({ price: 260_000 }), comp({ price: 270_000 }), comp({ price: 280_000 })],
        }),
      }),
    );
    const report = reportOf(events);
    expect(report.assessment.verdict).toBe('walk');
    expect(report.assessment.dealbreakers[0]).toMatch(/Non-repairable/);
    expect(report.assessment.summary).toMatch(
      /^Don't bid\. No bid: the title is registration-dead/,
    );
    expect(report.assessment.summary).not.toMatch(/Bid to/);
  });

  test('no evidence and no ACV: the cost side is itemized, the exit is honestly absent', async () => {
    const events = await collect(
      lot(),
      deps({ triageCaller: vi.fn().mockResolvedValue(RAW_TRIAGE_LIGHT) }),
    );
    const report = reportOf(events);
    expect(report.ledger?.exit).toBeNull();
    expect(report.ledger?.ceiling).toBeNull();
    expect(report.ledger?.costs.some((l) => l.group === 'repair')).toBe(true);
    expect(report.assessment.verdict).toBe('walk');
    expect(report.assessment.summary).toMatch(/no exit anchor survived research/);
    const research = events.find((e) => e.type === 'stage' && e.status.stage === 'research');
    if (research?.type !== 'stage') throw new Error('no status');
    expect(research.status.ok).toBe(false);
    expect(research.status.detail).toMatch(/disabled/);
  });

  test('a stated ACV anchors the exit when no comps survive, labeled as derived', async () => {
    const events = await collect(
      huracan(),
      deps({ triageCaller: vi.fn().mockResolvedValue(RAW_TRIAGE_LIGHT) }),
    );
    const report = reportOf(events);
    expect(report.ledger?.exit?.lane).toBe('acv_derived');
    expect(report.ledger?.exit?.basis).toMatch(/stated ACV/);
  });

  test('a carbon-tub Artura with heavy structural damage is a dealbreaker; a light one is not', async () => {
    const heavy = {
      ...RAW_TRIAGE_FRONT,
      areas: [{ ...RAW_TRIAGE_FRONT.areas[0], area: 'left side' }],
    };
    const events = await collect(
      artura(),
      deps({ triageCaller: vi.fn().mockResolvedValue(heavy) }),
    );
    expect(reportOf(events).assessment.dealbreakers.some((d) => /carbon tub/.test(d))).toBe(true);
    const light = await collect(
      artura(),
      deps({ triageCaller: vi.fn().mockResolvedValue(RAW_TRIAGE_LIGHT) }),
    );
    expect(reportOf(light).assessment.dealbreakers).toEqual([]);
  });

  test('a failing evidence caller degrades the research stage; live comps still carry what they found', async () => {
    const events = await collect(
      lot(),
      deps({
        evidenceCaller: async () => {
          throw new Error('workers down');
        },
        comps: async () => [
          comp({ price: 440_000, outcome: 'ask', source: 'ebay.com', url: 'https://ebay.com/1' }),
        ],
      }),
    );
    const research = events.find((e) => e.type === 'stage' && e.status.stage === 'research');
    if (research?.type !== 'stage') throw new Error('no status');
    expect(research.status.ok).toBe(true);
    expect(research.status.detail).toBe(
      `${userFacingReason('unknown')}; 1 live comp(s) carry the anchors`,
    );
    expect(research.status.detail).not.toContain('workers down');
    expect(reportOf(events).ledger?.exit?.lane).toBe('clean_ask_derived');
  });

  test('vin and sightings still land before the ledger, report still last', async () => {
    const events = await collect(
      lot(),
      deps({
        sweepCaller: async () => ({
          sightings: [{ url: 'https://history.example.com/y', title: 'seen before' }],
        }),
      }),
    );
    const types = events.map((e) => e.type);
    expect(types.indexOf('vin')).toBeGreaterThan(types.indexOf('triage'));
    expect(types.indexOf('vin')).toBeLessThan(types.indexOf('ledger'));
    expect(types.indexOf('sightings')).toBeLessThan(types.indexOf('ledger'));
    expect(types.at(-1)).toBe('report');
    const spans = events.flatMap((e) => (e.type === 'span' ? [e.span.name] : []));
    expect(spans).toContain('vin: provenance sweep');
  });
});

describe('photo pre-flight (salvage)', () => {
  test('a dead CDN link is dropped visibly and triage anchors remap', async () => {
    const l = lot();
    const deadUrl = l.photos[0];
    const triageCaller = vi.fn().mockResolvedValue(RAW_TRIAGE_FRONT);
    const events = await collect(
      l,
      deps({ triageCaller, photoProbe: vi.fn(async (url: string) => url !== deadUrl) }),
    );
    const triageInput = triageCaller.mock.calls[0][0] as { photos: unknown[] };
    expect(triageInput.photos).toHaveLength(Math.min(l.photos.length - 1, 12));
    expect(
      events.some(
        (e) => e.type === 'thought' && e.stage === 'triage' && e.text.includes('unreachable'),
      ),
    ).toBe(true);
    const photoEvent = events.find((e) => e.type === 'photo');
    if (photoEvent?.type !== 'photo') throw new Error('no photo event');
    expect(photoEvent.index).toBe(1);
    const triageEvent = events.find((e) => e.type === 'triage');
    if (triageEvent?.type !== 'triage') throw new Error('no triage event');
    expect(triageEvent.triage.areas[0].photos).toEqual([1]);
  });

  test('a fully delisted lot goes fatal with a plain-language message', async () => {
    const events = await collect(lot(), deps({ photoProbe: vi.fn(async () => false) }));
    const fatal = events.find((e) => e.type === 'fatal');
    if (fatal?.type !== 'fatal') throw new Error('expected fatal');
    expect(fatal.message).toMatch(/reachable/i);
  });
});

describe('triage variance damping', () => {
  test('duplicate zone entries merge to one area at the worst severity', async () => {
    const dupes = {
      ...RAW_TRIAGE_FRONT,
      areas: [
        { ...RAW_TRIAGE_FRONT.areas[1], severity: 'light' },
        { ...RAW_TRIAGE_FRONT.areas[1], severity: 'heavy', photos: [3] },
        RAW_TRIAGE_FRONT.areas[0],
      ],
    };
    const events = await collect(lot(), deps({ triageCaller: vi.fn().mockResolvedValue(dupes) }));
    const triage = events.find((e) => e.type === 'triage');
    if (triage?.type !== 'triage') throw new Error('no triage');
    expect(triage.triage.areas).toHaveLength(2);
    const clip = triage.triage.areas.find((a) => a.area === 'front clip');
    expect(clip?.severity).toBe('heavy');
    expect(clip?.photos).toEqual(expect.arrayContaining([0, 1, 3]));
  });

  test('paint is ONE respray program, and three front zones are ONE front program (SPEC 43)', async () => {
    const many = {
      ...RAW_TRIAGE_FRONT,
      areas: [
        { ...RAW_TRIAGE_FRONT.areas[0], area: 'front clip' },
        { ...RAW_TRIAGE_FRONT.areas[0], area: 'left front corner' },
        { ...RAW_TRIAGE_FRONT.areas[0], area: 'right front corner' },
        { ...RAW_TRIAGE_FRONT.areas[1], area: 'left side', severity: 'moderate' },
        { ...RAW_TRIAGE_FRONT.areas[1], area: 'rear clip', severity: 'light' },
      ],
    };
    const events = await collect(lot(), deps({ triageCaller: vi.fn().mockResolvedValue(many) }));
    const plan = events.find((e) => e.type === 'repair-plan');
    if (plan?.type !== 'repair-plan') throw new Error('no plan');
    expect(plan.plan.lines.filter((l) => l.program === 'paint')).toHaveLength(1);
    expect(plan.plan.programs.filter((p) => p.id === 'front')).toHaveLength(1);
    expect(plan.plan.lines.filter((l) => l.id === 'front.structure')).toHaveLength(1);
    expect(plan.plan.programs.find((p) => p.id === 'front')?.zones).toEqual([
      'front clip',
      'left front corner',
      'right front corner',
    ]);
  });
});

describe('synthesis and confidence', () => {
  const sf90 = lot();
  const profile = profileFor(sf90);
  const light = triageOf(RAW_TRIAGE_LIGHT as unknown as typeof RAW_TRIAGE_FRONT);

  test('the money summary states the ceiling, the exit, break-even, stress, and the wreck market', () => {
    const plan = deriveRepairPlan(light, sf90, profile);
    const { ledger } = priceLot(sf90, light, plan, [...SF90_CLEAN, ...SF90_WRECK], profile, NOW);
    const a = synthesizeSalvage(sf90, light, plan, ledger, [], [], undefined, 12, profile);
    expect(a.verdict).toBe('build');
    expect(a.summary).toContain(`Bid to $${ledger.ceiling!.toLocaleString('en-US')}.`);
    expect(a.summary).toContain(`Break-even is $${ledger.breakEven!.toLocaleString('en-US')}`);
    expect(a.summary).toMatch(/if every repair hits its high/);
    expect(a.summary).toMatch(/median \$193,000, 3 lots, 2 sold/);
    // Wreck median under the ceiling or above it, the sentence says which.
    expect(a.summary).toMatch(/above your ceiling|under your ceiling/);
    expect(a.watchItems.some((w) => /No rebuilt-title sale/.test(w))).toBe(true);
    expect(a.watchItems.some((w) => /Illinois lot/.test(w))).toBe(true);
    expect(a.watchItems.some((w) => /Bidding power/.test(w))).toBe(true);
  });

  test('corroborating evidence raises confidence; unknowns lower it; every factor is listed', () => {
    const plan = deriveRepairPlan(light, sf90, profile);
    const { ledger } = priceLot(sf90, light, plan, SF90_CLEAN, profile, NOW);
    const a = synthesizeSalvage(
      sf90,
      light,
      plan,
      ledger,
      [],
      [{ url: 'https://x', title: 'seen', source: 'x' }],
      undefined,
      12,
      profile,
    );
    const labels = a.confidenceFactors.map((f) => f.label);
    expect(labels).toContain('photo triage');
    expect(labels).toContain('clean sold comps');
    expect(labels).toContain('VIN history found');
    expect(a.confidence).toBeCloseTo(0.85 + 0.06 + 0.04, 2);
    const thin = priceLot(sf90, light, plan, [SF90_CLEAN[0]], profile, NOW).ledger;
    const b = synthesizeSalvage(
      { ...sf90, odometer: undefined },
      light,
      plan,
      thin,
      [],
      [],
      undefined,
      8,
      profile,
    );
    expect(b.confidenceFactors.map((f) => f.label)).toEqual(
      expect.arrayContaining(['thin comps', 'odometer unknown', 'only 8 photos']),
    );
    expect(b.confidence).toBeLessThan(a.confidence);
    expect(b.watchItems.some((w) => /Thin exit evidence/.test(w))).toBe(true);
  });

  test('a rebuild veto still reports the money would have supported a bid, when it would have', () => {
    const plan = deriveRepairPlan(light, huracan(), profileFor(huracan()));
    const { ledger } = priceLot(
      huracan(),
      light,
      plan,
      [comp({ price: 260_000 }), comp({ price: 270_000 }), comp({ price: 280_000 })],
      profileFor(huracan()),
      NOW,
    );
    const a = synthesizeSalvage(
      huracan(),
      light,
      plan,
      ledger,
      [],
      [],
      undefined,
      12,
      profileFor(huracan()),
    );
    expect(a.verdict).toBe('walk');
    expect(a.summary).toMatch(/the veto is not about money/);
  });
});
