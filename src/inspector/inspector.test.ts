import { afterEach, describe, expect, test, vi } from 'vitest';
import { userFacingReason } from '@/lib/failure';
import {
  inspectCar,
  inspectCarStream,
  synthesizeAssessment,
  type InspectorDeps,
} from './inspector';
import type { InspectEvent, InspectorInput, PhotoAnalysis, ReliabilityReport } from './types';

// Raw vision output as the model would return it through the forced tool
// call — deps mock the CALLER, so the zod validation path runs in every test.
const RAW_CLEAN = {
  observations: [
    { photo: 0, note: 'front three-quarter, straight panels' },
    { photo: 1, note: 'engine bay appears stock and dry' },
  ],
  overallCondition: 'excellent',
  issues: [],
  modifications: [],
  wear: [],
  confidence: 0.9,
};

const RAW_RUSTY = {
  observations: [{ photo: 1, note: 'bubbling paint at rear arch' }],
  overallCondition: 'fair',
  issues: [
    {
      type: 'rust',
      severity: 'high',
      description: 'rust bubbling at rear wheel arches',
      location: 'rear arches',
      photos: [1],
    },
  ],
  modifications: [],
  wear: [],
  confidence: 0.82,
};

const M3_INPUT: InspectorInput = {
  photos: [
    { kind: 'url', url: 'https://example.com/a.jpg' },
    { kind: 'url', url: 'https://example.com/b.jpg' },
  ],
  make: 'BMW',
  model: 'M3',
  year: 2004,
  vin: 'WBSBL93424PN58876',
  askingPrice: 30000,
  listing: {
    title: 'Original-Owner 2004 BMW M3 Coupe',
    url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/',
    source: 'ebay',
    condition: 'Used',
  },
};

// NHTSA fake fetcher speaking the real endpoint shapes.
const nhtsaFetcher = (complaints: { components: string; count: number }[]) => {
  let odi = 0;
  return vi.fn(async (url: string) => {
    if (url.includes('/products/vehicle/models')) {
      return { results: [{ make: 'BMW', model: 'M3' }] };
    }
    if (url.includes('complaintsByVehicle')) {
      return {
        results: complaints.flatMap((c) =>
          Array.from({ length: c.count }, () => ({
            odiNumber: ++odi,
            components: c.components,
            summary: 'owner complaint',
            crash: false,
            fire: false,
          })),
        ),
      };
    }
    return { results: [] }; // recalls
  });
};

function deps(overrides: Partial<InspectorDeps> = {}): InspectorDeps {
  return {
    visionCaller: vi.fn().mockResolvedValue(RAW_CLEAN),
    webCaller: null,
    sweepCaller: null, // offline by default; provenance tests inject one
    nhtsaFetcher: nhtsaFetcher([]),
    vpicFetcher: null, // offline by default; vPIC-specific tests inject one
    photoProbe: null, // offline by default; pre-flight tests inject one
    vinHistory: null,
    ...overrides,
  };
}

async function collect(input: InspectorInput, d: InspectorDeps): Promise<InspectEvent[]> {
  const events: InspectEvent[] = [];
  for await (const event of inspectCarStream(input, d)) events.push(event);
  return events;
}

const stagesOf = (events: InspectEvent[]) =>
  events.flatMap((e) => (e.type === 'stage' ? [e.status] : []));

afterEach(() => vi.unstubAllEnvs());

describe('event stream shape', () => {
  test('a full run streams observations, findings, and ends with the report', async () => {
    const events = await collect(M3_INPUT, deps());
    const types = events.map((e) => e.type);

    // Photos observations arrive before the analysis, report is last.
    expect(types.indexOf('photo')).toBeLessThan(types.indexOf('analysis'));
    expect(types[types.length - 1]).toBe('report');
    expect(types).not.toContain('fatal');

    // Every stage that ran reported a status, and they landed in the report.
    const report = events.at(-1)!;
    if (report.type !== 'report') throw new Error('unreachable');
    const stageNames = report.report.stages.map((s) => s.stage);
    for (const stage of ['vision', 'reliability', 'plan', 'nhtsa', 'vin', 'market', 'synthesis']) {
      expect(stageNames).toContain(stage);
    }
  });

  test('photo observation events carry valid indices for the UI to anchor', async () => {
    const events = await collect(M3_INPUT, deps());
    for (const e of events) {
      if (e.type === 'photo') {
        expect(e.index).toBeGreaterThanOrEqual(0);
        expect(e.index).toBeLessThan(M3_INPUT.photos.length);
      }
    }
  });

  test('the report never echoes photo bytes back', async () => {
    const input: InspectorInput = {
      ...M3_INPUT,
      photos: [{ kind: 'upload', mediaType: 'image/jpeg', data: 'QkFTRTY0UEhPVE9CWVRFUw==' }],
    };
    const report = await inspectCar(input, deps());
    expect(report.photoCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain('QkFTRTY0UEhPVE9CWVRFUw');
  });
});

describe('dynamic research decisions', () => {
  test('a clean car with no weak points plans nothing and skips web research', async () => {
    const d = deps({
      reliability: () => ({ modelConcerns: [], commonFailures: [], overallReliability: 'good' }),
    });
    const events = await collect({ ...M3_INPUT, make: 'Lexus', model: 'ES350', year: 2019 }, d);
    const plan = events.find((e) => e.type === 'plan');
    if (plan?.type !== 'plan') throw new Error('no plan event');
    expect(plan.topics).toEqual([]);
    expect(stagesOf(events).find((s) => s.stage === 'web')).toMatchObject({
      ok: true,
      detail: expect.stringContaining('skipped'),
    });
  });

  test('rust in the photos changes the research plan — same car, different path', async () => {
    const webCaller = vi.fn().mockResolvedValue({
      findings: [
        {
          topic: 'rust',
          summary: 'E46 rear arch rust spreads under the seam sealer',
          severity: 'concern',
          costEstimate: '$1,500-3,000',
          sources: [{ url: 'https://www.m3forum.net/threads/arch-rust.123/', title: 'Arch rust' }],
        },
      ],
    });
    // Reliability held empty in both runs so the only variable is the photos.
    const noReliability = (): ReliabilityReport => ({
      modelConcerns: [],
      commonFailures: [],
      overallReliability: 'good',
    });
    const cleanEvents = await collect(M3_INPUT, deps({ webCaller, reliability: noReliability }));
    expect(webCaller).not.toHaveBeenCalled(); // nothing to research on a clean car
    const cleanPlan = cleanEvents.find((e) => e.type === 'plan');
    if (cleanPlan?.type !== 'plan') throw new Error('no plan');
    expect(cleanPlan.topics).toEqual([]);

    const rustyEvents = await collect(
      M3_INPUT,
      deps({
        visionCaller: vi.fn().mockResolvedValue(RAW_RUSTY),
        webCaller,
        reliability: noReliability,
      }),
    );
    const rustyPlan = rustyEvents.find((e) => e.type === 'plan');
    if (rustyPlan?.type !== 'plan') throw new Error('no plan');
    expect(rustyPlan.topics.some((t) => t.topic.includes('rust'))).toBe(true);
    expect(rustyPlan.topics.length).toBeGreaterThan(cleanPlan.topics.length);

    // The web agent ran with the listing identity and produced a cited finding event.
    expect(webCaller).toHaveBeenCalled();
    const callInput = webCaller.mock.calls[0][0];
    expect(callInput.vehicleLabel).toBe('2004 BMW M3');
    expect(callInput.listingLine).toContain('Original-Owner 2004 BMW M3 Coupe');
    expect(callInput.listingLine).toContain('$30,000');
    const webEvents = rustyEvents.filter((e) => e.type === 'web');
    expect(webEvents).toHaveLength(1);
  });

  test('web progress notes stream while the research promise is still pending', async () => {
    const webCaller = vi.fn(
      (_input: unknown, onProgress?: (note: string) => void) =>
        new Promise((resolve) => {
          onProgress?.('searching: e46 m3 rear arch rust');
          onProgress?.('searching: e46 subframe crack repair cost');
          setTimeout(() => resolve({ findings: [] }), 5);
        }),
    );
    const events = await collect(
      M3_INPUT,
      deps({ visionCaller: vi.fn().mockResolvedValue(RAW_RUSTY), webCaller }),
    );
    const thoughts = events.filter((e) => e.type === 'thought' && e.stage === 'web');
    expect(thoughts.map((t) => (t.type === 'thought' ? t.text : ''))).toEqual([
      'searching: e46 m3 rear arch rust',
      'searching: e46 subframe crack repair cost',
    ]);
  });
});

describe('stage isolation — every failure is visible, none is fatal except vision', () => {
  test('NHTSA network failure degrades its stage; the report still lands', async () => {
    const d = deps({ nhtsaFetcher: vi.fn().mockRejectedValue(new Error('NHTSA timeout')) });
    const events = await collect(M3_INPUT, d);
    expect(stagesOf(events).find((s) => s.stage === 'nhtsa')).toMatchObject({
      ok: false,
      detail: userFacingReason('timeout'),
    });
    expect(events.at(-1)?.type).toBe('report');
  });

  test('a vehicle with no comps degrades the market stage visibly', async () => {
    const events = await collect(
      { ...M3_INPUT, make: 'Lexus', model: 'ES350', year: 2019 },
      deps(),
    );
    expect(stagesOf(events).find((s) => s.stage === 'market')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('no comps'),
    });
  });

  test('web agent failure degrades the web stage; findings stay empty', async () => {
    const d = deps({
      visionCaller: vi.fn().mockResolvedValue(RAW_RUSTY),
      webCaller: vi.fn().mockRejectedValue(new Error('search quota exhausted')),
    });
    const events = await collect(M3_INPUT, d);
    expect(stagesOf(events).find((s) => s.stage === 'web')).toMatchObject({
      ok: false,
      detail: userFacingReason('unknown'),
    });
    const report = events.at(-1);
    if (report?.type !== 'report') throw new Error('no report');
    expect(report.report.web).toEqual([]);
  });

  test('vision failure is fatal and said plainly', async () => {
    const d = deps({ visionCaller: vi.fn().mockRejectedValue(new Error('images unreachable')) });
    const events = await collect(M3_INPUT, d);
    expect(events.at(-1)).toMatchObject({
      type: 'fatal',
      message: `Photo analysis failed: ${userFacingReason('unknown')}`,
    });
    await expect(inspectCar(M3_INPUT, d)).rejects.toThrow(/Photo analysis failed/);
  });

  test('a model SDK error never reaches the stream or the fatal message', async () => {
    const sdkError = Object.assign(
      new Error('429 rate_limit_error request_id=req_011CQ... key sk-ant-api03-XYZ'),
      { name: 'RateLimitError', status: 429 },
    );
    const events = await collect(
      M3_INPUT,
      deps({ visionCaller: vi.fn().mockRejectedValue(sdkError) }),
    );
    expect(JSON.stringify(events)).not.toContain('sk-ant');
    expect(JSON.stringify(events)).not.toContain('req_011CQ');
    expect(events.at(-1)).toMatchObject({
      type: 'fatal',
      message: `Photo analysis failed: ${userFacingReason('model')}`,
    });
  });

  test('missing ANTHROPIC_API_KEY refuses honestly instead of mocking a result', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const events = await collect(M3_INPUT, { webCaller: null });
    expect(events.at(-1)).toMatchObject({
      type: 'fatal',
      message: expect.stringContaining('ANTHROPIC_API_KEY'),
    });
  });
});

describe('synthesis', () => {
  const analysis = (over: Partial<PhotoAnalysis>): PhotoAnalysis => ({
    overallCondition: 'good',
    observations: [],
    issues: [],
    modifications: [],
    wear: [],
    confidence: 0.85,
    ...over,
  });
  const noReliability = {
    modelConcerns: [],
    commonFailures: [],
    overallReliability: 'good' as const,
  };

  test('critical issue → avoid', () => {
    const a = synthesizeAssessment(
      analysis({
        issues: [
          { type: 'frame_damage', severity: 'critical', description: 'bent rail', photos: [0] },
        ],
      }),
      [],
      undefined,
      undefined,
      noReliability,
      undefined,
    );
    expect(a.verdict).toBe('avoid');
    expect(a.redFlags[0]).toContain('bent rail');
    expect(a.recommendedChecks.some((c) => c.includes('frame'))).toBe(true);
  });

  test('VIN mismatch → avoid even on a clean car', async () => {
    const events = await collect({ ...M3_INPUT, vin: 'WP0AA2997XS625539' }, deps());
    const report = events.at(-1);
    if (report?.type !== 'report') throw new Error('no report');
    expect(report.report.assessment.verdict).toBe('avoid');
    expect(report.report.assessment.redFlags.some((f) => f.startsWith('VIN:'))).toBe(true);
    expect(stagesOf(events).find((s) => s.stage === 'vin')?.ok).toBe(false);
  });

  test('clean car passes with market context in the summary', async () => {
    const report = await inspectCar(M3_INPUT, deps());
    expect(report.assessment.verdict).toBe('pass');
    expect(report.assessment.summary).toContain('$30,000');
    expect(report.market?.asking).toBe(30000);
    expect(report.market?.sampleSize).toBeGreaterThanOrEqual(5);
    // The subject's own auction is excluded from its comps.
    expect(report.market?.comps.every((c) => c.url !== M3_INPUT.listing?.url)).toBe(true);
  });

  test('cited web cost estimates become budget lines in recommended checks', () => {
    const a = synthesizeAssessment(
      analysis({
        issues: [{ type: 'rust', severity: 'high', description: 'arch rust', photos: [] }],
      }),
      [
        {
          topic: 'arch rust repair',
          summary: 'proper arch repair means cutting and welding',
          severity: 'concern',
          costEstimate: '$1,500-3,000',
          sources: [{ url: 'https://forum.example/1', title: 't' }],
        },
      ],
      undefined,
      undefined,
      noReliability,
      undefined,
    );
    expect(a.verdict).toBe('caution');
    expect(a.recommendedChecks.some((c) => c.includes('$1,500-3,000'))).toBe(true);
    expect(a.keyFindings).toContain('proper arch repair means cutting and welding');
  });

  test('NHTSA matches land in key findings', async () => {
    const d = deps({
      visionCaller: vi.fn().mockResolvedValue(RAW_RUSTY),
      nhtsaFetcher: nhtsaFetcher([{ components: 'STRUCTURE', count: 7 }]),
    });
    const report = await inspectCar(M3_INPUT, d);
    expect(report.nhtsa?.matchedIssues).toEqual([
      { issueType: 'rust', component: 'STRUCTURE', count: 7 },
    ]);
    expect(report.assessment.keyFindings.some((f) => f.includes('7'))).toBe(true);
  });
});

describe('vPIC federal decode in the pipeline', () => {
  const vpicRow = (over: Record<string, string> = {}) => ({
    Results: [{ Make: 'BMW', Model: 'M3', ModelYear: '2004', BodyClass: 'Coupe', ...over }],
  });

  test('a matching federal decode enriches the check without mismatches', async () => {
    const events = await collect(M3_INPUT, deps({ vpicFetcher: async () => vpicRow() }));
    const vin = events.find((e) => e.type === 'vin');
    if (vin?.type !== 'vin') throw new Error('no vin event');
    expect(vin.check.decoded?.model).toBe('M3');
    expect(vin.check.decoded?.bodyClass).toBe('Coupe');
    expect(vin.check.mismatches).toEqual([]);
    expect(vin.check.note).toMatch(/NOT checked/);
  });

  test('a federal identity mismatch is a red flag and forces avoid', async () => {
    const events = await collect(
      M3_INPUT,
      deps({ vpicFetcher: async () => vpicRow({ Make: 'HONDA', Model: 'CIVIC' }) }),
    );
    const report = events.at(-1);
    if (report?.type !== 'report') throw new Error('no report');
    expect(report.report.vinCheck?.mismatches.some((m) => m.includes('vPIC'))).toBe(true);
    expect(report.report.assessment.verdict).toBe('avoid');
  });

  test('vPIC being unreachable degrades to the structural decode, visibly', async () => {
    const events = await collect(
      M3_INPUT,
      deps({
        vpicFetcher: async () => {
          throw new Error('timeout');
        },
      }),
    );
    const vin = events.find((e) => e.type === 'vin');
    if (vin?.type !== 'vin') throw new Error('no vin event');
    expect(vin.check.valid).toBe(true);
    expect(vin.check.note).toMatch(/unreachable/);
    expect(stagesOf(events).find((s) => s.stage === 'vin')?.ok).toBe(true);
  });
});

describe('begin events and trace spans', () => {
  test('every stage announces begin before its status lands', async () => {
    const events = await collect(M3_INPUT, deps());
    for (const stage of [
      'vision',
      'reliability',
      'plan',
      'nhtsa',
      'web',
      'vin',
      'market',
      'synthesis',
    ] as const) {
      const beginAt = events.findIndex((e) => e.type === 'begin' && e.stage === stage);
      const statusAt = events.findIndex((e) => e.type === 'stage' && e.status.stage === stage);
      expect(beginAt, `begin for ${stage}`).toBeGreaterThanOrEqual(0);
      expect(beginAt, `begin(${stage}) precedes status`).toBeLessThan(statusAt);
    }
  });

  test('model and fetch calls stream spans with timings', async () => {
    const events = await collect(M3_INPUT, deps());
    const spans = events.flatMap((e) => (e.type === 'span' ? [e.span] : []));
    const names = spans.map((s) => s.name);
    expect(names).toContain('vision: photo analysis');
    expect(names).toContain('nhtsa: complaints + recalls');
    for (const span of spans) {
      expect(span.ms).toBeGreaterThanOrEqual(0);
      expect(typeof span.ok).toBe('boolean');
    }
  });

  test('spans still stream when a stage fails', async () => {
    const events = await collect(
      M3_INPUT,
      deps({ visionCaller: vi.fn().mockRejectedValue(new Error('model down')) }),
    );
    const spans = events.flatMap((e) => (e.type === 'span' ? [e.span] : []));
    expect(spans.find((s) => s.name === 'vision: photo analysis')?.ok).toBe(false);
    expect(events.some((e) => e.type === 'fatal')).toBe(true);
  });
});

describe('VIN provenance sweep', () => {
  test('cited sightings stream, land in the report, and exclude the subject listing', async () => {
    const sweepCaller = vi.fn(async (_input: unknown, onProgress?: (n: string) => void) => {
      onProgress?.('searching: "WBSBL93424PN58876"');
      return {
        sightings: [
          {
            url: 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/',
            title: 'the subject listing itself',
          },
          {
            url: 'https://www.m3post.com/forums/showthread.php?t=99',
            title: 'FS: 2004 M3 coupe, 30k miles',
            date: 'March 2024',
            note: 'asked $38,500',
          },
          { url: 'not-a-url', title: 'uncited garbage' },
        ],
      };
    });
    const events = await collect(M3_INPUT, deps({ sweepCaller }));

    // The search query streamed as a vin-stage thought.
    expect(
      events.some(
        (e) => e.type === 'thought' && e.stage === 'vin' && e.text.includes('searching:'),
      ),
    ).toBe(true);

    const sightings = events.find((e) => e.type === 'sightings');
    if (sightings?.type !== 'sightings') throw new Error('no sightings event');
    // Subject listing excluded, uncited entry dropped, host derived.
    expect(sightings.sightings).toHaveLength(1);
    expect(sightings.sightings[0]).toMatchObject({
      source: 'm3post.com',
      date: 'March 2024',
      note: 'asked $38,500',
    });

    const report = events.at(-1);
    if (report?.type !== 'report') throw new Error('no report');
    expect(report.report.sightings).toHaveLength(1);
  });

  test('a failed sweep degrades to a visible note without touching the VIN verdict', async () => {
    const events = await collect(
      M3_INPUT,
      deps({
        sweepCaller: vi.fn().mockRejectedValue(new Error('search quota')),
      }),
    );
    expect(
      events.some(
        (e) => e.type === 'thought' && e.stage === 'vin' && e.text.includes('sweep failed'),
      ),
    ).toBe(true);
    expect(stagesOf(events).find((s) => s.stage === 'vin')?.ok).toBe(true);
    const report = events.at(-1);
    if (report?.type !== 'report') throw new Error('no report');
    expect(report.report.sightings).toEqual([]);
  });
});

describe('photo pre-flight', () => {
  test('dead urls are dropped visibly and anchors remap to original indices', async () => {
    // Probe kills photo 0; the model sees ONE photo and anchors to subset
    // index 0 — the report must anchor to original index 1.
    const rawSubset = {
      observations: [{ photo: 0, note: 'bubbling paint at rear arch' }],
      overallCondition: 'fair',
      issues: [
        {
          type: 'rust',
          severity: 'high',
          description: 'rust bubbling at rear wheel arches',
          location: 'rear arches',
          photos: [0],
        },
      ],
      modifications: [],
      wear: [],
      confidence: 0.82,
    };
    const visionCaller = vi.fn().mockResolvedValue(rawSubset);
    const events = await collect(
      M3_INPUT,
      deps({
        visionCaller,
        photoProbe: vi.fn(async (url: string) => !url.endsWith('a.jpg')),
      }),
    );
    // The vision caller only received the reachable photo.
    const visionInput = visionCaller.mock.calls[0][0] as { photos: unknown[] };
    expect(visionInput.photos).toHaveLength(1);
    // The drop is a named, visible decision.
    expect(
      events.some(
        (e) => e.type === 'thought' && e.stage === 'vision' && e.text.includes('unreachable'),
      ),
    ).toBe(true);
    // Anchors point at the ORIGINAL filmstrip position.
    const photoEvent = events.find((e) => e.type === 'photo');
    if (photoEvent?.type !== 'photo') throw new Error('no photo event');
    expect(photoEvent.index).toBe(1);
    const report = events.at(-1);
    if (report?.type !== 'report') throw new Error('no report');
    expect(report.report.analysis.issues[0].photos).toEqual([1]);
  });

  test('zero reachable photos is a fatal with a plain-language message', async () => {
    const events = await collect(M3_INPUT, deps({ photoProbe: vi.fn(async () => false) }));
    const fatal = events.find((e) => e.type === 'fatal');
    if (fatal?.type !== 'fatal') throw new Error('expected fatal');
    expect(fatal.message).toMatch(/reachable/i);
    expect(events.some((e) => e.type === 'report')).toBe(false);
  });

  test('uploads bypass the probe entirely', async () => {
    const probe = vi.fn(async () => false);
    const input: InspectorInput = {
      ...M3_INPUT,
      photos: [{ kind: 'upload', mediaType: 'image/jpeg', data: 'aGk=' }],
    };
    const events = await collect(input, deps({ photoProbe: probe }));
    expect(probe).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'report')).toBe(true);
  });
});
