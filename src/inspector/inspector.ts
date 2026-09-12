import { eventChannel } from '@/agent/channel';
import { settle } from '@/agent/settle';
import { runVinStage } from '@/agent/vin-stage';
import { defaultFetcher, enrichNhtsa, type Fetcher } from '@/enrich/nhtsa';
import { failureReason } from '@/lib/failure';
import { usd } from '@/lib/money';
import { createTracer, type Tracer } from '@/trace/tracer';
import { marketFromComps, repairExposure } from './market';
import { checkReliability } from './reliability';
import { findComps } from './seed-listings';
import {
  defaultWebResearchCaller,
  narrowNhtsa,
  planResearchTopics,
  runWebResearch,
  type VinSweepCaller,
  type WebResearchCaller,
} from './research';
import {
  defaultPhotoProbe,
  selectReachablePhotos,
  toOriginalIndex,
  toOriginalIndices,
  type PhotoProbe,
} from './photos';
import { analyzePhotos, defaultVisionCaller, type VisionCaller } from './vision';
import type { VpicFetcher } from './vin';
import type { VinHistoryProbe } from './vin-history';
import type {
  InspectEvent,
  InspectorInput,
  InspectorReport,
  InspectStage,
  InspectStageStatus,
  MarketComp,
  MarketPosition,
  NhtsaResearch,
  OverallAssessment,
  PhotoAnalysis,
  ReliabilityReport,
  VinCheck,
  VinSighting,
  WebFinding,
} from './types';

// The inspection agent. An async generator so every decision streams to the
// UI as it happens: what the vision pass saw per photo, which research topics
// were chosen and why, each live web search as the model runs it, NHTSA
// numbers, VIN decode and provenance, market position — then one synthesized
// report. `begin` events mark stages going active (the UI's stage rail);
// spans carry timings for the trace view and ride the same stream.
//
// Dynamic by construction: the research plan is derived from what the photos
// showed, so two cars produce different research paths. Every dependency is
// injected; the whole orchestration tests offline.

export type InspectorDeps = {
  visionCaller?: VisionCaller;
  // null disables web research explicitly (e.g. tests that want none)
  webCaller?: WebResearchCaller | null;
  sweepCaller?: VinSweepCaller | null; // null: skip the VIN provenance sweep
  nhtsaFetcher?: Fetcher;
  vpicFetcher?: VpicFetcher | null; // null: skip the live decode (offline)
  photoProbe?: PhotoProbe | null; // null: skip the reachability pre-flight (offline)
  vinHistory?: VinHistoryProbe | null; // null: skip the free-history link probe (offline)
  reliability?: typeof checkReliability;
  // Comps for the market stage. Defaults to the seeded sold-results sets;
  // a live listings API can be adapted in here later.
  compsSource?: (
    vehicle: { make: string; model: string; year: number },
    excludeUrl?: string,
  ) => { comps: MarketComp[]; query: string } | null;
  now?: () => Date;
  tracer?: Tracer;
};

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function* inspectCarStream(
  input: InspectorInput,
  deps: InspectorDeps = {},
): AsyncGenerator<InspectEvent> {
  const tracer = deps.tracer ?? createTracer();
  const stages: InspectStageStatus[] = [];
  const stage = (status: InspectStageStatus): InspectEvent => {
    stages.push(status);
    return { type: 'stage', status };
  };
  // Drain any spans the tracer collected since the last yield point.
  function* spans(): Generator<InspectEvent> {
    for (const span of tracer.drain()) yield { type: 'span', span };
  }
  const begin = (s: InspectStage): InspectEvent => ({ type: 'begin', stage: s });

  const vehicle = { make: input.make, model: input.model, year: input.year };
  const label = `${input.year} ${input.make} ${input.model}`;

  // -- Vision: the spine. Without an analysis there is nothing to inspect. --
  yield begin('vision');
  if (!deps.visionCaller && !hasKey()) {
    yield stage({ stage: 'vision', ok: false, detail: 'ANTHROPIC_API_KEY not set' });
    yield { type: 'fatal', message: 'Photo analysis needs ANTHROPIC_API_KEY on the server.' };
    return;
  }
  yield {
    type: 'thought',
    stage: 'vision',
    text: `examining ${input.photos.length} photo${input.photos.length === 1 ? '' : 's'} of the ${label}`,
  };

  // Pre-flight: probe URL photos before spending vision money on them. Dead
  // links become a visible, named decision instead of a mid-run failure.
  // Report indices ALWAYS refer to the original input order (the filmstrip).
  let selection = {
    photos: input.photos,
    originalIndex: input.photos.map((_, i) => i),
    dropped: [] as number[],
  };
  if (deps.photoProbe !== null) {
    selection = await tracer.time('vision: photo pre-flight', 'fetch', () =>
      selectReachablePhotos(input.photos, deps.photoProbe ?? defaultPhotoProbe),
    );
    if (selection.dropped.length > 0) {
      yield {
        type: 'thought',
        stage: 'vision',
        text: `photo${selection.dropped.length === 1 ? '' : 's'} ${selection.dropped.join(', ')} unreachable (dead link or blocked host), analyzing the other ${selection.photos.length}`,
      };
    }
    if (selection.photos.length === 0) {
      yield* spans();
      yield stage({ stage: 'vision', ok: false, detail: 'no photo URL is reachable' });
      yield {
        type: 'fatal',
        message: 'None of the photo URLs are reachable. The listing may have been taken down.',
      };
      return;
    }
  }

  let analysis: PhotoAnalysis;
  try {
    analysis = await tracer.time(
      'vision: photo analysis',
      'model',
      () =>
        analyzePhotos(
          selection.photos,
          {
            ...vehicle,
            listing: input.listing && {
              title: input.listing.title,
              condition: input.listing.condition,
              description: input.listing.description,
            },
          },
          deps.visionCaller ?? defaultVisionCaller,
        ),
      { attrs: { photos: selection.photos.length } },
    );
  } catch (err) {
    console.error('inspection vision: stage failed:', err);
    const detail = failureReason(err);
    yield* spans();
    yield stage({ stage: 'vision', ok: false, detail });
    yield { type: 'fatal', message: `Photo analysis failed: ${detail}` };
    return;
  }

  // Remap anchors from the reachable subset back to original input indices.
  analysis = {
    ...analysis,
    observations: analysis.observations.map((o) => ({
      ...o,
      photo: toOriginalIndex(selection, o.photo),
    })),
    issues: analysis.issues.map((issue) => ({
      ...issue,
      photos: toOriginalIndices(selection, issue.photos),
    })),
    modifications: analysis.modifications.map((mod) => ({
      ...mod,
      photos: toOriginalIndices(selection, mod.photos),
    })),
  };

  for (const observation of analysis.observations) {
    yield { type: 'photo', index: observation.photo, note: observation.note };
  }
  yield { type: 'analysis', analysis };
  yield* spans();
  yield stage({
    stage: 'vision',
    ok: true,
    detail: `${analysis.overallCondition} condition, ${analysis.issues.length} issue(s), ${analysis.modifications.length} modification(s)`,
  });

  // -- Reliability: curated known-failure data, instant. ---------------------
  yield begin('reliability');
  const reliabilityFn = deps.reliability ?? checkReliability;
  const reliability = reliabilityFn(input.make, input.model, input.year);
  yield { type: 'reliability', report: reliability };
  yield stage({
    stage: 'reliability',
    ok: true,
    detail:
      reliability.modelConcerns.length > 0
        ? `${reliability.modelConcerns.length} known weak point(s): ${reliability.modelConcerns.map((c) => c.component).join(', ')}`
        : 'no curated failure data for this exact vehicle',
  });

  // -- Plan: what to research, and why. Derived from the findings. -----------
  yield begin('plan');
  const topics = planResearchTopics(analysis, reliability, vehicle);
  yield { type: 'plan', topics };
  for (const topic of topics) {
    yield { type: 'thought', stage: 'plan', text: `${topic.reason} → will research` };
  }
  yield stage({
    stage: 'plan',
    ok: true,
    detail: topics.length > 0 ? `${topics.length} research topic(s)` : 'nothing needs research',
  });

  // -- Kick off NHTSA in parallel with web research. --------------------------
  yield begin('nhtsa');
  const nhtsaFetcher = deps.nhtsaFetcher ?? defaultFetcher;
  yield {
    type: 'thought',
    stage: 'nhtsa',
    text: `pulling NHTSA complaints and recalls for ${label}`,
  };
  const nhtsaPromise = settle(
    tracer.time('nhtsa: complaints + recalls', 'fetch', () =>
      enrichNhtsa(
        { make: input.make, model: input.model, yearMin: input.year, yearMax: input.year },
        nhtsaFetcher,
      ),
    ),
    'inspection nhtsa: stage failed:',
  );

  // -- Web research: the real internet, streamed search by search. -----------
  yield begin('web');
  let web: WebFinding[] = [];
  if (topics.length === 0) {
    yield stage({ stage: 'web', ok: true, detail: 'skipped: nothing to research' });
  } else if (deps.webCaller === null || (!deps.webCaller && !hasKey())) {
    yield stage({
      stage: 'web',
      ok: false,
      detail:
        deps.webCaller === null
          ? 'web research disabled'
          : 'web research skipped (no ANTHROPIC_API_KEY)',
    });
  } else {
    const listingLine = input.listing
      ? `"${input.listing.title}"${input.askingPrice ? ` — asking $${input.askingPrice.toLocaleString('en-US')}` : ''}${input.listing.condition ? `, ${input.listing.condition}` : ''}`
      : undefined;
    const channel = eventChannel<string>();
    let searches = 0;
    const webPromise = settle(
      tracer.time(
        'web: research agent',
        'model',
        () =>
          runWebResearch(
            vehicle,
            topics,
            deps.webCaller ?? defaultWebResearchCaller,
            (note) => {
              if (note.includes('searching:')) searches += 1;
              channel.push(note);
            },
            listingLine,
          ),
        { attrs: { topics: topics.length } },
      ),
      'inspection web: stage failed:',
    );
    for await (const note of channel.drainUntil(webPromise)) {
      yield { type: 'thought', stage: 'web', text: note };
    }
    const webResult = await webPromise;
    yield* spans();
    if (webResult.ok) {
      web = webResult.value;
      for (const finding of web) yield { type: 'web', finding };
      yield stage({
        stage: 'web',
        ok: true,
        detail: `${web.length} cited finding(s) from ${searches || 'the'} live search(es)`,
      });
    } else {
      yield stage({ stage: 'web', ok: false, detail: webResult.detail });
    }
  }

  // -- NHTSA lands. -----------------------------------------------------------
  let nhtsa: NhtsaResearch | undefined;
  const nhtsaResult = await nhtsaPromise;
  yield* spans();
  if (nhtsaResult.ok && nhtsaResult.value.status.ok) {
    nhtsa = narrowNhtsa(nhtsaResult.value, analysis.issues);
    yield { type: 'nhtsa', research: nhtsa };
    for (const match of nhtsa.matchedIssues) {
      yield {
        type: 'thought',
        stage: 'nhtsa',
        text: `photos show ${match.issueType.replace(/_/g, ' ')} and NHTSA logs ${match.count} ${match.component} complaint(s) for this vehicle`,
      };
    }
    yield stage({
      stage: 'nhtsa',
      ok: true,
      detail: `${nhtsa.complaintsTotal} complaint(s), ${nhtsa.recalls.length} recall(s)`,
    });
  } else {
    const detail = nhtsaResult.ok ? nhtsaResult.value.status.detail : nhtsaResult.detail;
    yield stage({ stage: 'nhtsa', ok: false, detail });
  }

  // -- VIN: federal decode when reachable, structural decode always. ----------
  let vinCheck: VinCheck | undefined;
  let sightings: VinSighting[] = [];
  if (input.vin) {
    yield begin('vin');
    yield { type: 'thought', stage: 'vin', text: `decoding ${input.vin}` };
    for await (const step of runVinStage(input.vin, vehicle, {
      tracer,
      vpicFetcher: deps.vpicFetcher,
      vinHistory: deps.vinHistory,
      sweepCaller: deps.sweepCaller,
      excludeUrl: input.listing?.url,
      log: 'inspection vin: provenance sweep failed:',
    })) {
      if (step.kind === 'note') {
        yield { type: 'thought', stage: 'vin', text: step.text };
      } else if (step.kind === 'check') {
        vinCheck = step.check;
        yield* spans();
        yield { type: 'vin', check: vinCheck };
      } else if (step.kind === 'sightings') {
        sightings = step.sightings;
        yield* spans();
        yield { type: 'sightings', sightings };
        yield {
          type: 'thought',
          stage: 'vin',
          text:
            sightings.length > 0
              ? `${sightings.length} prior appearance(s) of this VIN on record`
              : 'no prior public appearances of this VIN found (normal for a private-party car)',
        };
      } else {
        yield* spans();
        yield { type: 'thought', stage: 'vin', text: `provenance sweep failed: ${step.detail}` };
      }
    }

    // `runVinStage` yields its `check` step before it can return, so a
    // finished stage without one is a broken invariant, not a missing VIN.
    if (!vinCheck) throw new Error('VIN stage yielded no decode');
    const check = vinCheck;
    yield stage({
      stage: 'vin',
      ok: check.valid && check.mismatches.length === 0,
      detail:
        check.mismatches.length > 0
          ? check.mismatches.join('; ')
          : check.valid
            ? `decodes cleanly (${check.decoded?.make ?? 'unknown make'}, ${check.decoded?.year ?? '?'})${sightings.length > 0 ? `, ${sightings.length} prior sighting(s)` : ''}`
            : 'malformed VIN',
    });
  }

  // -- Market position from real comps. ----------------------------------------
  yield begin('market');
  let market: MarketPosition | undefined;
  const exposure = repairExposure(analysis.issues, analysis.modifications);
  const compsSource =
    deps.compsSource ?? ((v, exclude) => findComps(v.make, v.model, v.year, exclude));
  const compsResult = compsSource(vehicle, input.listing?.url);
  if (compsResult && compsResult.comps.length > 0) {
    const position = marketFromComps(
      compsResult.comps,
      compsResult.query,
      input.askingPrice,
      exposure,
    );
    if (position) {
      market = position;
      yield { type: 'market', market };
      yield stage({
        stage: 'market',
        ok: true,
        detail: `${market.sampleSize} comp(s), median $${market.median.toLocaleString('en-US')}`,
      });
    } else {
      yield stage({ stage: 'market', ok: false, detail: 'no usable comp prices' });
    }
  } else {
    yield stage({
      stage: 'market',
      ok: false,
      detail: 'no comps cover this vehicle, market position skipped',
    });
  }

  // -- Synthesis. ---------------------------------------------------------------
  yield begin('synthesis');
  const assessment = synthesizeAssessment(analysis, web, nhtsa, vinCheck, reliability, market);
  const report: InspectorReport = {
    vehicle,
    photoCount: input.photos.length,
    vin: input.vin,
    askingPrice: input.askingPrice,
    listing: input.listing,
    analysis,
    topics,
    web,
    sightings,
    nhtsa,
    reliability,
    vinCheck,
    market,
    assessment,
    stages,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  yield stage({ stage: 'synthesis', ok: true, detail: `verdict: ${assessment.verdict}` });
  yield { type: 'report', report };
}

// Non-streaming wrapper: drains the stream, returns the report or throws the
// fatal. Tests and any batch caller use this.
export async function inspectCar(
  input: InspectorInput,
  deps: InspectorDeps = {},
): Promise<InspectorReport> {
  let report: InspectorReport | undefined;
  for await (const event of inspectCarStream(input, deps)) {
    if (event.type === 'fatal') throw new Error(event.message);
    if (event.type === 'report') report = event.report;
  }
  if (!report) throw new Error('inspection produced no report');
  return report;
}

// -- Assessment synthesis (pure) ------------------------------------------------

export function synthesizeAssessment(
  analysis: PhotoAnalysis,
  web: WebFinding[],
  nhtsa: NhtsaResearch | undefined,
  vinCheck: VinCheck | undefined,
  reliability: ReliabilityReport,
  market: MarketPosition | undefined,
): OverallAssessment {
  const redFlags: string[] = [];
  const recommendedChecks: string[] = [];
  const keyFindings: string[] = [];

  for (const issue of analysis.issues) {
    if (issue.severity === 'critical') {
      redFlags.push(`Critical: ${issue.description}`);
      recommendedChecks.push(
        `Professional inspection of the ${issue.type.replace(/_/g, ' ')}${issue.location ? ` (${issue.location})` : ''} before any money changes hands`,
      );
    } else if (issue.severity === 'high') {
      redFlags.push(`High concern: ${issue.description}`);
    } else if (issue.severity === 'medium') {
      redFlags.push(`Moderate: ${issue.description}`);
    }
  }

  for (const mod of analysis.modifications) {
    if (mod.quality === 'budget_aftermarket') {
      redFlags.push(`Budget modification: ${mod.description}`);
    }
  }

  if (vinCheck) {
    for (const mismatch of vinCheck.mismatches) {
      redFlags.push(`VIN: ${mismatch}`);
    }
  }

  for (const finding of web) {
    if (finding.severity === 'critical') {
      redFlags.push(`Research: ${finding.summary}`);
    }
    if (finding.severity !== 'info') {
      keyFindings.push(finding.summary);
      if (finding.costEstimate) {
        recommendedChecks.push(`Budget ${finding.costEstimate} for: ${finding.topic}`);
      }
    }
  }

  if (nhtsa) {
    for (const match of nhtsa.matchedIssues) {
      keyFindings.push(
        `Photos show ${match.issueType.replace(/_/g, ' ')}; NHTSA has ${match.count} ${match.component} complaint(s) on this vehicle`,
      );
    }
  }

  for (const concern of reliability.modelConcerns) {
    if (concern.frequency === 'very_common' || concern.frequency === 'common') {
      recommendedChecks.push(`Check known issue: ${concern.component} · ${concern.description}`);
    }
  }

  const criticalCount = analysis.issues.filter((i) => i.severity === 'critical').length;
  const highCount = analysis.issues.filter((i) => i.severity === 'high').length;
  const vinMismatches = vinCheck?.mismatches.length ?? 0;
  const webCritical = web.filter((f) => f.severity === 'critical').length;

  let verdict: OverallAssessment['verdict'];
  let confidence = analysis.confidence;
  if (criticalCount > 0 || vinMismatches > 0) {
    verdict = 'avoid';
    confidence = Math.min(confidence + 0.1, 1);
  } else if (highCount >= 1 || redFlags.length >= 2 || webCritical > 0) {
    verdict = 'caution';
  } else if (
    (analysis.overallCondition === 'excellent' || analysis.overallCondition === 'good') &&
    redFlags.length === 0
  ) {
    verdict = 'pass';
    confidence = Math.min(confidence + 0.1, 1);
  } else {
    verdict = 'caution';
  }

  return {
    verdict,
    confidence,
    summary: buildSummary(verdict, analysis, redFlags.length, market),
    keyFindings,
    redFlags,
    recommendedChecks,
  };
}

function buildSummary(
  verdict: OverallAssessment['verdict'],
  analysis: PhotoAnalysis,
  redFlagCount: number,
  market: MarketPosition | undefined,
): string {
  const condition = `Presents in ${analysis.overallCondition} condition with ${redFlagCount === 0 ? 'no red flags' : `${redFlagCount} red flag${redFlagCount === 1 ? '' : 's'}`}.`;

  let marketLine = '';
  if (market) {
    const exposure = market.repairExposure;
    const exposureLine =
      exposure.high > 0
        ? ` before an estimated ${usd(exposure.low)}–${usd(exposure.high)} in repairs`
        : '';
    if (market.asking !== undefined && market.position && market.delta !== undefined) {
      const rel =
        market.position === 'at'
          ? 'at market'
          : `${usd(Math.abs(market.delta))} ${market.position} the median`;
      marketLine = ` Asking ${usd(market.asking)}, ${rel} of ${market.sampleSize} live comp(s)${exposureLine}.`;
    } else {
      marketLine = ` Live comps run ${usd(market.low)}–${usd(market.high)} (median ${usd(market.median)})${exposureLine}.`;
    }
  }

  const close = {
    pass: ' Nothing found that should stop the purchase.',
    caution: ' Resolve the flagged items before committing.',
    avoid: ' Walk away unless every flag has a documented explanation.',
  }[verdict];

  return condition + marketLine + close;
}
