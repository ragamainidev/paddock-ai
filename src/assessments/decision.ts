/** Evidence-gated buyer decisions; the model chooses research, never acceptance or money. */
import { usd } from '@/lib/money';
import { priceLot, synthesizeSalvage } from '@/salvage/assess';
import { DISCIPLINE_SHARE } from '@/salvage/ceiling';
import {
  applyPriceEvidence,
  deriveRepairPlan,
  proPrice,
  screenPriceEvidence,
} from '@/salvage/knowledge';
import { profileFor } from '@/salvage/tiers';
import type { Comp, PriceEvidence, RepairLine, RepairPlan, SalvageReport } from '@/salvage/types';
import { buyerLedger } from './buyer-ledger';
import { DEFAULT_BUYER_PROFILE } from './buyer-profile';
import { USER_LOT_SOURCE } from './intake';
import type {
  Assessment,
  AssessmentDecision,
  AssessmentEvidence,
  EvidenceSource,
  InspectionSystem,
  OfferedAction,
} from './types';
import { repairScopeFingerprint } from './scope';
import { observationFreshnessIssue } from './validation';

/** A fresh capture replaces the same source claim, never a conflicting independent source. */
export function currentEvidence(a: Assessment): AssessmentEvidence[] {
  const latest = new Map<string, AssessmentEvidence>();
  for (const e of a.evidence.filter((e) => e.status === 'accepted')) {
    const key =
      e.kind === 'repair_price'
        ? `repair:${e.value.line}:${e.source.url}`
        : e.kind === 'triage'
          ? 'triage'
          : `${e.kind}:${e.source.url}`;
    latest.set(key, e);
  }
  return [...latest.values()];
}
function reviewedQuotes(
  plan: RepairPlan,
  evidence: AssessmentEvidence[],
  a: Assessment,
): RepairPlan {
  const lines = plan.lines.map((line) => {
    const quotes = evidence.filter(
      (e): e is AssessmentEvidence & { kind: 'repair_price'; value: PriceEvidence } =>
        e.kind === 'repair_price' &&
        Boolean(e.review) &&
        e.review?.scopeFingerprint === repairScopeFingerprint(a) &&
        e.value.line === line.id &&
        e.value.kind === 'job_quote' &&
        screenPriceEvidence([e.value], line.id, a.lot).kept.length === 1,
    );
    if (!quotes.length) return line;
    // A reviewed whole-job quote may raise a prior without the model-citation cap. Never silently lower a conservative prior.
    const priced: RepairLine = {
      ...line,
      low: Math.max(line.low, ...quotes.map((e) => e.value.low)),
      expected: Math.max(line.expected, ...quotes.map((e) => (e.value.low + e.value.high) / 2)),
      high: Math.max(line.high, ...quotes.map((e) => e.value.high)),
    };
    if (line.who === 'diy') {
      // A quote buys the whole job, so the work is professional from here; its
      // hours leave the DIY labor line rather than being charged twice.
      priced.who = 'pro';
      priced.basis = `${line.basis}; reviewed quote converts DIY work to professional`;
      delete priced.diyHours;
    }
    // `pro` states what this task costs bought from a shop, so a re-priced or
    // converted line restates it (`src/salvage/types.ts`).
    return { ...priced, pro: proPrice(priced, plan.tier) };
  });
  return {
    ...plan,
    lines,
    programs: plan.programs.map((p) => ({
      ...p,
      lines: p.lines.map((l) => lines.find((x) => x.id === l.id)!),
    })),
    low: lines.reduce((s, l) => s + l.low, 0),
    expected: lines.reduce((s, l) => s + l.expected, 0),
    high: lines.reduce((s, l) => s + l.high, 0),
    diyHoursTotal: lines.filter((l) => l.who === 'diy').reduce((s, l) => s + (l.diyHours ?? 0), 0),
  };
}
// A number the owner typed carries the same label everywhere it is shown
// (SPEC 56); a claimed model capture keeps its inference marker beside it.
function provenanceLabel(source: EvidenceSource): string {
  if (source.capturedBy !== 'user') return source.basis ?? source.capturedBy;
  return source.basis === 'model_inference' ? 'self-attested model inference' : 'self-attested';
}
export function recomputeDecision(a: Assessment, at: string): AssessmentDecision {
  const buyer = a.buyer ?? DEFAULT_BUYER_PROFILE;
  const current = currentEvidence(a);
  const evidence = current.filter((e) => !observationFreshnessIssue(e, at));
  const gates: NonNullable<AssessmentDecision['gates']> = [];
  const gate = (
    id: string,
    label: string,
    met: boolean,
    detail: string,
    records: AssessmentEvidence[] = [],
    blocked = false,
  ) =>
    gates.push({
      id,
      label,
      status: blocked ? 'blocked' : met ? 'met' : 'missing',
      detail,
      evidenceIds: records.map((e) => e.id),
    });
  if (a.refreshPending?.length)
    gate(
      'refresh',
      'Requested source refresh',
      false,
      `Awaiting newly captured evidence for ${a.refreshPending.join(', ')}`,
    );
  const triage = evidence.find((e) => e.kind === 'triage');
  const identities = evidence.filter((e) => e.kind === 'identity');
  const identity = identities.at(-1);
  const identityConflict = identities.some(
    (e) =>
      e.kind === 'identity' &&
      (!e.value.valid ||
        e.value.mismatches.length > 0 ||
        e.value.vin.toUpperCase() !== a.lot.vin.toUpperCase() ||
        Boolean(
          e.value.decoded?.make && e.value.decoded.make.toLowerCase() !== a.lot.make.toLowerCase(),
        ) ||
        Boolean(
          e.value.decoded?.model &&
          e.value.decoded.model.toLowerCase() !== a.lot.model.toLowerCase(),
        ) ||
        Boolean(e.value.decoded?.year && e.value.decoded.year !== a.lot.year)),
  );
  const identityReady =
    identity?.kind === 'identity' &&
    identity.value.valid &&
    Boolean(identity.value.decoded?.model) &&
    !identityConflict;
  gate(
    'identity',
    'Vehicle identity',
    Boolean(identityReady),
    identityConflict
      ? 'Identity conflict: captured VIN observations disagree with this vehicle'
      : 'Vehicle identity requires a valid model-level VIN decode without mismatches',
    identities,
    identityConflict,
  );
  gate(
    'triage',
    'Visible repair hypotheses',
    triage?.kind === 'triage',
    triage
      ? 'Visible damage hypotheses are recorded; physical inspection still governs hidden damage'
      : 'Photo damage triage is missing',
    triage ? [triage] : [],
  );
  const titles = evidence.filter((e) => e.kind === 'title');
  const title = titles.at(-1);
  const titleBrand = title?.kind === 'title' ? title.value.titleBrand : a.lot.titleBrand;
  const knownTitle = !/unknown|masked|not (stated|disclosed|available)|pending|unchecked/i.test(
    titleBrand,
  );
  const listingTitleConflict =
    title?.kind === 'title' &&
    !/unknown|masked|not (stated|disclosed|available)/i.test(a.lot.titleBrand) &&
    titleBrand.toLowerCase() !== a.lot.titleBrand.toLowerCase();
  const titleConflict =
    new Set(titles.map((e) => (e.kind === 'title' ? e.value.titleBrand.toLowerCase() : ''))).size >
      1 ||
    Boolean(
      listingTitleConflict &&
      !(title?.kind === 'title' && title.review && title.value.listingDiscrepancyResolution),
    );
  gate(
    'title',
    'Actual title document',
    Boolean(title?.review && knownTitle && !titleConflict),
    titleConflict
      ? 'Title sources contradict each other; resolve the document discrepancy explicitly'
      : title?.review && knownTitle
        ? `Reviewed title document records ${titleBrand}`
        : 'Actual title brand remains unverified; review the captured title document',
    titles,
    titleConflict,
  );
  const registrations = evidence.filter(
    (e) =>
      e.kind === 'registration' && e.value.jurisdiction === buyer.jurisdiction && Boolean(e.review),
  );
  const registration = evidence.findLast(
    (e) =>
      e.kind === 'registration' &&
      e.value.jurisdiction === buyer.jurisdiction &&
      Boolean(e.review) &&
      (!e.value.expiresAt || Date.parse(e.value.expiresAt) >= Date.parse(at)),
  );
  const eligible =
    registration?.kind === 'registration' &&
    registration.value.eligible &&
    /^US-[A-Z]{2}$/.test(buyer.jurisdiction);
  const registrationVeto = registrations.some(
    (e) => e.kind === 'registration' && !e.value.eligible,
  );
  gate(
    'registration',
    'Jurisdiction eligibility',
    Boolean(eligible && !registrationVeto),
    registrationVeto
      ? 'Reviewed document says this vehicle is ineligible for the buyer jurisdiction'
      : `Road-registration eligibility for ${buyer.jurisdiction} requires a reviewed, current jurisdiction-specific record`,
    registration ? [registration] : [],
    registrationVeto,
  );
  const scope = repairScopeFingerprint(a);
  const inspections = evidence.filter(
    (e) => e.kind === 'inspection' && Boolean(e.review) && e.review?.scopeFingerprint === scope,
  );
  const powertrain = `${a.lot.fuel ?? ''} ${a.lot.engine}`;
  const unresolvedPowertrain = !a.lot.fuel || /unknown|not (stated|available)/i.test(a.lot.fuel);
  const hvReviewRequired =
    profileFor(a.lot).hybrid ||
    unresolvedPowertrain ||
    /electric|\bbev\b|battery|hybrid|phev/i.test(powertrain) ||
    /^(tesla|rivian|lucid|polestar)$/i.test(a.lot.make.trim());
  const required: InspectionSystem[] = [
    'structure',
    'srs',
    'powertrain',
    'water_fire',
    ...(hvReviewRequired ? ['hv' as const] : []),
  ];
  const inspectionReady =
    inspections.some((e) => e.kind === 'inspection' && e.value.repairScopeConfirmed) &&
    required.every((system) =>
      inspections.some(
        (e) =>
          e.kind === 'inspection' &&
          e.value.systems.some(
            (row) => row.system === system && ['clear', 'repairable'].includes(row.status),
          ),
      ),
    ) &&
    !inspections.some(
      (e) =>
        e.kind === 'inspection' &&
        e.value.systems.some((row) => required.includes(row.system) && row.status === 'unknown'),
    );
  const unsafe = evidence
    .filter((e) => e.kind === 'inspection' && Boolean(e.review))
    .some((e) => e.kind === 'inspection' && e.value.systems.some((row) => row.status === 'unsafe'));
  gate(
    'inspection',
    'Physical inspection and scope',
    Boolean(inspectionReady && !unsafe),
    unsafe
      ? 'Physical inspection identifies an unsafe repair prospect'
      : inspectionReady
        ? 'Reviewed physical findings cover the critical systems and current repair scope; residual hidden-damage risk remains'
        : 'Physical inspection and hidden damage scope require reviewed findings for every critical system; photos cannot establish repairability',
    inspections,
    unsafe,
  );
  const residualRisks = [
    'A build recommendation is a maximum bid under the recorded assumptions; it does not place a bid or certify roadworthiness.',
    'Inspection and source review reduce uncertainty; hidden damage and price realization risk remain in the contingency and exit margin.',
  ];
  if (a.mode === 'fixture')
    residualRisks.push(
      'This is a fixture assessment. Synthetic and recorded observations are demonstrations, not a real acquisition clearance.',
    );
  // A lot the buyer brought was read from what they pasted; the server never
  // dereferences the listing, so nothing here was captured from it (SPEC 61).
  if (a.lot.source === USER_LOT_SOURCE)
    residualRisks.push(
      'Listing details were typed or pasted by the owner and not captured from the auction page',
    );
  if (registration?.kind === 'registration')
    residualRisks.push(...registration.value.requirements.map((r) => `Before road use: ${r}`));
  if (!buyer.capabilities.lift)
    residualRisks.push(
      'No lift access is assumed. Underbody work requires confirmed specialist facilities.',
    );
  let report: SalvageReport | undefined;
  let economics: AssessmentDecision['buyerEconomics'];
  let economicWalk = false;
  if (triage?.kind === 'triage') {
    const allComps = evidence.filter(
      (e): e is AssessmentEvidence & { kind: 'comp'; value: Comp } => e.kind === 'comp',
    );
    const qualified = allComps.filter(
      (e) =>
        Boolean(e.value.date) &&
        e.value.title &&
        e.value.title !== 'unknown' &&
        (e.value.outcome === 'sold' || (e.value.outcome === 'ask' && Boolean(e.review))),
    );
    // A shallow qualified pool falls back to every comparable on record, so the
    // exit can rest on records the market gate does not accept.
    const pooled = qualified.length >= 3 ? qualified : allComps;
    const comps = pooled.map((e) => e.value);
    const lot = { ...a.lot, titleBrand };
    const profile = profileFor(lot);
    const base = deriveRepairPlan(triage.value, lot, profile);
    const diyLines = new Map(
      base.lines.filter((l) => l.who === 'diy').map((l) => [l.id, l.task] as const),
    );
    // A DIY line prices materials; its labor is the buyer's own time. A shop
    // quote replaces that work only once the owner reviews it under the current
    // damage scope, so an unreviewed or stale-scope quote never raises a DIY line.
    const deferredShopQuotes = evidence.filter(
      (e): e is AssessmentEvidence & { kind: 'repair_price'; value: PriceEvidence } =>
        e.kind === 'repair_price' &&
        e.value.kind === 'job_quote' &&
        (!e.review || e.review.scopeFingerprint !== scope) &&
        diyLines.has(e.value.line),
    );
    const deferred = new Set(deferredShopQuotes.map((e) => e.id));
    const pricesUsed = evidence.filter(
      (e): e is AssessmentEvidence & { kind: 'repair_price'; value: PriceEvidence } =>
        e.kind === 'repair_price' && !deferred.has(e.id),
    );
    const prices = pricesUsed.map((e) => e.value);
    for (const line of new Set(deferredShopQuotes.map((e) => e.value.line))) {
      // A review taken under an earlier damage scope no longer decides who does this work.
      const stale = deferredShopQuotes
        .filter((e) => e.value.line === line)
        .every((e) => Boolean(e.review));
      residualRisks.push(
        `A shop quote exists for DIY work (${diyLines.get(line)}); review it to price that work professionally${
          stale ? '; the earlier review predates the current damage scope' : ''
        }`,
      );
    }
    const plan = reviewedQuotes(applyPriceEvidence(base, prices, lot).plan, evidence, a);
    const { ledger, inputs: ceilingInputs } = priceLot(
      lot,
      triage.value,
      plan,
      comps,
      profile,
      new Date(at),
    );
    const vinCheck = identity?.kind === 'identity' ? identity.value : undefined;
    report = {
      lot,
      triage: triage.value,
      plan,
      evidence: { comps, prices },
      research: [],
      sightings: [],
      vinCheck,
      ledger,
      assessment: synthesizeSalvage(
        lot,
        triage.value,
        plan,
        ledger,
        [],
        [],
        vinCheck,
        Math.min(lot.photos.length, 12),
        profile,
      ),
      stages: [],
      generatedAt: at,
    };
    const used = new Set(ledger.exit?.comps.filter((c) => c.used).map((c) => c.comp.url));
    const qualifiedUsed = qualified.filter((e) => used.has(e.value.url));
    gate(
      'market',
      'Comparable exit evidence',
      Boolean(
        ledger.exit &&
        !ledger.exit.thin &&
        qualifiedUsed.length >= 3 &&
        // Numbers the owner typed corroborate each other for free; the exit
        // needs at least one independently captured observation (SPEC 56).
        qualifiedUsed.some((e) => e.source.capturedBy !== 'user'),
      ),
      'Exit estimate requires at least three usable known-title completed sales or explicitly reviewed asking observations, at least one from a captured source',
      qualifiedUsed,
    );
    // Every typed number the arithmetic rests on is named, including comps the
    // exit took from the fallback pool rather than the qualified one (SPEC 56).
    const selfAttested = [
      ...pooled.filter((e) => used.has(e.value.url)),
      ...pricesUsed.filter((e) => Boolean(e.review)),
    ].filter((e) => e.source.capturedBy === 'user');
    if (selfAttested.length === 1)
      residualRisks.push(
        '1 accepted number is self-attested by the owner and was not independently captured',
      );
    else if (selfAttested.length)
      residualRisks.push(
        `${selfAttested.length} accepted numbers are self-attested by the owner and were not independently captured`,
      );
    if (ledger.exit?.lane === 'clean_ask_derived')
      residualRisks.push(
        'Exit remains derived from asking prices and title discounts, not directly observed rebuilt transactions.',
      );
    const proLines = plan.lines.filter((l) => l.who === 'pro');
    const quotes = evidence.filter(
      (e): e is AssessmentEvidence & { kind: 'repair_price'; value: PriceEvidence } =>
        e.kind === 'repair_price' &&
        Boolean(e.review) &&
        e.review?.scopeFingerprint === scope &&
        e.value.kind === 'job_quote',
    );
    const missingQuotes = proLines.filter(
      (line) =>
        !quotes.some(
          (e) =>
            e.value.line === line.id &&
            screenPriceEvidence([e.value], line.id, lot).kept.length === 1,
        ),
    );
    gate(
      'repair_quotes',
      'Professional repair quotes',
      missingQuotes.length === 0,
      missingQuotes.length
        ? `Reviewed whole-job quotes remain required for: ${missingQuotes.map((l) => l.task).join('; ')}`
        : 'Reviewed whole-job quotes cover the professional work in the current repair scope',
      quotes,
    );
    const diy = plan.lines.some((l) => l.who === 'diy');
    const needsDiagnostics = plan.lines.some((l) =>
      /diagnos|scan|calibrat|electri|hv|srs/i.test(l.task),
    );
    const capable =
      (!diy ||
        (buyer.capabilities.tools &&
          buyer.capabilities.workspace &&
          buyer.availableDiyHours >= plan.diyHoursTotal)) &&
      (!proLines.length || buyer.capabilities.specialistAccess) &&
      (!needsDiagnostics || buyer.capabilities.diagnostics || buyer.capabilities.specialistAccess);
    gate(
      'capability',
      'Buyer can execute the plan',
      capable,
      `DIY plan needs tools, workspace and ${plan.diyHoursTotal} available hours; professional work requires specialist access`,
    );
    if (ledger.exit) {
      // The kernel prices the lot vehicle-relatively; this buyer's fee mode,
      // exit channel, jurisdiction, discipline, equipment, time and cash price
      // the same plan again, and so does the market persona, so both ceilings
      // exist together or neither does (SPEC 59–60).
      economics = buyerLedger({ inputs: ceilingInputs, exit: ledger.exit, ledger, buyer });
      economicWalk =
        economics.maxBid <= 0 ||
        Boolean(lot.currentBid !== undefined && lot.currentBid > economics.maxBid);
    }
    if (triage.value.airbagsDeployed === 'unknown' && !inspectionReady)
      gate('srs', 'Airbag scope', false, 'Airbag deployment and SRS repair scope remain unknown');
  } else {
    gate(
      'market',
      'Comparable exit evidence',
      false,
      'Repair cost and exit arithmetic await damage triage',
    );
    gate(
      'repair_quotes',
      'Professional repair quotes',
      false,
      'Repair quote requirements await scoped repair hypotheses',
    );
    gate(
      'capability',
      'Buyer can execute the plan',
      false,
      'Buyer capability requirements await scoped repair hypotheses',
    );
  }
  const latestClaims = new Map<string, AssessmentEvidence>();
  for (const e of a.evidence.filter(
    (e) => e.status !== 'rejected' && !observationFreshnessIssue(e, at),
  ))
    latestClaims.set(`${e.kind}:${e.source.url}`, e);
  const contradictory = [...latestClaims.values()].filter(
    (e) =>
      e.status === 'unverified' &&
      ((e.kind === 'identity' &&
        (!e.value.valid ||
          e.value.mismatches.length > 0 ||
          Boolean(
            e.value.decoded?.model &&
            e.value.decoded.model.toLowerCase() !== a.lot.model.toLowerCase(),
          ))) ||
        (e.kind === 'title' &&
          knownTitle &&
          e.value.titleBrand.toLowerCase() !== titleBrand.toLowerCase() &&
          !/unknown|masked/i.test(e.value.titleBrand)) ||
        (e.kind === 'registration' &&
          e.value.jurisdiction === buyer.jurisdiction &&
          !e.value.eligible) ||
        (e.kind === 'inspection' && e.value.systems.some((row) => row.status === 'unsafe'))),
  );
  if (contradictory.length)
    gate(
      'conflicts',
      'Conflicting source claims',
      false,
      'Unreviewed material contradictions require resolution before relying on older positive evidence',
      contradictory,
      true,
    );
  const titleVeto =
    /non[ -]?repairable|certificate of destruction/i.test(titleBrand) ||
    titles.some(
      (e) =>
        e.kind === 'title' &&
        /non[ -]?repairable|certificate of destruction/i.test(e.value.titleBrand),
    );
  const veto =
    titleVeto || registrationVeto || unsafe || Boolean(report?.assessment.dealbreakers.length);
  const unknowns = [
    ...current
      .filter((e) => observationFreshnessIssue(e, at))
      .map((e) => `Expired ${e.kind} evidence: ${observationFreshnessIssue(e, at)}`),
    ...gates.filter((g) => g.status !== 'met').map((g) => g.detail),
  ];
  const readiness = veto ? 'vetoed' : unknowns.length ? 'needs_evidence' : 'ready';
  const economicDominance =
    economics &&
    gates.find((g) => g.id === 'market')?.status === 'met' &&
    (economics.bestCaseMaxBid <= 0 ||
      (a.lot.currentBid !== undefined && a.lot.currentBid > economics.bestCaseMaxBid))
      ? { bestCaseMaxBid: economics.bestCaseMaxBid, observedBid: a.lot.currentBid ?? 0, asOf: at }
      : undefined;
  // A ceiling below the room's price setter is a walk however sound the
  // buyer's own arithmetic is: the lot can only be won above their own number,
  // which is the winner's curse (SPEC 60). An equal ceiling is not a walk, and
  // neither is a decision that is not ready to bid at all: a veto and an open
  // gate both answer before any money does (SPEC 45).
  const noEdge =
    readiness === 'ready' && Boolean(economics && economics.edge !== null && economics.edge < 0);
  const noEdgeReason =
    economics && economics.market.maxBid !== null
      ? `No edge on this lot: a professional rebuilder can pay ${usd(economics.market.maxBid)} and you can pay ${usd(economics.maxBid)}; bidding above your ceiling to win is the winner's curse.`
      : undefined;
  // The margin the ceiling retains, or the reason there is none: a required
  // surplus above the low exit leaves nothing for any bid to clear. A cash
  // limit that solved the smaller bid is what stopped this bidder, so the
  // sentence names it; the margin is still held, but under a ceiling the
  // margin did not set (SPEC 58).
  const marginShare = economics?.discipline.share ?? DISCIPLINE_SHARE;
  const margin = `the ${Math.round((1 - marginShare) * 100)}% low-exit margin is retained`;
  const marginReason =
    economics && marginShare <= 0
      ? `DIY time and holding cost are included; your required surplus of ${usd(economics.minSurplus)} exceeds the low exit of ${usd(economics.exit.low)}, so no bid clears it`
      : economics?.discipline.bound === 'cash'
        ? `DIY time and holding cost are included; your cash limit of ${usd(economics.maxAllIn)} set the ceiling; ${margin} beneath it`
        : `DIY time and holding cost are included; ${margin}`;
  // The edge decides the verdict before the buyer's own arithmetic reports on
  // it, so it is stated first. A lot this buyer cannot win at their own ceiling
  // is not a lot their constraints support, so that sentence is left out of a
  // no-edge walk rather than contradicting it.
  const readyReasons = [
    ...(noEdge && noEdgeReason ? [noEdgeReason] : []),
    ...(economicWalk
      ? ['The current bid or fixed costs exceed this buyer’s disciplined ceiling']
      : noEdge
        ? []
        : ['Reviewed evidence and buyer constraints support a conditional bid within the ceiling']),
    marginReason,
  ];
  const reasons = veto
    ? [
        ...(titleVeto ? [`Title ${titleBrand} vetoes a roadgoing rebuild`] : []),
        ...(registrationVeto ? ['Reviewed jurisdiction record says ineligible'] : []),
        ...(unsafe ? ['Physical inspection identifies unsafe scope'] : []),
        ...(report?.assessment.dealbreakers ?? []),
      ]
    : readiness === 'ready'
      ? readyReasons
      : economicDominance
        ? [
            'Stop pursuing at the observed bid: even the optimistic upper-exit / low-repair scenario cannot meet this buyer’s constraints. This is an economic screen, not verified repairability.',
          ]
        : ['The ledger is provisional until the named evidence and execution gates are met'];
  const lineage: NonNullable<AssessmentDecision['lineage']> = evidence.map((e) => ({
    id: `claim:${e.id}`,
    kind: 'claim',
    evidenceIds: [e.id],
    dependsOn: [],
    summary: `${e.kind}: ${provenanceLabel(e.source)}${e.review ? ' · owner reviewed' : ''}`,
  }));
  for (const line of report?.plan.lines ?? [])
    lineage.push({
      id: `repair:${line.id}`,
      kind: 'repair_hypothesis',
      evidenceIds: evidence
        .filter(
          (e) =>
            (e.kind === 'repair_price' && e.value.line === line.id) ||
            e.kind === 'triage' ||
            e.kind === 'inspection',
        )
        .map((e) => e.id),
      dependsOn: triage ? [`claim:${triage.id}`] : [],
      summary: `${line.task}; ${line.who}; ${line.low}–${line.high} USD; ${line.basis}`,
    });
  for (const g of gates)
    lineage.push({
      id: g.id,
      kind: 'gate',
      evidenceIds: g.evidenceIds,
      dependsOn: g.evidenceIds.map((id) => `claim:${id}`),
      summary: `${g.label}: ${g.status}; ${g.detail}`,
    });
  lineage.push({
    id: `decision:${a.revision}`,
    kind: 'decision',
    evidenceIds: evidence.map((e) => e.id),
    dependsOn: [
      ...gates.map((g) => g.id),
      ...(report?.plan.lines ?? []).map((l) => `repair:${l.id}`),
    ],
    summary: reasons.join('; '),
  });
  return {
    revision: a.revision,
    at,
    readiness,
    verdict:
      veto || economicDominance
        ? 'walk'
        : readiness === 'ready'
          ? economicWalk || noEdge
            ? 'walk'
            : 'build'
          : 'needs_evidence',
    ceiling: veto ? 0 : readiness === 'ready' ? (economics?.maxBid ?? null) : null,
    provisionalCeiling: economics?.maxBid ?? report?.ledger?.ceiling ?? null,
    unknowns,
    reasons,
    evidenceIds: evidence.map((e) => e.id),
    report,
    gates,
    residualRisks,
    economicDominance,
    buyerEconomics: economics,
    lineage,
  };
}
export function offerActions(a: Assessment): OfferedAction[] {
  if (
    a.status === 'investigating' ||
    a.decision.readiness === 'vetoed' ||
    a.decision.readiness === 'ready'
  )
    return [];
  // Once the optimistic bound cannot beat the observed auction bid, paid repair research has no decision value.
  const unviable = Boolean(a.decision.economicDominance);
  const evidence = currentEvidence(a).filter((e) => !observationFreshnessIssue(e, a.updatedAt));
  const done = new Set(a.investigations.map((i) => i.action.id));
  const fresh = (kind: AssessmentEvidence['kind']) => evidence.some((e) => e.kind === kind);
  const actions: OfferedAction[] = [];
  if (a.lot.photos.length && (!fresh('triage') || a.refreshPending?.includes('photo_triage')))
    actions.push({
      id: `photo_triage:${a.epoch}`,
      kind: 'photo_triage',
      label: 'Inspect auction photos',
      reason: 'Establish visible repair hypotheses, without clearing hidden damage',
      maxCostCents: a.mode === 'fixture' ? 0 : 300,
      priority: 1,
    });
  if (!fresh('identity') || a.refreshPending?.includes('vin_identity'))
    actions.push({
      id: `vin_identity:${a.epoch}`,
      kind: 'vin_identity',
      label: 'Check VIN identity',
      reason: 'Resolve the vehicle identity gate before trusting comparable or repair evidence',
      maxCostCents: 0,
      priority: 0,
    });
  if (!fresh('comp') || a.epoch > 0)
    actions.push({
      id: `market_comps:${a.epoch}`,
      kind: 'market_comps',
      label: 'Refresh market observations',
      reason:
        'Test the exit assumption against current source observations; asking prices remain asking prices',
      maxCostCents: 0,
      priority: 2,
      impactDollars: Math.abs(
        a.decision.report?.ledger?.sensitivity.find((s) => s.id === 'exit-typical')?.delta ?? 0,
      ),
    });
  if (!unviable)
    for (const line of [...(a.decision.report?.plan.lines ?? [])]
      .filter((l) => l.researchTopic)
      .sort((x, y) => y.high - y.low - (x.high - x.low))
      .slice(0, 12)) {
      const prior = evidence.filter((e) => e.kind === 'repair_price' && e.value.line === line.id);
      if (prior.length && !a.refreshPending?.includes('repair_evidence')) continue;
      const impact = Math.round(line.high - line.low);
      actions.push({
        id: `repair_evidence:${line.id}:${a.epoch}`,
        kind: 'repair_evidence',
        lineId: line.id,
        label: `Research ${line.task}`,
        reason: `This repair uncertainty spans $${impact.toLocaleString('en-US')}; a captured price can change the bid constraint`,
        maxCostCents: a.mode === 'fixture' ? 0 : 150,
        priority: 3 + 1 / (impact + 1),
        impactDollars: impact,
        targetEvidenceIds: prior.map((e) => e.id),
      });
    }
  return actions
    .filter(
      (action) =>
        (!a.refreshKinds || a.refreshKinds.includes(action.kind)) &&
        !done.has(action.id) &&
        action.maxCostCents <=
          a.budget.maxCostCents - a.budget.spentCostCents - a.budget.reservedCostCents,
    )
    .sort((x, y) => (x.priority ?? 99) - (y.priority ?? 99));
}
export function projectAssessment(a: Assessment, at: string, appendHistory = true): Assessment {
  a.updatedAt = at;
  a.decision = recomputeDecision(a, at);
  if (appendHistory) a.history.push(structuredClone(a.decision));
  a.offeredActions = a.status === 'stopped' ? [] : offerActions(a);
  if (a.status !== 'investigating' && a.status !== 'stopped') {
    if (a.decision.readiness === 'vetoed' || a.decision.readiness === 'ready') {
      a.stopReason =
        a.decision.readiness === 'ready'
          ? 'Decision supported by reviewed evidence and buyer constraints'
          : 'A rebuild dealbreaker is established';
      a.stopKind = 'decision';
    } else if (a.budget.usedInvestigations >= a.budget.maxInvestigations) {
      a.stopReason = 'Investigation budget exhausted';
      a.stopKind = 'budget';
    } else if (!a.offeredActions.length) {
      a.stopReason = a.decision.economicDominance
        ? 'Economically dominated at the observed bid; preserve the case for changed inputs, without requesting unnecessary inspection work'
        : 'No useful bounded investigation remains; the named evidence gates explain what is still needed';
      a.stopKind = 'waiting';
    }
    if (a.stopReason) {
      a.status = 'stopped';
      a.offeredActions = [];
    }
  }
  return a;
}
