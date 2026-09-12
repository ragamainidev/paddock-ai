import { describe, expect, it } from 'vitest';
import type { InspectEvent, InspectorReport } from '@/inspector/types';
import type { StoredEvent } from '@/runs/types';
import type { SalvageReport } from '@/salvage/types';
import {
  clockFormat,
  emptyProjection,
  linesForEvent,
  normalizeInspectorReport,
  normalizeSalvageReport,
  reduceRun,
  stageDuration,
  stageLabel,
} from './lines';

// The run page is a pure projection of the event stream; these tests pin the
// console grammar and the stage rail lifecycle without a browser.

const at = (s: number) => new Date(Date.UTC(2026, 7, 13, 12, 0, s)).toISOString();
const env = (seq: number, event: unknown, second = seq): StoredEvent => ({
  seq,
  at: at(second),
  event,
});

describe('console line grammar', () => {
  it('search thoughts split the query out as the emphasized text', () => {
    const [line] = linesForEvent(
      { type: 'thought', stage: 'web', text: 'searching: e46 m3 subframe crack cost' },
      7,
    );
    expect(line).toMatchObject({ kind: 'search', text: 'e46 m3 subframe crack cost' });
  });

  it('worker-tagged searches split the lane tag out for dim rendering', () => {
    const [line] = linesForEvent(
      { type: 'thought', stage: 'research', text: '[resale] searching: SF90 rebuilt title price' },
      8,
    );
    expect(line).toMatchObject({
      kind: 'search',
      lane: 'resale',
      text: 'SF90 rebuilt title price',
    });
  });

  it('worker-tagged status notes keep the lane and stay thoughts', () => {
    const [line] = linesForEvent(
      { type: 'thought', stage: 'research', text: '[part-out] reading 6 sources' },
      9,
    );
    expect(line).toMatchObject({ kind: 'thought', lane: 'part-out', text: 'reading 6 sources' });
  });

  it('untagged thoughts have no lane', () => {
    const [line] = linesForEvent(
      { type: 'thought', stage: 'vin', text: 'decoded the VIN in parallel' },
      10,
    );
    expect(line.lane).toBeUndefined();
  });

  it('photo observations carry the photo chip index', () => {
    const [line] = linesForEvent({ type: 'photo', index: 3, note: 'rocker panel bubbling' }, 4);
    expect(line).toMatchObject({ kind: 'evidence', photo: 3, text: 'rocker panel bubbling' });
  });

  it('plan lines read reason with the topic as the detail tail', () => {
    const [line] = linesForEvent(
      {
        type: 'plan',
        topics: [{ topic: 'rust repair cost', reason: 'photos show high rust', priority: 8 }],
      },
      5,
    );
    expect(line).toMatchObject({
      kind: 'plan',
      text: 'photos show high rust',
      detail: 'rust repair cost',
    });
  });

  it('web findings cite their hosts in the detail tail', () => {
    const [line] = linesForEvent(
      {
        type: 'web',
        finding: {
          topic: 't',
          summary: 'subframes crack',
          severity: 'concern',
          sources: [{ url: 'https://www.m3forum.net/thread/1', title: 'thread' }],
        },
      },
      6,
    );
    expect(line).toMatchObject({ kind: 'evidence', detail: 'm3forum.net' });
  });

  it('critical findings and VIN mismatches take danger; degraded stages take one warn line', () => {
    const [critical] = linesForEvent(
      {
        type: 'web',
        finding: {
          topic: 't',
          summary: 'engines grenade',
          severity: 'critical',
          sources: [{ url: 'https://a.com/x', title: 'x' }],
        },
      },
      1,
    );
    expect(critical.kind).toBe('finding-danger');

    const [mismatch] = linesForEvent(
      {
        type: 'vin',
        check: {
          vin: 'X',
          valid: true,
          mismatches: ['decodes to Honda; listing claims BMW'],
          note: '',
          links: [],
        },
      },
      2,
    );
    expect(mismatch.kind).toBe('finding-danger');

    const [degraded] = linesForEvent(
      { type: 'stage', status: { stage: 'market', ok: false, detail: 'no comps' } },
      3,
    );
    expect(degraded.kind).toBe('degraded');
    expect(degraded.text).toContain('no comps');
  });

  it('ok stage statuses and begin events add no console noise', () => {
    expect(
      linesForEvent({ type: 'stage', status: { stage: 'vision', ok: true, detail: 'fine' } }, 1),
    ).toEqual([]);
    expect(linesForEvent({ type: 'begin', stage: 'vision' }, 2)).toEqual([]);
  });
});

describe('run projection', () => {
  const begin = (stage: string, seq: number, second: number) =>
    env(seq, { type: 'begin', stage } as InspectEvent, second);
  const status = (stage: string, ok: boolean, seq: number, second: number, detail?: string) =>
    env(seq, { type: 'stage', status: { stage, ok, detail } } as InspectEvent, second);

  it('rail rows appear on begin, go active, and settle with envelope-true durations', () => {
    let state = emptyProjection();
    state = reduceRun(
      state,
      env(1, { type: 'run-meta', runId: 'r', kind: 'inspect', persisted: true }),
    );
    state = reduceRun(state, begin('vision', 2, 1));
    expect(state.rail).toMatchObject([{ stage: 'vision', state: 'active' }]);
    expect(state.activeStage).toBe('vision');

    state = reduceRun(state, status('vision', true, 3, 13));
    expect(state.rail[0]).toMatchObject({ state: 'ok', ms: 12_000 });
    expect(state.activeStage).toBeUndefined();
  });

  it('degraded stages keep their reason on the rail row', () => {
    let state = emptyProjection();
    state = reduceRun(state, begin('market', 1, 0));
    state = reduceRun(state, status('market', false, 2, 1, 'no comps cover this vehicle'));
    expect(state.rail[0]).toMatchObject({
      state: 'degraded',
      detail: 'no comps cover this vehicle',
    });
  });

  it('spans accumulate, the report closes the run, and replays dedupe by seq', () => {
    let state = emptyProjection();
    const span = env(1, {
      type: 'span',
      span: { id: 's1', name: 'vision', kind: 'model', startedAt: at(0), ms: 900, ok: true },
    });
    state = reduceRun(state, span);
    state = reduceRun(state, span); // replay overlap must not duplicate
    expect(state.spans).toHaveLength(1);

    const report = {
      assessment: { verdict: 'caution', summary: 'fine', confidence: 0.8 },
    } as unknown as import('@/inspector/types').InspectorReport;
    state = reduceRun(state, env(2, { type: 'report', report }));
    expect(state.report).toMatchObject(report);
    expect(state.lines.at(-1)).toMatchObject({ kind: 'verdict-warn' });
  });

  it('meta lands separately and the persisted flag survives', () => {
    const state = reduceRun(
      emptyProjection(),
      env(1, { type: 'run-meta', runId: 'r', kind: 'inspect', persisted: false }),
    );
    expect(state.meta?.persisted).toBe(false);
    expect(state.lines).toEqual([]);
  });
});

describe('duration formatting', () => {
  it('clockFormat renders m:ss', () => {
    expect(clockFormat(0)).toBe('0:00');
    expect(clockFormat(61_000)).toBe('1:01');
    expect(clockFormat(600_000)).toBe('10:00');
  });
  it('stageDuration picks the right unit', () => {
    expect(stageDuration(400)).toBe('400ms');
    expect(stageDuration(12_340)).toBe('12.3s');
    expect(stageDuration(84_000)).toBe('1:24');
  });
});

describe('legacy persisted reports (migration-on-read)', () => {
  // Runs written by older code lack fields added since. These payloads
  // mirror what is actually sitting in Postgres — reduceRun must normalize
  // them so no component reads a new field on an old report and crashes.

  it('an old salvage report without confidenceFactors gains an empty ledger of factors', () => {
    const legacySalvage = {
      lot: { id: 'x', title: 't', make: 'Ferrari', model: 'SF90', year: 2021, photos: [] },
      triage: {
        overall: 'borderline',
        areas: [],
        airbagsDeployed: 'no',
        floodEvidence: false,
        fireEvidence: false,
        drivetrainRisk: 'x',
        observations: [],
        confidence: 0.55,
      },
      plan: {
        tasks: [],
        diyHoursTotal: 0,
        partsLow: 0,
        partsHigh: 0,
        proLow: 0,
        proHigh: 0,
        missed: [],
      },
      research: [],
      sightings: [],
      // pre-confidenceFactors assessment, pre-links vinCheck:
      vinCheck: { vin: 'ZFF95NLA2M0263155', valid: true, mismatches: [], note: 'n' },
      assessment: {
        verdict: 'watch',
        confidence: 0.55,
        summary: 's',
        dealbreakers: [],
        watchItems: [],
      },
      stages: [],
      generatedAt: '2026-08-14T04:00:00.000Z',
    };
    const state = reduceRun(emptyProjection(), {
      seq: 1,
      at: new Date().toISOString(),
      event: { type: 'report', report: legacySalvage },
    });
    expect(state.salvageReport?.assessment.confidenceFactors).toEqual([]);
    expect(state.salvageReport?.vinCheck?.links).toEqual([]);
    // The exact expression that crashed: .length on the normalized field.
    expect(state.salvageReport!.assessment.confidenceFactors.length).toBe(0);
    // A task-list plan is the pre-ceiling model: the report is marked legacy
    // and its plan/ledger reduced to shapes the ceiling grammar can render.
    expect(state.salvageReport?.legacy).toBe(true);
    expect(state.salvageReport?.plan.programs).toEqual([]);
    expect(state.salvageReport?.plan.lines).toEqual([]);
    expect(state.salvageReport?.ledger).toBeUndefined();
    expect(state.salvageReport?.evidence).toEqual({ comps: [], prices: [] });
  });

  it('a ceiling-model report is not marked legacy', () => {
    const state = reduceRun(emptyProjection(), {
      seq: 1,
      at: new Date().toISOString(),
      event: {
        type: 'report',
        report: {
          lot: { id: 'x', title: 't', make: 'Ferrari', model: 'SF90', year: 2021, photos: [] },
          triage: {
            overall: 'borderline',
            areas: [],
            airbagsDeployed: 'no',
            floodEvidence: false,
            fireEvidence: false,
            drivetrainRisk: 'x',
            observations: [],
            confidence: 0.55,
          },
          plan: {
            programs: [],
            lines: [],
            diyHoursTotal: 0,
            low: 0,
            expected: 0,
            high: 0,
            tier: 'exotic',
            tierLabel: 'exotic tier',
            missed: [],
          },
          evidence: { comps: [], prices: [] },
          research: [],
          sightings: [],
          assessment: {
            verdict: 'walk',
            confidence: 0.5,
            confidenceFactors: [],
            summary: 's',
            dealbreakers: [],
            watchItems: [],
          },
          stages: [],
          generatedAt: '2026-08-17T04:00:00.000Z',
        },
      },
    });
    expect(state.salvageReport?.legacy).toBeUndefined();
  });

  it('an old inspect report without sightings or vin links normalizes the same way', () => {
    const legacyInspect = {
      vehicle: { make: 'BMW', model: 'M3', year: 2004 },
      photoCount: 3,
      analysis: {
        overallCondition: 'good',
        observations: [],
        issues: [],
        modifications: [],
        wear: [],
        confidence: 0.8,
      },
      topics: [],
      web: [],
      // no `sightings` field at all — pre-sweep reports:
      vinCheck: {
        vin: 'WBSBL93424PN58876',
        valid: true,
        decoded: { wmi: 'WBS', serial: 'N58876' },
        mismatches: [],
        note: 'n',
      },
      reliability: { modelConcerns: [], commonFailures: [], overallReliability: 'good' },
      assessment: {
        verdict: 'pass',
        confidence: 0.8,
        summary: 's',
        keyFindings: [],
        redFlags: [],
        recommendedChecks: [],
      },
      stages: [],
      generatedAt: '2026-08-13T23:00:00.000Z',
    };
    const state = reduceRun(emptyProjection(), {
      seq: 1,
      at: new Date().toISOString(),
      event: { type: 'report', report: legacyInspect },
    });
    expect(state.report?.sightings).toEqual([]);
    expect(state.report?.vinCheck?.links).toEqual([]);
  });
});

describe('stage labels', () => {
  it('names the salvage stages in the language the report uses', () => {
    expect(stageLabel('triage')).toBe('damage triage');
    expect(stageLabel('research')).toBe('parts & value');
    expect(stageLabel('ledger')).toBe('ledger');
  });

  it('falls through to the inspector labels', () => {
    expect(stageLabel('vision')).toBe('vision');
    expect(stageLabel('plan')).toBe('research plan');
    expect(stageLabel('nhtsa')).toBe('NHTSA');
    expect(stageLabel('vin')).toBe('VIN');
  });

  it('a stage neither side knows is rendered as itself, never as undefined', () => {
    expect(stageLabel('teleportation')).toBe('teleportation');
  });
});

describe('normalizeInspectorReport', () => {
  // The shape a run persisted before the sweep and the VIN links landed.
  const oldShape = {
    vehicle: { make: 'BMW', model: 'M3', year: 2004 },
    photoCount: 3,
    analysis: {
      overallCondition: 'good',
      observations: [],
      issues: [],
      modifications: [],
      wear: [],
      confidence: 0.8,
    },
    topics: [],
    web: [],
    vinCheck: { vin: 'WBSBL93424PN58876', valid: true, mismatches: [], note: 'n' },
    reliability: { modelConcerns: [], commonFailures: [], overallReliability: 'good' },
    assessment: {
      verdict: 'pass',
      confidence: 0.8,
      summary: 's',
      keyFindings: [],
      redFlags: [],
      recommendedChecks: [],
    },
    stages: [],
    generatedAt: '2026-08-13T23:00:00.000Z',
  } as unknown as InspectorReport;

  it('gives the fields added since a default instead of undefined', () => {
    const report = normalizeInspectorReport(oldShape);
    expect(report.sightings).toEqual([]);
    expect(report.vinCheck?.links).toEqual([]);
    // Everything else is the report as it was written.
    expect(report.vehicle).toEqual(oldShape.vehicle);
    expect(report.generatedAt).toBe(oldShape.generatedAt);
  });

  it('leaves a report that already has them alone', () => {
    const current = {
      ...oldShape,
      sightings: [{ title: 'listed in 2019', source: 'bringatrailer.com' }],
      vinCheck: { ...oldShape.vinCheck, links: [{ label: 'NICB', url: 'https://nicb.test' }] },
    } as unknown as InspectorReport;
    const report = normalizeInspectorReport(current);
    expect(report.sightings).toHaveLength(1);
    expect(report.vinCheck?.links).toHaveLength(1);
  });

  it('a report with no VIN at all keeps none', () => {
    const noVin = { ...oldShape, vinCheck: undefined } as unknown as InspectorReport;
    expect(normalizeInspectorReport(noVin).vinCheck).toBeUndefined();
  });

  it('normalizing twice changes nothing', () => {
    const once = normalizeInspectorReport(oldShape);
    expect(normalizeInspectorReport(once)).toEqual(once);
  });
});

describe('normalizeSalvageReport', () => {
  const triage = {
    overall: 'borderline',
    areas: [],
    airbagsDeployed: 'no',
    floodEvidence: false,
    fireEvidence: false,
    drivetrainRisk: 'x',
    observations: [],
    confidence: 0.55,
  };

  // The pre-ceiling shape: a task list for a plan, no evidence, no ledger.
  const preCeiling = {
    lot: { id: 'x', title: 't', make: 'Ferrari', model: 'SF90', year: 2021, photos: [] },
    triage,
    plan: {
      tasks: [{ label: 'front clip' }],
      diyHoursTotal: 12,
      partsLow: 1000,
      partsHigh: 2000,
      proLow: 3000,
      proHigh: 4000,
      missed: ['no underbody photos'],
    },
    assessment: {
      verdict: 'watch',
      confidence: 0.55,
      summary: 's',
      dealbreakers: [],
      watchItems: [],
    },
    stages: [],
    generatedAt: '2026-08-14T04:00:00.000Z',
  } as unknown as SalvageReport;

  const ceilingPlan = {
    programs: [],
    lines: [],
    diyHoursTotal: 0,
    low: 0,
    expected: 0,
    high: 0,
    tier: 'exotic',
    tierLabel: 'exotic tier',
    missed: [],
  };

  it('marks a task-list plan legacy and empties what the ceiling grammar cannot render', () => {
    const report = normalizeSalvageReport(preCeiling);
    expect(report.legacy).toBe(true);
    expect(report.plan.programs).toEqual([]);
    expect(report.plan.lines).toEqual([]);
    expect(report.ledger).toBeUndefined();
    expect(report.plan.tierLabel).toBe('legacy report');
    // What the old plan did say about its own gaps is kept.
    expect(report.plan.missed).toEqual(['no underbody photos']);
    expect(report.evidence).toEqual({ comps: [], prices: [] });
    expect(report.research).toEqual([]);
    expect(report.sightings).toEqual([]);
    expect(report.assessment.confidenceFactors).toEqual([]);
  });

  it('a ceiling plan without typed evidence is legacy too: the ledger cannot be trusted', () => {
    const noEvidence = {
      ...preCeiling,
      plan: ceilingPlan,
      ledger: { ceiling: 42_000, killers: [] },
    } as unknown as SalvageReport;
    const report = normalizeSalvageReport(noEvidence);
    expect(report.legacy).toBe(true);
    expect(report.ledger).toBeUndefined();
  });

  it('a current report is untouched and never marked legacy', () => {
    const ledger = { ceiling: 42_000, breakEven: 50_000, stress: 30_000, killers: [] };
    const current = {
      ...preCeiling,
      plan: ceilingPlan,
      evidence: { comps: [{ price: 1 }], prices: [] },
      research: [{ topic: 'parts' }],
      sightings: [{ title: 'auction listing' }],
      assessment: { ...preCeiling.assessment, confidenceFactors: [{ label: 'two comps' }] },
      ledger,
    } as unknown as SalvageReport;
    const report = normalizeSalvageReport(current);
    expect(report.legacy).toBeUndefined();
    expect(report.plan).toBe(ceilingPlan);
    expect(report.ledger).toBe(ledger);
    expect(report.evidence.comps).toHaveLength(1);
    expect(report.assessment.confidenceFactors).toHaveLength(1);
  });

  it('normalizing twice changes nothing', () => {
    const once = normalizeSalvageReport(preCeiling);
    expect(normalizeSalvageReport(once)).toEqual(once);
  });
});
