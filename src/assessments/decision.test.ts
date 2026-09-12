/** Independently specified business outcomes, not implementation-derived expected answers. */
import { describe, expect, it } from 'vitest';
import { MARKET_PERSONA } from './buyer-profile';
import { USER_LOT_SOURCE } from './intake';
import { createAssessmentService } from './service';
import { MemoryAssessmentStore } from './store';
import { DISCIPLINE_SHARE, solveMaxBid } from '@/salvage/ceiling';
import { bidDependentFees } from '@/salvage/fees';
import { usd } from '@/lib/money';
import { getSalvageLot } from '@/salvage/seed-lots';
import { SHOP_RATE } from '@/salvage/tiers';
import type { CostLine } from '@/salvage/types';
import type { EvidenceInput } from './types';

const at = '2026-09-06T00:00:00.000Z';
function setup() {
  return createAssessmentService({
    store: new MemoryAssessmentStore(),
    now: () => new Date(at),
    investigator: async () => ({ evidence: [], detail: 'No network in decision cases' }),
  });
}
async function completeCase(
  options: {
    inspection?: boolean;
    reviewed?: boolean;
    budget?: number;
    tools?: boolean;
    title?: string;
    bid?: number;
    manualElectric?: boolean;
    hvNotApplicable?: boolean;
    comps?: number[];
    selfAttestedComps?: number;
    laborRatePerHour?: number;
    holdingDays?: number;
    minSurplus?: number;
    persona?: boolean;
  } = {},
) {
  const service = setup();
  const seed = getSalvageLot('sf90-front-il')!;
  let a = await service.createAssessment('buyer', {
    lot: {
      ...seed,
      titleBrand: 'unknown',
      currentBid: options.bid ?? 5000,
      ...(options.manualElectric
        ? { make: 'Tesla', model: 'Model 3', fuel: 'Unknown', engine: 'Unknown' }
        : {}),
    },
    // The market persona bids against itself when the case asks for it: the
    // profile whose edge is exactly zero (SPEC 60). The jurisdiction is the one
    // this fixture's registration record covers, so the eligibility gate is
    // met; it is not what makes the edge zero.
    buyer: options.persona
      ? { ...MARKET_PERSONA, jurisdiction: 'US-CA' }
      : {
          preset: 'custom',
          jurisdiction: 'US-CA',
          access: 'broker',
          exit: 'private_party',
          discipline: 0.75,
          capabilities: {
            tools: options.tools ?? true,
            workspace: true,
            lift: true,
            diagnostics: true,
            specialistAccess: true,
            structural: false,
            paint: false,
            alignment: false,
            hv: false,
          },
          laborRatePerHour: options.laborRatePerHour ?? 30,
          availableDiyHours: 1000,
          holdingDays: options.holdingDays ?? 60,
          holdingCostPerDay: 10,
          maxAllIn: options.budget ?? 200000,
          minSurplus: options.minSurplus ?? 20000,
        },
  });
  const subject = { vin: a.lot.vin, make: a.lot.make, model: a.lot.model, year: a.lot.year };
  const wrap = (payload: Omit<EvidenceInput, 'subject' | 'source'>, name: string): EvidenceInput =>
    ({
      ...payload,
      subject,
      source: {
        url: `https://example.com/synthetic/${name}`,
        label: 'SYNTHETIC independent decision case, not an actual inspection',
        capturedBy: 'synthetic_fixture',
        retrievedAt: at,
        observation: structuredClone(payload.value),
      },
    }) as EvidenceInput;
  const evidence: EvidenceInput[] = [
    wrap(
      {
        kind: 'triage',
        value: {
          overall: 'rebuildable',
          areas: [
            {
              area: 'front bumper',
              kind: 'cosmetic',
              severity: 'light',
              description: 'Surface damage limited to bumper in this synthetic case',
              photos: [0],
            },
          ],
          airbagsDeployed: 'no',
          floodEvidence: false,
          fireEvidence: false,
          drivetrainRisk: 'No visible evidence; physical inspection separately required',
          observations: [{ photo: 0, note: 'Bumper scuff' }],
          confidence: 0.9,
        },
      },
      'triage',
    ),
    wrap(
      {
        kind: 'identity',
        value: {
          vin: a.lot.vin,
          valid: true,
          decoded: {
            make: a.lot.make,
            model: a.lot.model,
            year: a.lot.year,
            wmi: a.lot.vin.slice(0, 3),
            serial: a.lot.vin.slice(-6),
          },
          mismatches: [],
          note: 'Synthetic model-level corroboration',
          links: [],
        },
      },
      'identity',
    ),
    wrap({ kind: 'title', value: { titleBrand: options.title ?? 'Salvage' } }, 'title'),
    wrap(
      {
        kind: 'registration',
        value: {
          jurisdiction: 'US-CA',
          eligible: true,
          requirements: ['Complete jurisdiction inspection and retained receipts before road use'],
        },
      },
      'registration',
    ),
    ...(options.comps ?? [300000, 310000, 320000]).map((price, i) => {
      const url = `https://example.com/synthetic/comp-${i}`;
      // A self-attested comp is typed by the owner, so it must name the actual
      // vehicle it compares against and carries no captured observation.
      const typed = i < (options.selfAttestedComps ?? 0);
      const record = wrap(
        {
          kind: 'comp',
          value: {
            lane: 'rebuilt',
            outcome: 'sold',
            title: 'rebuilt',
            price,
            year: a.lot.year,
            date: '2026-09-01',
            url,
            source: 'example.com',
            ...(typed
              ? { vehicle: { make: a.lot.make, model: a.lot.model, year: a.lot.year } }
              : {}),
          },
        },
        `comp-${i}`,
      );
      if (typed) record.source.capturedBy = 'user';
      return record;
    }),
  ];
  if (options.inspection !== false)
    evidence.push(
      wrap(
        {
          kind: 'inspection',
          value: {
            inspector: 'Synthetic qualified specialist',
            inspectedAt: at,
            method: 'physical',
            repairScopeConfirmed: true,
            systems: ['structure', 'srs', 'powertrain', 'hv', 'water_fire'].map((system) => ({
              system: system as 'structure',
              status: system === 'hv' && options.hvNotApplicable ? 'not_applicable' : 'clear',
              finding: 'Explicitly examined and clear in synthetic scenario',
            })),
          },
        },
        'inspection',
      ),
    );
  a = await service.recordEvidence('buyer', a.id, {
    evidence,
    expectedRevision: a.revision,
    idempotencyKey: 'records',
  });
  if (options.reviewed !== false)
    a = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: a.evidence.map((e) => e.id),
      rationale:
        'Reviewed synthetic records against this vehicle; provenance explicitly synthetic for testing',
      expectedRevision: a.revision,
      idempotencyKey: 'review',
    });
  if (options.reviewed !== false && a.decision.report) {
    const quotes = a.decision.report.plan.lines
      .filter((l) => l.who === 'pro')
      .map((line) => {
        const name = `quote-${line.id}`;
        const url = `https://example.com/synthetic/${name}`;
        return wrap(
          {
            kind: 'repair_price',
            value: {
              line: line.id,
              item: `Whole job: ${line.task}`,
              kind: 'job_quote',
              low: 5000,
              high: 10000,
              url,
              source: 'example.com',
            },
          },
          name,
        );
      });
    if (quotes.length) {
      a = await service.recordEvidence('buyer', a.id, {
        evidence: quotes,
        expectedRevision: a.revision,
        idempotencyKey: 'quotes',
      });
      a = await service.reviewEvidence('buyer', a.id, {
        evidenceIds: a.evidence.filter((e) => e.kind === 'repair_price').map((e) => e.id),
        rationale: 'Reviewed synthetic specialist quotes against every professional repair program',
        expectedRevision: a.revision,
        idempotencyKey: 'review-quotes',
      });
    }
  }
  return { service, a, wrap };
}

describe('complete enthusiast acquisition decision', () => {
  it('cannot waive HV review for a manually entered electric vehicle with unknown powertrain metadata', async () => {
    const { a } = await completeCase({ manualElectric: true, hvNotApplicable: true });
    expect(a.decision.gates?.find((gate) => gate.id === 'inspection')?.status).toBe('missing');
    expect(a.decision.readiness).toBe('needs_evidence');
    expect(a.decision.ceiling).toBeNull();
  });
  it('makes the reviewed, affordable, inspected positive path reachable without erasing residual risks', async () => {
    // The room's price setter has no cash arm (SPEC 60), so the positive path
    // states a cash limit that does not bind: a limit below the room's price is
    // itself a reason this bidder cannot win the lot at their own ceiling.
    const { a } = await completeCase({ budget: 400_000 });
    expect(a.decision.readiness).toBe('ready');
    expect(a.decision.verdict).toBe('build');
    expect(a.decision.ceiling).toBeGreaterThan(5000);
    expect(a.decision.residualRisks?.length).toBeGreaterThan(0);
    expect(a.decision.buyerEconomics?.laborOpportunityCost).toBeGreaterThan(0);
    expect(a.decision.lineage?.some((n) => n.kind === 'repair_hypothesis')).toBe(true);
  });
  it('does not turn supplied documents or photo inference into a physical inspection', async () => {
    const { a: unreviewed } = await completeCase({ reviewed: false });
    expect(unreviewed.decision.ceiling).toBeNull();
    const { a: missing } = await completeCase({ inspection: false });
    expect(missing.decision.readiness).toBe('needs_evidence');
    expect(missing.decision.gates?.find((g) => g.id === 'inspection')?.status).toBe('missing');
  });
  it("no buyer profile can raise the ceiling above the kernel's for the same fee mode and exit channel", async () => {
    // This case keeps the kernel's own fee mode and exit channel — a broker
    // seat selling privately — and empties every buyer cost: no labor, no
    // holding, no required surplus and cash that never binds. Over those same
    // lines the buyer's arithmetic can only reach the kernel's own disciplined
    // ceiling, never pass it. A bidder who genuinely pays fewer charges — a
    // direct licensed account, a car that is never sold — clears more, and
    // that is the ledger selecting lines rather than loosening the target
    // (SPEC 58).
    const { a } = await completeCase({
      budget: 100_000_000,
      laborRatePerHour: 0,
      holdingDays: 0,
      minSurplus: 0,
    });
    // A ledger that solved nothing reads as 0 here and fails the first
    // assertion rather than making the comparison vacuous.
    const kernel = a.decision.report?.ledger?.ceiling ?? 0;
    expect(kernel).toBeGreaterThan(0);
    expect(a.decision.ceiling).toBeGreaterThan(0);
    expect(a.decision.ceiling!).toBeLessThanOrEqual(kernel);
    expect(a.decision.buyerEconomics!.maxBid).toBeLessThanOrEqual(kernel);
    // A profile that costs something can only lower it further.
    const { a: costly } = await completeCase();
    expect(costly.decision.ceiling!).toBeLessThanOrEqual(a.decision.ceiling!);
  });
  it('states why no bid clears when the required surplus exceeds the low exit', async () => {
    // The surplus arm drives the target below zero: no share of the exit is
    // retained, and the sentence says so instead of printing an impossible
    // margin (SPEC 58).
    const { a } = await completeCase({ minSurplus: 1_000_000 });
    const economics = a.decision.buyerEconomics!;
    expect(economics.discipline.share).toBe(0);
    expect(economics.maxBid).toBe(0);
    expect(a.decision.readiness).toBe('ready');
    expect(a.decision.verdict).toBe('walk');
    expect(a.decision.reasons).toContain(
      `DIY time and holding cost are included; your required surplus of ${usd(1_000_000)} exceeds the low exit of ${usd(economics.exit.low)}, so no bid clears it`,
    );
    expect(a.decision.reasons.some((reason) => /\d{3,}%/.test(reason))).toBe(false);
  });
  it('walks for unaffordable or above-ceiling acquisitions and retains reviewed economics', async () => {
    const { a } = await completeCase({ budget: 1000 });
    expect(a.decision.verdict).toBe('walk');
    expect(a.decision.ceiling).toBe(0);
    const { a: expensive } = await completeCase({ bid: 500000 });
    expect(expensive.decision.verdict).toBe('walk');
  });
  it('a reviewed quote on a DIY line converts it to professional and drops its hours', async () => {
    const { service, a, wrap } = await completeCase();
    const diy = a.decision.report!.plan.lines.find((l) => l.who === 'diy')!;
    expect(diy.diyHours).toBeGreaterThan(0);
    const name = `quote-${diy.id}`;
    const quoted = await service.recordEvidence('buyer', a.id, {
      evidence: [
        wrap(
          {
            kind: 'repair_price',
            value: {
              line: diy.id,
              item: `Whole job: ${diy.task}`,
              kind: 'job_quote',
              low: 5000,
              high: 10000,
              url: `https://example.com/synthetic/${name}`,
              source: 'example.com',
            },
          },
          name,
        ),
      ],
      expectedRevision: a.revision,
      idempotencyKey: 'diy-quote',
    });
    const b = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [quoted.evidence.at(-1)!.id],
      rationale: 'Reviewed a specialist whole-job quote for work the buyer had planned to do',
      expectedRevision: quoted.revision,
      idempotencyKey: 'review-diy-quote',
    });
    const line = b.decision.report!.plan.lines.find((l) => l.id === diy.id)!;
    expect(line.who).toBe('pro');
    expect(Object.hasOwn(line, 'diyHours')).toBe(false);
    expect(b.decision.report!.plan.diyHoursTotal).toBe(
      a.decision.report!.plan.diyHoursTotal - diy.diyHours!,
    );
    expect(b.decision.buyerEconomics!.laborOpportunityCost).toBe(
      a.decision.buyerEconomics!.laborOpportunityCost - diy.diyHours! * a.buyer!.laborRatePerHour,
    );
    // `pro` is what the same task costs bought from a shop, so a converted or
    // re-priced line restates it: the buyer layer prices its capability gates
    // from this number (`src/salvage/types.ts`).
    const plan = b.decision.report!.plan;
    for (const l of plan.lines)
      expect(l.pro, l.id).toEqual(
        l.who === 'pro'
          ? { low: l.low, expected: l.expected, high: l.high }
          : {
              low: l.low + l.diyHours! * SHOP_RATE[plan.tier],
              expected: l.expected + l.diyHours! * SHOP_RATE[plan.tier],
              high: l.high + l.diyHours! * SHOP_RATE[plan.tier],
            },
      );
  });
  it('an unreviewed shop quote on a DIY line does not raise the line or the ceiling', async () => {
    const { a, wrap } = await completeCase();
    const diy = a.decision.report!.plan.lines.find((l) => l.who === 'diy')!;
    const name = `shop-quote-${diy.id}`;
    const quote = wrap(
      {
        kind: 'repair_price',
        value: {
          line: diy.id,
          item: `Whole job: ${diy.task}`,
          kind: 'job_quote',
          low: diy.high * 3,
          high: diy.high * 5,
          url: `https://example.com/synthetic/${name}`,
          source: 'example.com',
        },
      },
      name,
    );
    // A captured quote is accepted without owner review; hiring the shop is still the owner's decision.
    const store = new MemoryAssessmentStore();
    await store.create(a);
    const service = createAssessmentService({
      store,
      now: () => new Date(at),
      investigator: async () => ({ evidence: [quote], detail: 'Synthetic captured shop quote' }),
    });
    const refreshed = await service.refreshAssessment('buyer', a.id, a.revision, 'shop-quote', {
      actionKinds: ['repair_evidence'],
    });
    const b = await service.investigateAssessment(
      'buyer',
      a.id,
      refreshed.offeredActions.find((x) => x.lineId === diy.id)!.id,
      refreshed.revision,
    );
    expect(b.evidence.at(-1)!.status).toBe('accepted');
    expect(b.evidence.at(-1)!.review).toBeUndefined();
    const line = b.decision.report!.plan.lines.find((l) => l.id === diy.id)!;
    expect([line.low, line.expected, line.high]).toEqual([diy.low, diy.expected, diy.high]);
    expect(line.who).toBe('diy');
    expect(b.decision.ceiling).toBe(a.decision.ceiling);
    expect(b.decision.residualRisks).toContain(
      `A shop quote exists for DIY work (${diy.task}); review it to price that work professionally`,
    );
  });
  it('a DIY shop quote whose review scope is stale is deferred, not priced', async () => {
    const { service, a, wrap } = await completeCase();
    const diy = a.decision.report!.plan.lines.find((l) => l.who === 'diy')!;
    const name = `stale-quote-${diy.id}`;
    const quoted = await service.recordEvidence('buyer', a.id, {
      evidence: [
        wrap(
          {
            kind: 'repair_price',
            value: {
              line: diy.id,
              item: `Whole job: ${diy.task}`,
              kind: 'job_quote',
              low: diy.high * 3,
              high: diy.high * 5,
              url: `https://example.com/synthetic/${name}`,
              source: 'example.com',
            },
          },
          name,
        ),
      ],
      expectedRevision: a.revision,
      idempotencyKey: 'stale-diy-quote',
    });
    const reviewed = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [quoted.evidence.at(-1)!.id],
      rationale: 'Reviewed the shop quote against the damage scope known at the time',
      expectedRevision: quoted.revision,
      idempotencyKey: 'review-stale-quote',
    });
    expect(reviewed.decision.report!.plan.lines.find((l) => l.id === diy.id)!.who).toBe('pro');
    // Newer triage evidence restates the damage, so the earlier quote review predates this scope.
    const rescoped = await service.recordEvidence('buyer', a.id, {
      evidence: [
        wrap(
          {
            kind: 'triage',
            value: {
              overall: 'rebuildable',
              areas: [
                {
                  area: 'front bumper',
                  kind: 'cosmetic',
                  severity: 'light',
                  description: 'Second synthetic look: same bumper, differently described damage',
                  photos: [0],
                },
              ],
              airbagsDeployed: 'no',
              floodEvidence: false,
              fireEvidence: false,
              drivetrainRisk: 'No visible evidence; physical inspection separately required',
              observations: [{ photo: 0, note: 'Bumper scuff' }],
              confidence: 0.9,
            },
          },
          'triage-rescope',
        ),
      ],
      expectedRevision: reviewed.revision,
      idempotencyKey: 'rescope',
    });
    const b = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [rescoped.evidence.at(-1)!.id],
      rationale: 'Reviewed the newer damage triage for this vehicle',
      expectedRevision: rescoped.revision,
      idempotencyKey: 'review-rescope',
    });
    const line = b.decision.report!.plan.lines.find((l) => l.id === diy.id)!;
    expect(line.who).toBe('diy');
    expect([line.low, line.expected, line.high]).toEqual([diy.low, diy.expected, diy.high]);
    expect(b.decision.residualRisks).toContain(
      `A shop quote exists for DIY work (${diy.task}); review it to price that work professionally; the earlier review predates the current damage scope`,
    );
  });
  it('three reviewed self-attested comps do not satisfy the market gate', async () => {
    const { a } = await completeCase({ selfAttestedComps: 3 });
    expect(a.evidence.filter((e) => e.kind === 'comp').every((e) => Boolean(e.review))).toBe(true);
    expect(a.decision.gates?.find((g) => g.id === 'market')?.status).toBe('missing');
    expect(a.decision.readiness).toBe('needs_evidence');
    expect(a.decision.ceiling).toBeNull();
    expect(a.decision.residualRisks).toContain(
      '3 accepted numbers are self-attested by the owner and were not independently captured',
    );
  });
  it('labels a self-attested claim as self-attested in the decision lineage', async () => {
    const { service, a, wrap } = await completeCase();
    const name = 'owner-typed-comp';
    const url = `https://example.com/synthetic/${name}`;
    const typed = wrap(
      {
        kind: 'comp',
        value: {
          lane: 'rebuilt',
          outcome: 'sold',
          title: 'rebuilt',
          price: 305000,
          year: a.lot.year,
          vehicle: { make: a.lot.make, model: a.lot.model, year: a.lot.year },
          date: '2026-09-01',
          url,
          source: 'example.com',
        },
      },
      name,
    );
    typed.source.capturedBy = 'user';
    typed.source.basis = 'source_observation';
    const recorded = await service.recordEvidence('buyer', a.id, {
      evidence: [typed],
      expectedRevision: a.revision,
      idempotencyKey: 'owner-typed-comp',
    });
    const stored = recorded.evidence.at(-1)!;
    expect(stored.source.basis).toBeUndefined();
    const b = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [stored.id],
      rationale: 'Owner attests to a sale price they typed from a listing they read',
      expectedRevision: recorded.revision,
      idempotencyKey: 'review-owner-typed-comp',
    });
    const claim = b.decision.lineage!.find(
      (node) => node.kind === 'claim' && node.evidenceIds.includes(stored.id),
    )!;
    expect(claim.summary).toBe('comp: self-attested · owner reviewed');
  });
  it('counts a self-attested comparable the exit used from the fallback pool', async () => {
    const { service, a, wrap } = await completeCase({ comps: [300000, 310000] });
    const name = 'owner-unqualified-comp';
    const url = `https://example.com/synthetic/${name}`;
    const typed = wrap(
      {
        kind: 'comp',
        value: {
          lane: 'rebuilt',
          outcome: 'sold',
          // An undeclared title keeps this comparable out of the qualified pool
          // while the shallow pool still hands it to the exit.
          title: 'unknown',
          price: 320000,
          year: a.lot.year,
          vehicle: { make: a.lot.make, model: a.lot.model, year: a.lot.year },
          date: '2026-09-01',
          url,
          source: 'example.com',
        },
      },
      name,
    );
    typed.source.capturedBy = 'user';
    const recorded = await service.recordEvidence('buyer', a.id, {
      evidence: [typed],
      expectedRevision: a.revision,
      idempotencyKey: 'owner-unqualified-comp',
    });
    const b = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [recorded.evidence.at(-1)!.id],
      rationale: 'Owner attests to a sale price they typed without a title record',
      expectedRevision: recorded.revision,
      idempotencyKey: 'review-owner-unqualified-comp',
    });
    expect(b.decision.report!.ledger!.exit!.comps.some((c) => c.used && c.comp.url === url)).toBe(
      true,
    );
    expect(b.decision.gates?.find((g) => g.id === 'market')?.status).toBe('missing');
    expect(b.decision.residualRisks).toContain(
      '1 accepted number is self-attested by the owner and was not independently captured',
    );
  });
  it('two captured comps plus one reviewed self-attested comp satisfy the market gate', async () => {
    const { a } = await completeCase({ selfAttestedComps: 1 });
    expect(a.decision.gates?.find((g) => g.id === 'market')?.status).toBe('met');
    expect(a.decision.readiness).toBe('ready');
    expect(a.decision.residualRisks).toContain(
      '1 accepted number is self-attested by the owner and was not independently captured',
    );
  });
  it('a cash-bound ceiling below the room’s price is a walk that names both numbers', async () => {
    // The same evidence, two ceilings: this buyer's $200,000 limit is what
    // stops their bid, and the marginal professional rebuilder — who has no
    // cash arm — clears a higher one, so the lot can only be won above this
    // buyer's ceiling (SPEC 60).
    const { a } = await completeCase();
    const economics = a.decision.buyerEconomics!;
    expect(a.decision.readiness).toBe('ready');
    expect(economics.maxBid).toBeGreaterThan(0);
    // The cash limit is the binding constraint, not the disciplined target:
    // the all-in at the ceiling stops within $1,000 of the stated limit, which
    // is the rounding the bid step leaves.
    expect(economics.maxAllIn - economics.cashAtCeiling).toBeLessThan(1_000);
    // The ledger names the arm that produced the ceiling, so the sentence
    // quoting it credits the cash limit rather than a margin the limit left
    // intact underneath (SPEC 58).
    expect(economics.discipline.bound).toBe('cash');
    expect(a.decision.reasons).toContain(
      `DIY time and holding cost are included; your cash limit of ${usd(economics.maxAllIn)} set the ceiling; the ${Math.round((1 - economics.discipline.share) * 100)}% low-exit margin is retained beneath it`,
    );
    expect(economics.market.maxBid!).toBeGreaterThan(economics.maxBid);
    expect(economics.edge).toBe(economics.maxBid - economics.market.maxBid!);
    expect(a.decision.verdict).toBe('walk');
    expect(a.decision.reasons[0]).toBe(
      `No edge on this lot: a professional rebuilder can pay ${usd(economics.market.maxBid!)} and you can pay ${usd(economics.maxBid)}; bidding above your ceiling to win is the winner's curse.`,
    );
    // A ceiling the buyer's own constraints support is never also stated as one
    // they support: the walk is the whole answer.
    expect(a.decision.reasons).not.toContain(
      'Reviewed evidence and buyer constraints support a conditional bid within the ceiling',
    );
    // The market ceiling is the persona's own solve over the same plan, so it
    // carries its own lines and its basis names whose ceiling it is.
    expect(economics.market.lines.length).toBeGreaterThan(0);
    expect(economics.market.basis).toContain('professional rebuilder');
    // An equal ceiling is not a walk: a buyer whose inputs are the persona's
    // prices against itself, and the persona registers the car where the buyer
    // does, so the title process cannot open a gap between them (SPEC 60).
    const persona = await completeCase({ persona: true });
    expect(persona.a.decision.buyerEconomics!.edge).toBe(0);
    expect(persona.a.decision.verdict).toBe('build');
  });

  it('a dealbreaker still beats the edge (SPEC 45)', async () => {
    // A veto answers before any money does, so a no-edge lot with a
    // non-repairable title reads as the title refusal, not as the edge.
    const { a } = await completeCase({ title: 'Certificate of destruction' });
    expect(a.decision.readiness).toBe('vetoed');
    expect(a.decision.verdict).toBe('walk');
    expect(a.decision.reasons[0]).toContain('vetoes a roadgoing rebuild');
  });

  it('the best-case bound prices selling costs at the high exit', async () => {
    // A wide sold spread separates the low and high exits; cash does not bind here.
    const { a } = await completeCase({ budget: 1000000, comps: [210000, 310000, 410000] });
    const ledger = a.decision.report!.ledger!;
    const buyer = a.buyer!;
    const optimistic = (l: CostLine) =>
      l.group === 'repair' ? l.low : l.group === 'contingency' ? 0 : l.expected;
    // The same optimistic solve with selling costs left at the low exit: the looser bound.
    const atLowExit = solveMaxBid(
      Math.min(ledger.exit!.high * DISCIPLINE_SHARE, ledger.exit!.high - buyer.minSurplus),
      ledger.costs.filter((c) => !c.bidDependent).reduce((s, c) => s + optimistic(c), 0) +
        a.decision.report!.plan.diyHoursTotal * buyer.laborRatePerHour +
        buyer.holdingDays * buyer.holdingCostPerDay,
    );
    expect(ledger.exit!.high - ledger.exit!.low).toBeGreaterThan(50000);
    // The gap is the selling share of that exit spread, not a rounding step.
    expect(atLowExit - a.decision.buyerEconomics!.bestCaseMaxBid).toBeGreaterThan(2000);
  });
  it('cash affordability excludes selling costs', async () => {
    const { a } = await completeCase();
    const economics = a.decision.buyerEconomics!;
    const buyer = a.buyer!;
    // The buyer's own lines, not the kernel's: this jurisdiction's title
    // process and this fee mode price what the cash arm sums (SPEC 59).
    const selling = economics.lines.find((c) => c.group === 'selling')!;
    const fixed = economics.lines
      .filter((c) => !c.bidDependent && c.group !== 'labor' && c.group !== 'holding')
      .reduce((s, c) => s + c.expected, 0);
    // The cash arm as it stands when selling costs are charged at acquisition.
    const cashWithSelling = solveMaxBid(buyer.maxAllIn, fixed + economics.holdingCost);
    expect(economics.maxBid).toBeGreaterThan(cashWithSelling);
    expect(economics.cashAtCeiling).toBeLessThanOrEqual(buyer.maxAllIn);
    expect(economics.cashAtCeiling).toBe(
      Math.round(
        economics.maxBid +
          bidDependentFees(economics.maxBid) +
          fixed -
          selling.expected +
          economics.holdingCost,
      ),
    );
    expect(economics.totalEconomicCostAtCeiling - economics.cashAtCeiling).toBe(
      economics.laborOpportunityCost + selling.expected,
    );
  });
  it('cannot assume that an unequipped buyer can execute a DIY plan', async () => {
    const { a } = await completeCase({ tools: false });
    expect(a.decision.readiness).toBe('needs_evidence');
    expect(a.decision.gates?.find((g) => g.id === 'capability')?.status).toBe('missing');
  });
  it('states that a lot the owner typed was never captured from the auction page', async () => {
    const service = setup();
    const seed = getSalvageLot('sf90-front-il')!;
    const brought = await service.createAssessment('buyer', {
      lot: { ...seed, id: 'lot_typed', source: USER_LOT_SOURCE, url: undefined },
    });
    expect(brought.decision.residualRisks).toContain(
      'Listing details were typed or pasted by the owner and not captured from the auction page',
    );
    // The catalog lot's own data was collected from the listing, so it carries
    // no such risk.
    const recorded = await service.createAssessment('buyer', { seedLotId: seed.id });
    expect(recorded.decision.residualRisks).not.toContain(
      'Listing details were typed or pasted by the owner and not captured from the auction page',
    );
  });
  it('a nonrepairable title veto dominates attractive economics', async () => {
    const { a } = await completeCase({ title: 'Non-repairable' });
    expect(a.decision.readiness).toBe('vetoed');
    expect(a.decision.verdict).toBe('walk');
    expect(a.decision.ceiling).toBe(0);
  });
  it('audits an owner review and refuses cross-owner and stale-revision review', async () => {
    const { service, a } = await completeCase();
    expect(a.evidence.every((e) => e.review?.ownerId === 'buyer')).toBe(true);
    await expect(
      service.reviewEvidence('other', a.id, {
        evidenceIds: [a.evidence[0].id],
        rationale: 'Wrong owner',
        expectedRevision: a.revision,
        idempotencyKey: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      service.reviewEvidence('buyer', a.id, {
        evidenceIds: [a.evidence[0].id],
        rationale: 'Stale revision',
        expectedRevision: 1,
        idempotencyKey: 'stale',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('recomputes buyer changes and requires eligibility for the newly selected jurisdiction', async () => {
    const { service, a } = await completeCase();
    const b = await service.updateBuyer('buyer', a.id, {
      buyer: { ...a.buyer!, jurisdiction: 'US-NY' },
      expectedRevision: a.revision,
      idempotencyKey: 'move',
    });
    expect(b.decision.ceiling).toBeNull();
    expect(b.decision.gates?.find((g) => g.id === 'registration')?.status).toBe('missing');
  });
  it('refuses owner promotion of wrong-vehicle, stale, invalid identity or model-only inspection evidence', async () => {
    for (const mutation of ['subject', 'stale', 'vin', 'model'] as const) {
      const { service, a, wrap } = await completeCase();
      const e = wrap(
        {
          kind: 'identity',
          value: {
            vin: a.lot.vin,
            valid: true,
            decoded: {
              make: a.lot.make,
              model: a.lot.model,
              year: a.lot.year,
              wmi: a.lot.vin.slice(0, 3),
              serial: a.lot.vin.slice(-6),
            },
            mismatches: [],
            note: 'Invalid attempt',
            links: [],
          },
        },
        `bad-${mutation}`,
      );
      if (mutation === 'subject') e.subject.make = 'Other';
      if (mutation === 'stale') e.source.retrievedAt = '2027-01-01T00:00:00Z';
      if (mutation === 'vin' && e.kind === 'identity') {
        e.value.valid = false;
        e.source.observation = { ...e.value };
      }
      if (mutation === 'model') e.source.basis = 'model_inference';
      const b = await service.recordEvidence('buyer', a.id, {
        evidence: [e],
        expectedRevision: a.revision,
        idempotencyKey: `record-${mutation}`,
      });
      await expect(
        service.reviewEvidence('buyer', a.id, {
          evidenceIds: [b.evidence.at(-1)!.id],
          rationale: 'Attempted unsupported override',
          expectedRevision: b.revision,
          idempotencyKey: `review-${mutation}`,
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
  });
});

it('expiry on a plain read retracts a ready ceiling, without an explicit refresh', async () => {
  const { a } = await completeCase();
  const store = new MemoryAssessmentStore();
  await store.create(a);
  const service = createAssessmentService({ store, now: () => new Date('2026-10-20T00:00:00Z') });
  const expired = (await service.getAssessment('buyer', a.id))!;
  expect(expired.decision.readiness).toBe('needs_evidence');
  expect(expired.decision.ceiling).toBeNull();
  expect(expired.revision).toBeGreaterThan(a.revision);
  expect((await service.getAssessment('buyer', a.id))!.revision).toBe(expired.revision);
  expect(expired.history.some((d) => d.readiness === 'ready')).toBe(true);
});
it('a material repair change reopens prior inspection and quote scope', async () => {
  const { service, a, wrap } = await completeCase();
  const initial = a.evidence.find((e) => e.kind === 'triage')!;
  if (initial.kind !== 'triage') throw new Error('missing triage');
  const change = wrap(
    {
      kind: 'triage',
      value: {
        ...initial.value,
        areas: [
          {
            ...initial.value.areas[0],
            severity: 'moderate',
            description: 'Newly found deeper bumper impact',
          },
        ],
      },
    },
    'changed-scope',
  );
  let b = await service.recordEvidence('buyer', a.id, {
    evidence: [change],
    expectedRevision: a.revision,
    idempotencyKey: 'scope-change',
  });
  b = await service.reviewEvidence('buyer', a.id, {
    evidenceIds: [b.evidence.at(-1)!.id],
    rationale: 'Reviewed newly discovered damage',
    expectedRevision: b.revision,
    idempotencyKey: 'scope-review',
  });
  expect(b.decision.gates?.find((g) => g.id === 'inspection')?.status).toBe('missing');
  expect(b.decision.gates?.find((g) => g.id === 'repair_quotes')?.status).toBe('missing');
  expect(b.decision.ceiling).toBeNull();
});
it('a refreshed ready case waits for new evidence and preserves the lifetime budget', async () => {
  const { service, a } = await completeCase();
  const b = await service.refreshAssessment('buyer', a.id, a.revision, 'new-market');
  expect(b.decision.ceiling).toBeNull();
  expect(b.refreshPending).toEqual(['market_comps']);
  expect(b.offeredActions.map((x) => x.kind)).toEqual(['market_comps']);
  expect(b.budget).toEqual(a.budget);
  const stopped = await service.stopAssessment('buyer', a.id, 'Owner stopped', b.revision);
  await expect(
    service.refreshAssessment('buyer', a.id, stopped.revision, 'watch-race', {
      actionKinds: ['market_comps'],
      allowOwnerStopped: false,
    }),
  ).rejects.toMatchObject({ code: 'conflict' });
});
it('independent negative inspection and jurisdiction sources cannot be erased by later positives', async () => {
  for (const kind of ['inspection', 'registration'] as const) {
    const { service, a, wrap } = await completeCase();
    const bad =
      kind === 'registration'
        ? wrap(
            {
              kind,
              value: {
                jurisdiction: 'US-CA',
                eligible: false,
                requirements: ['This title cannot be converted in this synthetic scenario'],
              },
            },
            'negative-registration',
          )
        : wrap(
            {
              kind,
              value: {
                inspector: 'Other synthetic specialist',
                inspectedAt: at,
                method: 'physical',
                repairScopeConfirmed: true,
                systems: [
                  {
                    system: 'structure',
                    status: 'unsafe',
                    finding: 'Synthetic unrepairable structural condition',
                  },
                ],
              },
            },
            'negative-inspection',
          );
    let b = await service.recordEvidence('buyer', a.id, {
      evidence: [bad],
      expectedRevision: a.revision,
      idempotencyKey: 'negative',
    });
    expect(b.decision.ceiling).toBeNull();
    b = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [b.evidence.at(-1)!.id],
      rationale: 'Reviewed independent contrary observation',
      expectedRevision: b.revision,
      idempotencyKey: 'review-negative',
    });
    const positive = a.evidence.find((e) => e.kind === kind)!;
    b = await service.reviewEvidence('buyer', a.id, {
      evidenceIds: [positive.id],
      rationale: 'Re-reviewed earlier positive source',
      expectedRevision: b.revision,
      idempotencyKey: 'review-positive',
    });
    expect(b.decision.verdict).toBe('walk');
    expect(b.decision.readiness).toBe('vetoed');
  }
});
it('records outcome forecasts as-of the observed event and rejects future leakage', async () => {
  const { service, a } = await completeCase();
  const b = await service.recordOutcome('buyer', a.id, {
    kind: 'purchased',
    hammer: 5000,
    repairCost: 10000,
    observedAt: at,
    decisionRevision: a.decision.revision,
    note: 'Synthetic outcome',
    expectedRevision: a.revision,
    idempotencyKey: 'outcome-case',
  });
  expect(b.outcomes[0].decisionCeiling).toBe(a.decision.ceiling);
  expect(b.outcomes[0].observedAt).toBe(at);
  await expect(
    service.recordOutcome('buyer', a.id, {
      kind: 'sold',
      observedAt: '2026-09-05T00:00:00Z',
      note: 'Before forecast',
      decisionRevision: a.decision.revision,
      expectedRevision: b.revision,
      idempotencyKey: 'leak',
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
});
