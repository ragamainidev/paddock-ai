/**
 * The salvage assessor: a run-kind sibling of the inspector, same event
 * grammar, one question — the highest bid a disciplined rebuilder can place
 * on this lot. Photos triage the damage, the vehicle profile and curated
 * knowledge derive the repair programs, structured research prices the
 * exit (typed comps) and the big repair lines (typed prices), the VIN gets
 * the federal decode + provenance sweep, and the ledger solves the ceiling
 * and everything that would move it (SPEC 39). Stages fail alone; the
 * report is last; nothing is invented.
 */

import { eventChannel } from '@/agent/channel';
import { settle } from '@/agent/settle';
import { runVinStage } from '@/agent/vin-stage';
import type { VinSweepCaller } from '@/inspector/research';
import type { PhotoSource, VinCheck, VinSighting, WebFinding } from '@/inspector/types';
import type { VpicFetcher } from '@/inspector/vin';
import { failureReason } from '@/lib/failure';
import { usd } from '@/lib/money';
import {
  defaultPhotoProbe,
  selectReachablePhotos,
  toOriginalIndex,
  toOriginalIndices,
  type PhotoProbe,
} from '@/inspector/photos';
import type { VinHistoryProbe } from '@/inspector/vin-history';
import { createTracer, type Tracer } from '@/trace/tracer';
import { buildLedger, type CeilingInputs } from './ceiling';
import { createCompsFetcher, type CompsFetcher } from './comps';
import { selectExit, summarizeWreckMarket } from './exit';
import { applyPriceEvidence, deriveRepairPlan, lineResearchTopics } from './knowledge';
import {
  defaultSalvageEvidenceCaller,
  runSalvageEvidence,
  salvageEvidenceTopics,
  type SalvageEvidenceCaller,
} from './research';
import { profileFor, type VehicleProfile } from './tiers';
import { defaultTriageCaller, triagePhotos, type TriageCaller } from './triage';
import type {
  Comp,
  DamageTriage,
  PriceEvidence,
  RepairPlan,
  SalvageAssessment,
  SalvageEvent,
  SalvageLedger,
  SalvageLot,
  SalvageReport,
  SalvageStage,
  SalvageStageStatus,
} from './types';

export type SalvageDeps = {
  triageCaller?: TriageCaller;
  evidenceCaller?: SalvageEvidenceCaller | null; // null: research workers off (offline)
  sweepCaller?: VinSweepCaller | null;
  vpicFetcher?: VpicFetcher | null;
  photoProbe?: PhotoProbe | null; // null: skip the reachability pre-flight (offline)
  comps?: CompsFetcher | null; // null: skip the deterministic live comps (offline)
  vinHistory?: VinHistoryProbe | null; // null: skip the free-history link probe (offline)
  now?: () => Date;
  tracer?: Tracer;
};

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function* assessSalvageStream(
  lot: SalvageLot,
  deps: SalvageDeps = {},
): AsyncGenerator<SalvageEvent> {
  const tracer = deps.tracer ?? createTracer();
  const now = () => deps.now?.() ?? new Date();
  const stages: SalvageStageStatus[] = [];
  const stage = (status: SalvageStageStatus): SalvageEvent => {
    stages.push(status);
    return { type: 'stage', status };
  };
  function* spans(): Generator<SalvageEvent> {
    for (const span of tracer.drain()) yield { type: 'span', span };
  }
  const begin = (s: SalvageStage): SalvageEvent => ({ type: 'begin', stage: s });
  const thought = (s: SalvageStage, text: string): SalvageEvent => ({
    type: 'thought',
    stage: s,
    text,
  });

  // -- VIN work starts NOW, in parallel with everything: neither the federal
  // decode nor the provenance sweep depends on the photos. Results are
  // awaited (and streamed) at the vin stage's position in the report order.
  const vinWork: Promise<{
    vinCheck: VinCheck;
    sightings: VinSighting[];
    sweepError?: string;
  }> = (async () => {
    let vinCheck: VinCheck | undefined;
    let sightings: VinSighting[] = [];
    let sweepError: string | undefined;
    // Progress is dropped, not streamed: live notes from work that started
    // before triage would shred the console's stage grouping.
    for await (const step of runVinStage(
      lot.vin,
      { make: lot.make, model: lot.model, year: lot.year },
      {
        tracer,
        vpicFetcher: deps.vpicFetcher,
        vinHistory: deps.vinHistory,
        sweepCaller: deps.sweepCaller,
        excludeUrl: lot.url,
        log: 'salvage vin: provenance sweep failed:',
      },
    )) {
      if (step.kind === 'check') vinCheck = step.check;
      else if (step.kind === 'sightings') sightings = step.sightings;
      else if (step.kind === 'sweep-failed') sweepError = step.detail;
    }
    // `runVinStage` yields its `check` step before it can return, so a
    // finished stage without one is a broken invariant, not a missing VIN.
    if (!vinCheck) throw new Error('VIN stage yielded no decode');
    return { vinCheck, sightings, sweepError };
  })();
  vinWork.catch(() => {}); // never an unhandled rejection if triage goes fatal first

  // -- Triage: without it there is nothing to plan. ---------------------------
  yield begin('triage');
  if (!deps.triageCaller && !hasKey()) {
    yield stage({ stage: 'triage', ok: false, detail: 'ANTHROPIC_API_KEY not set' });
    yield { type: 'fatal', message: 'Damage triage needs ANTHROPIC_API_KEY on the server.' };
    return;
  }
  // Pre-flight: probe the auction CDN before spending triage money. Report
  // indices always refer to the lot's original photo order (the filmstrip).
  const sources: PhotoSource[] = lot.photos.map((url) => ({ kind: 'url', url }));
  let selection = {
    photos: sources,
    originalIndex: sources.map((_, i) => i),
    dropped: [] as number[],
  };
  if (deps.photoProbe !== null) {
    selection = await tracer.time('triage: photo pre-flight', 'fetch', () =>
      selectReachablePhotos(sources, deps.photoProbe ?? defaultPhotoProbe),
    );
    if (selection.dropped.length > 0) {
      yield thought(
        'triage',
        `photo${selection.dropped.length === 1 ? '' : 's'} ${selection.dropped.join(', ')} unreachable on the auction CDN, triaging the other ${selection.photos.length}`,
      );
    }
    if (selection.photos.length === 0) {
      yield* spans();
      yield stage({ stage: 'triage', ok: false, detail: 'no photo URL is reachable' });
      yield {
        type: 'fatal',
        message: 'None of the auction photos are reachable. The lot may have been delisted.',
      };
      return;
    }
  }
  const reachableUrls = selection.photos.map((p) => (p.kind === 'url' ? p.url : ''));
  const triageCount = Math.min(reachableUrls.length, 12);
  yield thought(
    'triage',
    `triaging ${triageCount} auction photos of the ${lot.year} ${lot.make} ${lot.model} · listed damage: ${lot.damage.primary.toLowerCase()}`,
  );

  let triage: DamageTriage;
  try {
    triage = await tracer.time(
      'triage: damage assessment',
      'model',
      () =>
        triagePhotos({ ...lot, photos: reachableUrls }, deps.triageCaller ?? defaultTriageCaller),
      { attrs: { photos: triageCount } },
    );
  } catch (err) {
    console.error('salvage triage: stage failed:', err);
    const detail = failureReason(err);
    yield* spans();
    yield stage({ stage: 'triage', ok: false, detail });
    yield { type: 'fatal', message: `Damage triage failed: ${detail}` };
    return;
  }
  // Remap anchors from the reachable subset back to original lot indices.
  triage = {
    ...triage,
    observations: triage.observations.map((o) => ({
      ...o,
      photo: toOriginalIndex(selection, o.photo),
    })),
    areas: triage.areas.map((a) => ({ ...a, photos: toOriginalIndices(selection, a.photos) })),
  };
  for (const obs of triage.observations) {
    yield { type: 'photo', index: obs.photo, note: obs.note };
  }
  yield { type: 'triage', triage };
  yield* spans();
  yield stage({
    stage: 'triage',
    ok: true,
    detail: `${triage.overall.replace('_', ' ')} · ${triage.areas.length} damage area(s), airbags ${triage.airbagsDeployed}`,
  });

  // -- Repair programs: deterministic, from the vehicle profile. ---------------
  yield begin('plan');
  const profile = profileFor(lot);
  const plan = deriveRepairPlan(triage, lot, profile);
  yield { type: 'repair-plan', plan };
  yield thought(
    'plan',
    `${plan.tierLabel} · ${profile.construction.chassis.replace(/_/g, ' ')}${profile.hybrid ? ' · hybrid' : ''}${profile.adas ? ' · ADAS' : ''}`,
  );
  for (const program of plan.programs) {
    const exp = program.lines.reduce((s, l) => s + l.expected, 0);
    yield thought(
      'plan',
      `${program.label.toLowerCase()}: ${program.lines.length} line${program.lines.length === 1 ? '' : 's'}${program.zones.length ? ` for ${program.zones.join(', ')}` : ''} · ${usd(exp)} expected · ${program.lines.map((l) => `${l.who === 'diy' ? 'you' : 'pro'}: ${l.task.toLowerCase()}`).join('; ')}`,
    );
  }
  yield stage({
    stage: 'plan',
    ok: true,
    detail: `${plan.programs.length} program(s), ${plan.lines.length} lines: ${usd(plan.low)}–${usd(plan.high)}, expected ${usd(plan.expected)} · ${plan.diyHoursTotal}h of your labor`,
  });

  // -- Research: typed comps and typed prices, cited. ---------------------------
  yield begin('research');
  let comps: Comp[] = [];
  let prices: PriceEvidence[] = [];
  let research: WebFinding[] = [];
  // Deterministic live comps run first: known URL patterns, no login, no
  // model in the loop. Whatever they cover, the workers are not asked for.
  const compsFetcher =
    deps.comps === null
      ? null
      : (deps.comps ?? (process.env.EBAY_CLIENT_ID ? createCompsFetcher() : null));
  if (compsFetcher) {
    const compsChannel = eventChannel<string>();
    const compsPromise = settle(
      tracer.time('research: live comps (eBay)', 'fetch', () =>
        compsFetcher(lot, compsChannel.push),
      ),
      'salvage research: live comps failed:',
    );
    for await (const note of compsChannel.drainUntil(compsPromise)) {
      yield thought('research', note);
    }
    const compsResult = await compsPromise;
    yield* spans();
    if (compsResult.ok) {
      comps = compsResult.value;
      if (comps.length > 0) yield { type: 'comps', comps };
    } else {
      yield thought(
        'research',
        `live comps unavailable (${compsResult.detail}); the research workers carry the anchors`,
      );
    }
  }

  const cleanAsksCovered =
    comps.filter((c) => c.lane === 'clean' && c.outcome === 'ask').length >= 3;
  const topics = salvageEvidenceTopics(lot, lineResearchTopics(plan, lot), {
    cleanAsks: cleanAsksCovered,
  });
  if (cleanAsksCovered) {
    yield thought(
      'research',
      'live comps already carry the clean-ask lane; the workers research the rest',
    );
  }
  for (const t of topics) yield thought('research', `[${t.tag}] plan: ${t.reason}`);

  if (deps.evidenceCaller === null || (!deps.evidenceCaller && !hasKey())) {
    yield stage({
      stage: 'research',
      ok: comps.length > 0,
      detail:
        deps.evidenceCaller === null
          ? `research workers disabled; ${comps.length} live comp(s)`
          : 'research skipped (no ANTHROPIC_API_KEY)',
    });
  } else {
    const channel = eventChannel<string>();
    const evidencePromise = settle(
      tracer.time(
        'research: comps + price workers',
        'model',
        () =>
          runSalvageEvidence(
            lot,
            topics,
            deps.evidenceCaller ?? defaultSalvageEvidenceCaller,
            channel.push,
            `"${lot.title}" — ${lot.damage.primary.toLowerCase()} damage, title: ${lot.titleBrand}${lot.odometer !== undefined ? `, ${lot.odometer.toLocaleString('en-US')} miles` : ''}`,
          ),
        { attrs: { topics: topics.length } },
      ),
      'salvage research: evidence workers failed:',
    );
    for await (const note of channel.drainUntil(evidencePromise)) {
      yield thought('research', note);
    }
    const outcome = await evidencePromise;
    yield* spans();
    if (outcome.ok) {
      const result = outcome.value;
      comps = [...comps, ...result.comps];
      prices = result.prices;
      research = result.notes;
      if (result.comps.length > 0) yield { type: 'comps', comps: result.comps };
      if (prices.length > 0) yield { type: 'prices', prices };
      for (const finding of research) yield { type: 'web', finding };
      const lanes = ['clean', 'rebuilt', 'wreck'] as const;
      yield stage({
        stage: 'research',
        ok: comps.length > 0 || prices.length > 0,
        detail:
          comps.length > 0 || prices.length > 0
            ? `${comps.length} comp(s): ${lanes.map((l) => `${comps.filter((c) => c.lane === l).length} ${l}`).join(', ')}; ${prices.length} cited price(s)`
            : 'no cited comps or prices survived, the exit is unanchored',
      });
    } else {
      yield stage({
        stage: 'research',
        ok: comps.length > 0,
        detail: `${outcome.detail}${comps.length ? `; ${comps.length} live comp(s) carry the anchors` : ''}`,
      });
    }
  }

  // -- VIN: results land here, but the work started before triage. -------------
  yield begin('vin');
  yield thought('vin', `decoded ${lot.vin} in parallel with triage`);
  const vin = await vinWork;
  yield* spans();
  const vinCheck = vin.vinCheck;
  const sightings = vin.sightings;
  yield { type: 'vin', check: vinCheck };
  if (sightings.length > 0) yield { type: 'sightings', sightings };
  if (vin.sweepError) yield thought('vin', `provenance sweep failed: ${vin.sweepError}`);
  yield stage({
    stage: 'vin',
    ok: vinCheck.valid && vinCheck.mismatches.length === 0,
    detail:
      vinCheck.mismatches.length > 0
        ? vinCheck.mismatches.join('; ')
        : `decodes cleanly (${vinCheck.decoded?.make ?? '?'} ${vinCheck.decoded?.model ?? ''})${sightings.length ? `, ${sightings.length} prior sighting(s)` : ''}`,
  });

  // -- Ledger: the ceiling, solved. --------------------------------------------
  yield begin('ledger');
  const narrowed = applyPriceEvidence(plan, prices, lot);
  const finalPlan = narrowed.plan;
  for (const note of narrowed.notes) yield thought('ledger', `evidence narrows the plan · ${note}`);
  const money = priceLot(lot, triage, finalPlan, comps, profile, now());
  const { ledger, exit, wreck } = money;
  if (exit) {
    yield thought(
      'ledger',
      `rebuilt exit ${usd(exit.low)} low · ${usd(exit.typical)} typical · ${usd(exit.high)} high (${exit.basis})`,
    );
  } else {
    yield thought(
      'ledger',
      'no exit anchor: no clean or rebuilt comps survived selection and the listing states no ACV',
    );
  }
  if (wreck) {
    yield thought(
      'ledger',
      `wreck market ${usd(wreck.low)}–${usd(wreck.high)}, median ${usd(wreck.median)} (${wreck.basis})`,
    );
  }
  yield { type: 'ledger', ledger };
  yield stage({
    stage: 'ledger',
    ok: ledger.ceiling !== null,
    detail:
      ledger.ceiling === null
        ? `no exit to solve against; repairs and fees run ${usd(ledger.costs.filter((l) => !l.bidDependent).reduce((s, l) => s + l.expected, 0))} before the bid`
        : ledger.ceiling > 0
          ? `ceiling ${usd(ledger.ceiling)} · break-even ${usd(ledger.breakEven ?? 0)} · stress ${usd(ledger.stress ?? 0)}`
          : `ceiling $0: ${ledger.killers
              .map((k) => k.label)
              .slice(0, 2)
              .join(' and ')} eat the exit`,
  });

  // -- Synthesis. ----------------------------------------------------------------
  yield begin('synthesis');
  const assessment = synthesizeSalvage(
    lot,
    triage,
    finalPlan,
    ledger,
    research,
    sightings,
    vinCheck,
    Math.min(lot.photos.length, 12),
    profile,
  );
  const report: SalvageReport = {
    lot,
    triage,
    plan: finalPlan,
    evidence: { comps, prices },
    research,
    sightings,
    vinCheck,
    ledger,
    assessment,
    stages,
    generatedAt: now().toISOString(),
  };
  yield stage({ stage: 'synthesis', ok: true, detail: `verdict: ${assessment.verdict}` });
  yield { type: 'report', report };
}

// -- Pure pieces -------------------------------------------------------------------

// The money model end to end, from typed evidence to a solved ledger. Pure:
// the eval suite replays recorded triage + evidence through this exact path.
export function priceLot(
  lot: SalvageLot,
  triage: DamageTriage,
  plan: RepairPlan,
  comps: Comp[],
  profile: VehicleProfile = profileFor(lot),
  now: Date = new Date(),
): {
  ledger: SalvageLedger;
  exit: SalvageLedger['exit'];
  wreck: SalvageLedger['wreck'];
  inputs: CeilingInputs;
} {
  const exit = selectExit(comps, lot, {
    discount: profile.rebuiltDiscount,
    askHaircut: profile.askHaircut,
    now,
  });
  const dMid = (profile.rebuiltDiscount.low + profile.rebuiltDiscount.high) / 2;
  const cleanTypical =
    exit && exit.lane !== 'rebuilt_sold' ? Math.round(exit.typical / dMid) : undefined;
  const wreck = summarizeWreckMarket(comps, lot, { cleanTypical, now });
  // The solved inputs travel with the ledger: a caller repricing a scenario
  // re-derives its lines through the kernel instead of restating the money.
  const inputs: CeilingInputs = {
    lot,
    triage,
    plan,
    exit,
    wreck,
    profile: {
      selling: profile.selling,
      titleProcess: profile.titleProcess,
      transport: profile.transport,
      contingencyFloor: profile.contingencyFloor,
      hybrid: profile.hybrid,
    },
  };
  return { ledger: buildLedger(inputs), exit, wreck, inputs };
}

// Confidence as an audited ledger: start from what the photos could show,
// add for evidence that corroborated, subtract for what stayed unknown.
export function confidenceLedger(
  lot: SalvageLot,
  triage: DamageTriage,
  ledger: SalvageLedger | undefined,
  plan: RepairPlan,
  sightings: VinSighting[],
  vinCheck: VinCheck | undefined,
  photosAnalyzed: number,
): { confidence: number; factors: { label: string; delta: number }[] } {
  const factors: { label: string; delta: number }[] = [
    { label: 'photo triage', delta: triage.confidence },
  ];
  const lane = ledger?.exit?.lane;
  if (lane === 'rebuilt_sold') factors.push({ label: 'rebuilt-title sold comps', delta: 0.1 });
  else if (lane === 'clean_sold_derived') factors.push({ label: 'clean sold comps', delta: 0.06 });
  else if (lane === 'clean_ask_derived') factors.push({ label: 'clean asks only', delta: 0.03 });
  if (ledger?.exit?.thin) factors.push({ label: 'thin comps', delta: -0.04 });
  const cited = plan.lines.filter((l) => l.evidence === 'cited').length;
  if (cited > 0)
    factors.push({
      label: `${cited} cited repair line${cited === 1 ? '' : 's'}`,
      delta: Math.min(0.06, 0.02 * cited),
    });
  if (vinCheck?.decoded?.model && vinCheck.mismatches.length === 0) {
    factors.push({ label: 'federal decode matches', delta: 0.05 });
  }
  if (sightings.length > 0) factors.push({ label: 'VIN history found', delta: 0.04 });
  if (lot.odometer === undefined) factors.push({ label: 'odometer unknown', delta: -0.06 });
  if (photosAnalyzed < 10) factors.push({ label: `only ${photosAnalyzed} photos`, delta: -0.05 });
  const raw = factors.reduce((sum, f) => sum + f.delta, 0);
  return { confidence: Math.min(0.95, Math.max(0.05, Math.round(raw * 100) / 100)), factors };
}

export function synthesizeSalvage(
  lot: SalvageLot,
  triage: DamageTriage,
  plan: RepairPlan,
  ledger: SalvageLedger | undefined,
  research: WebFinding[],
  sightings: VinSighting[] = [],
  vinCheck?: VinCheck,
  photosAnalyzed = Math.min(lot.photos.length, 12),
  profile: VehicleProfile = profileFor(lot),
): SalvageAssessment {
  const dealbreakers: string[] = [];
  const watchItems: string[] = [];
  const vetoReasons: string[] = [];

  const nonRepairable = /non-repairable|certificate of destruction/i.test(lot.titleBrand);
  if (nonRepairable) {
    dealbreakers.push(
      `Title is ${lot.titleBrand}: cannot be road-registered in most states. There is no rebuild exit at any price.`,
    );
    vetoReasons.push('the title is registration-dead');
  }
  if (triage.overall === 'parts_car') {
    dealbreakers.push(
      'Triage reads this as a parts car: the structure is too far gone to rebuild honestly.',
    );
    vetoReasons.push('the structure is too far gone');
  }
  // Heavy structural damage is a hard veto only where structure cannot be
  // commercially repaired (carbon tubs). On aluminum and steel the plan
  // already prices the jig work.
  const heavyStructural = triage.areas.some(
    (a) => a.kind === 'structural' && a.severity === 'heavy',
  );
  if (heavyStructural && profile.construction.chassis === 'carbon_tub') {
    dealbreakers.push(
      'Heavy structural damage on a carbon tub: repair authorization is a factory decision, not a shop quote. Often a write-off.',
    );
    vetoReasons.push('the carbon tub is compromised');
  } else if (heavyStructural) {
    watchItems.push(
      'Heavy structural damage: the plan prices the section work, but certified-shop capacity, jig time, and factory parts supply are the real schedule risk.',
    );
  }
  if (triage.fireEvidence) {
    dealbreakers.push(
      'Fire evidence: wiring and interior costs are unbounded. Rebuild is off the table.',
    );
    vetoReasons.push('fire');
  }

  if (triage.airbagsDeployed === 'yes')
    watchItems.push('Deployed SRS: five-figure OEM-only line item.');
  if (triage.airbagsDeployed === 'unknown') {
    watchItems.push(
      'Airbag state unknown from the photos: a deployed SRS adds a five-figure line the plan does not carry.',
    );
  }
  if (triage.floodEvidence)
    watchItems.push('Flood evidence: corrosion is a clock; price modules accordingly.');
  if (lot.odometer === undefined)
    watchItems.push('Odometer unknown: value at worst-supportable mileage.');
  if (/^IL\b/i.test(lot.location)) {
    watchItems.push(
      'Illinois lot: an IL rebuilt title requires the repair to be done by a licensed rebuilder and a second Secretary of State police inspection on cars eight model years or newer; a DIY rebuild titles more easily out of state.',
    );
  }
  if (profile.tier === 'exotic') {
    watchItems.push(
      'Bidding power: Copart requires a deposit of about 10% of your maximum bid on file before you can bid, and the broker fee on a six-figure lot is a percentage unless you use a flat-fee broker.',
    );
  }
  if (ledger?.exit?.thin) {
    watchItems.push(
      `Thin exit evidence: ${ledger.exit.n} comp${ledger.exit.n === 1 ? '' : 's'} behind the exit; the band was widened, verify it before the sale.`,
    );
  }
  if (ledger?.exit && ledger.exit.lane !== 'rebuilt_sold') {
    watchItems.push(
      'No rebuilt-title sale of this model was found: the exit is derived from clean money and a tier discount, not observed. Liquidity at six figures on a branded title is the risk the discipline margin exists for.',
    );
  }
  for (const critical of research.filter((f) => f.severity === 'critical')) {
    watchItems.push(`Research: ${critical.summary}`);
  }

  // -- The verdict: bid to the ceiling, or no bid with the reason. --------------
  const rebuildDead = dealbreakers.length > 0;
  const ceiling = ledger?.ceiling ?? null;
  const exit = ledger?.exit ?? null;
  const wreck = ledger?.wreck ?? null;
  const verdict: SalvageAssessment['verdict'] =
    !rebuildDead && ceiling !== null && ceiling > 0 ? 'build' : 'walk';

  const parts: string[] = [];
  const fixedExpected = ledger
    ? ledger.costs.filter((l) => !l.bidDependent).reduce((s, l) => s + l.expected, 0)
    : 0;
  if (rebuildDead) {
    parts.push(`No bid: ${vetoReasons.join(', ')}.`);
    if (ledger && exit && ceiling !== null && ceiling > 0) {
      parts.push(
        `The money alone would have supported ${usd(ceiling)}; the veto is not about money.`,
      );
    }
  } else if (!ledger || !exit || ceiling === null) {
    parts.push(
      `No bid: no exit anchor survived research (no clean or rebuilt comps and no stated ACV), so nothing can be solved against. Repairs, fees, and contingency run ${usd(fixedExpected)} before the bid; don't bid what you can't price.`,
    );
  } else if (ceiling <= 0) {
    const killers = ledger.killers
      .slice(0, 3)
      .map((k) => `${k.label.toLowerCase()} ${usd(k.expected)}`);
    parts.push(
      `No bid at any price: repairs, fees, contingency, and selling costs run ${usd(fixedExpected)} expected against a ${usd(exit.low)} low rebuilt exit (${usd(exit.typical)} typical), and ${Math.round(ledger.discipline.share * 100)}% discipline leaves nothing for the hammer.${killers.length ? ` What ate it: ${killers.join(', ')}.` : ''}`,
    );
    const feasible = ledger.unlocks.filter((u) => u.feasible);
    const bestCase = ledger.sensitivity.find((r) => r.id === 'best-case');
    if (feasible.length > 0) {
      parts.push(`It turns positive only if ${feasible.map((u) => u.note).join('; or if ')}.`);
    } else if (bestCase && (bestCase.ceiling ?? 0) > 0) {
      parts.push(
        `No single input rescues it; only the best case (exit at typical, every repair at its low, no hidden damage) reaches ${usd(bestCase.ceiling ?? 0)}.`,
      );
    } else {
      parts.push(
        'Nothing realistic unlocks it: even with the exit at typical, every repair at its low, and no hidden damage, the math stays under water.',
      );
    }
    if (ledger.breakEven && ledger.breakEven > 0) {
      parts.push(`Break-even, with no margin at all, is ${usd(ledger.breakEven)}.`);
    }
  } else {
    parts.push(
      `Bid to ${usd(ceiling)}. All-in at that bid is ${usd(ledger.allInAtCeiling ?? 0)} against a ${usd(exit.low)} low rebuilt exit (${usd(exit.typical)} typical), which keeps the ${Math.round((1 - ledger.discipline.share) * 100)}% margin that absorbs what the photos hide. Break-even is ${usd(ledger.breakEven ?? 0)}${ledger.stress !== null ? `; if every repair hits its high, ${usd(ledger.stress)}` : ''}. Plus ${ledger.diyHours}h of your own labor.`,
    );
  }
  if (wreck) {
    const rel =
      ceiling !== null && ceiling > 0
        ? wreck.median > ceiling
          ? `above your ceiling: expect to lose the room to exporters and dismantlers unless this lot runs cold`
          : `under your ceiling: the room is not paying what the car is worth rebuilt, which is the play`
        : ceiling === 0
          ? `whoever wins it has a structural edge you don't (export lane, in-house shop, parts channel)`
          : 'context only';
    parts.push(
      `Wrecked ${lot.model}s hammer ${usd(wreck.low)}–${usd(wreck.high)} (median ${usd(wreck.median)}, ${wreck.n} lot${wreck.n === 1 ? '' : 's'}${wreck.nSold ? `, ${wreck.nSold} sold` : ''}), ${rel}.`,
    );
  }

  const opening =
    verdict === 'build' ? `Worth up to ${usd(ceiling ?? 0)} in the room.` : "Don't bid.";
  const audited = confidenceLedger(lot, triage, ledger, plan, sightings, vinCheck, photosAnalyzed);
  return {
    verdict,
    confidence: audited.confidence,
    confidenceFactors: audited.factors,
    summary: `${opening} ${parts.join(' ')}`,
    dealbreakers,
    watchItems,
  };
}
