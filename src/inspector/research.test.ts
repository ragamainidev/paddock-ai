import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { NhtsaEnrichment } from '@/enrich/nhtsa';
import { failureReason, userFacingReason } from '@/lib/failure';
import {
  defaultVinSweepCaller,
  isEmptyReport,
  narrowNhtsa,
  needsCitationNudge,
  parseVinSightings,
  parseWebFindings,
  planResearchTopics,
  runWebResearch,
  SWEEP_BUDGET_MS,
  topicTag,
} from './research';
import type { PhotoAnalysis, ReliabilityReport } from './types';

const VEHICLE = { make: 'BMW', model: 'M3', year: 2004 };

const CLEAN_ANALYSIS: PhotoAnalysis = {
  overallCondition: 'excellent',
  observations: [],
  issues: [],
  modifications: [],
  wear: [],
  confidence: 0.9,
};

const NO_RELIABILITY: ReliabilityReport = {
  modelConcerns: [],
  commonFailures: [],
  overallReliability: 'good',
};

describe('planResearchTopics — the agent decides dynamically', () => {
  test('a clean car with no known weak points needs no research', () => {
    expect(planResearchTopics(CLEAN_ANALYSIS, NO_RELIABILITY, VEHICLE)).toEqual([]);
  });

  test('detected rust produces a topic whose reason cites the photo finding', () => {
    const analysis: PhotoAnalysis = {
      ...CLEAN_ANALYSIS,
      issues: [
        {
          type: 'rust',
          severity: 'medium',
          description: 'bubbling at rear arches',
          location: 'rear arches',
          photos: [1],
        },
      ],
    };
    const topics = planResearchTopics(analysis, NO_RELIABILITY, VEHICLE);
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toContain('rust');
    expect(topics[0].topic).toContain('2004 BMW M3');
    expect(topics[0].reason).toContain('bubbling at rear arches');
  });

  test('low-severity cosmetic issues are not researched', () => {
    const analysis: PhotoAnalysis = {
      ...CLEAN_ANALYSIS,
      issues: [
        { type: 'paint_issue', severity: 'low', description: 'swirl marks', photos: [0] },
        { type: 'paint_issue', severity: 'medium', description: 'clearcoat peel', photos: [0] },
      ],
    };
    expect(planResearchTopics(analysis, NO_RELIABILITY, VEHICLE)).toEqual([]);
  });

  test('budget and unknown-quality modifications are researched; quality ones are not', () => {
    const analysis: PhotoAnalysis = {
      ...CLEAN_ANALYSIS,
      modifications: [
        {
          type: 'suspension',
          description: 'no-name coilovers',
          quality: 'budget_aftermarket',
          photos: [0],
        },
        { type: 'exhaust', description: 'OEM exhaust', quality: 'oem', photos: [0] },
        { type: 'engine_mods', description: 'unlabeled intake', quality: 'unknown', photos: [0] },
      ],
    };
    const topics = planResearchTopics(analysis, NO_RELIABILITY, VEHICLE);
    expect(topics).toHaveLength(2);
    expect(topics.map((t) => t.topic).join(' ')).not.toContain('exhaust');
  });

  test('common known failure points get verified even on a clean car', () => {
    const reliability: ReliabilityReport = {
      modelConcerns: [
        {
          component: 'rear subframe',
          description: 'mounting points crack',
          affectedYears: [2004],
          frequency: 'very_common',
        },
        {
          component: 'booster',
          description: 'rare failure',
          affectedYears: [2004],
          frequency: 'rare',
        },
      ],
      commonFailures: [],
      overallReliability: 'fair',
    };
    const topics = planResearchTopics(CLEAN_ANALYSIS, reliability, VEHICLE);
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toContain('rear subframe');
    expect(topics[0].reason).toContain('known');
  });

  test('critical issues outrank everything and the list is capped at 5', () => {
    const analysis: PhotoAnalysis = {
      ...CLEAN_ANALYSIS,
      issues: [
        { type: 'rust', severity: 'high', description: 'a', photos: [0] },
        { type: 'fluid_leak', severity: 'high', description: 'b', photos: [0] },
        { type: 'frame_damage', severity: 'critical', description: 'c', photos: [0] },
        { type: 'tire_wear', severity: 'high', description: 'd', photos: [0] },
      ],
      modifications: [
        { type: 'suspension', description: 'e', quality: 'budget_aftermarket', photos: [0] },
        { type: 'engine_mods', description: 'f', quality: 'unknown', photos: [0] },
      ],
    };
    const topics = planResearchTopics(analysis, NO_RELIABILITY, VEHICLE);
    expect(topics).toHaveLength(5);
    expect(topics[0].topic).toContain('frame damage');
  });
});

describe('parseWebFindings — no uncited claims survive', () => {
  const finding = (sources: { url: string; title: string }[]) => ({
    findings: [{ topic: 't', summary: 's', severity: 'concern', sources }],
  });

  test('findings with a real source URL pass', () => {
    const out = parseWebFindings(
      finding([{ url: 'https://www.m3forum.net/thread/1', title: 'Subframe thread' }]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].sources[0].url).toContain('m3forum');
  });

  test('findings with no sources are discarded', () => {
    expect(parseWebFindings(finding([]))).toEqual([]);
  });

  test('non-http sources are stripped; finding dies if none remain', () => {
    expect(
      parseWebFindings({
        findings: [
          {
            topic: 't',
            summary: 's',
            severity: 'info',
            sources: [{ url: 'ftp://x.com/a', title: 'nope' }],
          },
        ],
      }),
    ).toEqual([]);
  });

  test('malformed output throws for the orchestrator to degrade on', () => {
    expect(() => parseWebFindings({ findings: [{ topic: 't' }] })).toThrow(/validation/);
    expect(() => parseWebFindings('nonsense')).toThrow(/validation/);
  });
});

describe('validation messages are written for the reader', () => {
  // These name what went wrong in our own vocabulary, so `failureReason`
  // has to keep the wording instead of replacing it with a fixed reason.
  test('both parsers state their own failure', () => {
    for (const parse of [() => parseWebFindings('nonsense'), () => parseVinSightings('nonsense')]) {
      try {
        parse();
        expect.unreachable('the parser accepted malformed output');
      } catch (error) {
        expect(failureReason(error)).toMatch(/failed validation/);
        expect(failureReason(error)).not.toBe(userFacingReason('unknown'));
      }
    }
  });
});

describe('runWebResearch', () => {
  test('passes vehicle label, listing line, and topics to the injected caller', async () => {
    const caller = vi.fn().mockResolvedValue({ findings: [] });
    const topics = [{ topic: 'rust', reason: 'photos show rust', priority: 8 }];
    await runWebResearch(
      VEHICLE,
      topics,
      caller,
      undefined,
      '"Original-Owner M3" — asking $49,000',
    );
    expect(caller).toHaveBeenCalledWith(
      {
        vehicleLabel: '2004 BMW M3',
        listingLine: '"Original-Owner M3" — asking $49,000',
        topics,
      },
      undefined,
    );
  });

  test('no topics means no call at all', async () => {
    const caller = vi.fn();
    expect(await runWebResearch(VEHICLE, [], caller)).toEqual([]);
    expect(caller).not.toHaveBeenCalled();
  });
});

describe('isEmptyReport — the one-shot push-back trigger', () => {
  test('a well-formed empty findings list is the push-back case', () => {
    expect(isEmptyReport({ findings: [] })).toBe(true);
  });

  test('reports with findings (cited or not) are not empty', () => {
    expect(
      isEmptyReport({
        findings: [{ topic: 't', summary: 's', severity: 'info', sources: [] }],
      }),
    ).toBe(false);
  });

  test('malformed output is not the empty case — that path belongs to the citation nudge', () => {
    expect(isEmptyReport('nonsense')).toBe(false);
    expect(isEmptyReport({ findings: 'not-an-array' })).toBe(false);
  });
});

describe('topicTag — console lane names for parallel workers', () => {
  const label = '2021 Ferrari SF90 Stradale';

  test('inspector topics derive a short lane from the topic itself', () => {
    const tag = topicTag('2004 BMW M3 rust rear arches repair cost and severity', '2004 BMW M3');
    expect(tag.length).toBeLessThanOrEqual(16);
    expect(tag).toBe('rust rear');
  });

  test('a topic that is only the vehicle label still yields a tag', () => {
    expect(topicTag(label, label)).toBe('topic');
  });
});

describe('parseVinSightings — a sighting without a source is not a sighting', () => {
  const SUBJECT = 'https://bringatrailer.com/listing/2004-bmw-m3-coupe-247/';

  test('cited sightings survive with the host derived from the URL', () => {
    const out = parseVinSightings({
      sightings: [
        {
          url: 'https://www.m3post.com/forums/showthread.php?t=99',
          title: 'FS: 2004 M3 coupe',
          date: 'March 2024',
          note: 'asked $38,500',
        },
      ],
    });
    expect(out).toEqual([
      {
        url: 'https://www.m3post.com/forums/showthread.php?t=99',
        title: 'FS: 2004 M3 coupe',
        source: 'm3post.com',
        date: 'March 2024',
        note: 'asked $38,500',
      },
    ]);
  });

  test('uncited and non-http entries drop; the subject listing is never its own sighting', () => {
    const out = parseVinSightings(
      {
        sightings: [
          { url: SUBJECT, title: 'the listing the buyer already has open' },
          { url: 'not-a-url', title: 'uncited garbage' },
          { url: 'ftp://archive.example/vin', title: 'wrong scheme' },
          { url: 'https://poctra.com/lot/1', title: 'salvage result' },
        ],
      },
      SUBJECT,
    );
    expect(out.map((s) => s.url)).toEqual(['https://poctra.com/lot/1']);
  });

  test('no history found is an honest empty result, not a failure', () => {
    expect(parseVinSightings({ sightings: [] })).toEqual([]);
    expect(parseVinSightings({})).toEqual([]);
  });

  test('malformed output throws for the orchestrator to degrade on', () => {
    expect(() => parseVinSightings('nonsense')).toThrow(/failed validation/);
    expect(() => parseVinSightings({ sightings: [{ url: 'https://x.com/1' }] })).toThrow(
      /failed validation/,
    );
  });

  test('an unparseable URL that still passes the http filter keeps its own text as the source', () => {
    const out = parseVinSightings({ sightings: [{ url: 'https://', title: 'broken host' }] });
    expect(out[0].source).toBe('https://');
  });
});

describe('needsCitationNudge — one repair turn, only when it can help', () => {
  const cited = {
    findings: [
      {
        topic: 't',
        summary: 's',
        severity: 'concern',
        sources: [{ url: 'https://www.m3forum.net/thread/1', title: 'thread' }],
      },
    ],
  };

  test('findings that cite nothing usable are worth one repair turn', () => {
    expect(needsCitationNudge({ findings: [{ ...cited.findings[0], sources: [] }] })).toBe(true);
    expect(
      needsCitationNudge({
        findings: [{ ...cited.findings[0], sources: [{ url: 'forum thread', title: 't' }] }],
      }),
    ).toBe(true);
  });

  test('a report with one cited finding is accepted as it stands', () => {
    expect(needsCitationNudge(cited)).toBe(false);
  });

  test('an honestly empty report is not a citation problem', () => {
    expect(needsCitationNudge({ findings: [] })).toBe(false);
  });

  test('malformed output is worth the same one attempt', () => {
    expect(needsCitationNudge('nonsense')).toBe(true);
    expect(needsCitationNudge({ findings: [{ topic: 't' }] })).toBe(true);
    expect(needsCitationNudge(null)).toBe(true);
  });
});

// The sweep is the one default caller with a client of its own, so its two
// silent outcomes are tested against a scripted SDK rather than the network.
// The loop names which stop it took; only `out-of-time` is an honest empty
// result, and a worker that never reported is a failure whatever the clock
// says when its last turn ends.
const sdk = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: sdk.stream };
  },
}));

describe('defaultVinSweepCaller — an exhausted budget is not a failed sweep', () => {
  const SWEPT = { vin: 'WBSBL93424PN58876', vehicleLabel: '2004 BMW M3' };
  let now = 1_700_000_000_000;

  // A turn that answers without calling the report tool, spending `spent` of
  // the budget: the loop appends its nudge and tries again if there is room.
  const turnSpending = (spent: number) => () => ({
    controller: { abort: () => {} },
    on: () => {},
    finalMessage: async () => {
      now += spent;
      return { content: [], stop_reason: 'end_turn' };
    },
  });

  beforeEach(() => {
    now = 1_700_000_000_000;
    sdk.stream.mockReset();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  test("a turn that ends inside the loop's early-exit window reports no history", async () => {
    // The loop refuses to start a turn it cannot finish, so it stops
    // `out-of-time` with 3 s on the clock — the budget, not silence.
    sdk.stream.mockImplementation(turnSpending(SWEEP_BUDGET_MS - 3_000));
    await expect(defaultVinSweepCaller(SWEPT)).resolves.toEqual({ sightings: [] });
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  test('a worker that burns every turn with time to spare is a failure the stage states', async () => {
    sdk.stream.mockImplementation(turnSpending(10));
    await expect(defaultVinSweepCaller(SWEPT)).rejects.toThrow(/never called report_vin_sightings/);
    expect(sdk.stream).toHaveBeenCalledTimes(4);
  });

  test('four turns without a report near the deadline is a stated failure, not an empty history', async () => {
    // Four turns of 14 s spend 56 s of the 60 s budget, so the loop exhausts
    // its turns with 4 s left — inside the early-exit window, yet nothing
    // about the clock makes a silent worker's answer "no history found".
    sdk.stream.mockImplementation(turnSpending(14_000));
    await expect(defaultVinSweepCaller(SWEPT)).rejects.toThrow(/never called report_vin_sightings/);
    expect(sdk.stream).toHaveBeenCalledTimes(4);
  });
});

describe('narrowNhtsa — federal data scoped to what the photos showed', () => {
  const enrichment: NhtsaEnrichment = {
    mapping: { make: 'BMW', models: ['M3'] },
    complaints: Array.from({ length: 12 }, (_, i) => ({
      odiNumber: i,
      components: i < 8 ? 'SUSPENSION' : 'ENGINE',
      summary: 'complaint',
      crash: false,
      fire: false,
    })),
    recalls: [{ campaign: '04V123000', component: 'FUEL SYSTEM', summary: 'leak', remedy: 'fix' }],
    components: [
      { component: 'SUSPENSION', count: 8 },
      { component: 'ENGINE', count: 4 },
    ],
    status: { stage: 'nhtsa', ok: true },
  };

  test('matches detected issues to complaint volume by component', () => {
    const research = narrowNhtsa(enrichment, [
      { type: 'undercarriage_issue', severity: 'high', description: 'sagged rear', photos: [0] },
    ]);
    expect(research.complaintsTotal).toBe(12);
    expect(research.matchedIssues).toEqual([
      { issueType: 'undercarriage_issue', component: 'SUSPENSION', count: 8 },
    ]);
    expect(research.recalls[0].campaign).toBe('04V123000');
  });

  test('no detected issues means no matches, but totals still report', () => {
    const research = narrowNhtsa(enrichment, []);
    expect(research.matchedIssues).toEqual([]);
    expect(research.topComponents[0]).toEqual({ component: 'SUSPENSION', count: 8 });
  });
});
