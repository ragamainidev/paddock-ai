import { inspectCarStream, type InspectorDeps } from '@/inspector/inspector';
import type { InspectEvent, InspectorInput, InspectorReport } from '@/inspector/types';
import {
  fixtureDeps,
  FROZEN_NOW,
  M3_INPUT,
  nhtsaDown,
  returns,
  SWEEP_MIXED,
  VISION_BAD_ANCHORS,
  VISION_GARBAGE,
  VISION_RUSTY,
  VPIC_MATCHING,
  VPIC_MISMATCH,
  WEB_MIXED_CITATIONS,
} from './fixtures';

// The inspector eval suite: the agent evaluated the way a lab would —
// fixture-driven and deterministic, graded per check, with the invariants
// it defends named explicitly. Three check classes:
//
//   invariant — a SPEC rule that must hold on every run (citations, anchors,
//               event ordering, isolation)
//   behavior  — labeled expectations: this input must produce this verdict,
//               this plan, this red flag
//   honesty   — the agent must refuse, degrade visibly, or state limits
//               instead of inventing
//
// Adversarial cases are first-class: uncited findings, out-of-range anchors,
// identity mismatches, dead upstreams, malformed model output.

export type CheckClass = 'invariant' | 'behavior' | 'honesty' | 'realism';

export type CheckResult = {
  id: string;
  class: CheckClass;
  spec?: string; // the SPEC.md invariant this check defends
  desc: string;
  pass: boolean;
  detail?: string;
};

export type InspectorCaseResult = {
  name: string;
  description: string;
  checks: CheckResult[];
  pass: boolean; // every check passed
};

type Collected = { events: InspectEvent[]; report?: InspectorReport; fatal?: string };

async function collect(input: InspectorInput, deps: InspectorDeps): Promise<Collected> {
  const events: InspectEvent[] = [];
  let report: InspectorReport | undefined;
  let fatal: string | undefined;
  for await (const event of inspectCarStream(input, deps)) {
    events.push(event);
    if (event.type === 'report') report = event.report;
    if (event.type === 'fatal') fatal = event.message;
  }
  return { events, report, fatal };
}

class Grader {
  checks: CheckResult[] = [];
  check(
    id: string,
    cls: CheckClass,
    desc: string,
    pass: boolean,
    opts: { spec?: string; detail?: string } = {},
  ) {
    this.checks.push({ id, class: cls, desc, pass, spec: opts.spec, detail: opts.detail });
  }
}

type CaseDef = {
  name: string;
  description: string;
  run: (g: Grader) => Promise<void>;
};

const stagesOf = (events: InspectEvent[]) =>
  events.flatMap((e) => (e.type === 'stage' ? [e.status] : []));

const CASES: CaseDef[] = [
  {
    name: 'clean car, full pipeline',
    description:
      'An excellent-condition M3 with a matching federal decode: verdict pass, nothing invented, every stage accounted for.',
    async run(g) {
      const { events, report, fatal } = await collect(
        M3_INPUT,
        fixtureDeps({ vpicFetcher: returns(VPIC_MATCHING) }),
      );
      g.check(
        'report-last',
        'invariant',
        'the report is the final event of a successful run',
        !fatal && events.at(-1)?.type === 'report',
        { spec: 'SPEC 25' },
      );
      g.check(
        'verdict-pass',
        'behavior',
        'clean car earns a pass verdict',
        report?.assessment.verdict === 'pass',
      );
      g.check(
        'begin-precedes-status',
        'invariant',
        'every stage announces begin before its status lands (stage rail contract)',
        (
          ['vision', 'reliability', 'plan', 'nhtsa', 'web', 'vin', 'market', 'synthesis'] as const
        ).every((stage) => {
          const b = events.findIndex((e) => e.type === 'begin' && e.stage === stage);
          const s = events.findIndex((e) => e.type === 'stage' && e.status.stage === stage);
          return b >= 0 && b < s;
        }),
      );
      g.check(
        'spans-streamed',
        'invariant',
        'model and fetch calls stream trace spans with timings',
        events.some((e) => e.type === 'span' && e.span.name.includes('vision')) &&
          events.some((e) => e.type === 'span' && e.span.name.includes('nhtsa')),
      );
      g.check(
        'comps-exclude-subject',
        'invariant',
        'the subject listing never appears in its own comp set',
        Boolean(report?.market) &&
          !report!.market!.comps.some((c) => c.url === M3_INPUT.listing?.url),
        { spec: 'SPEC 27' },
      );
      g.check(
        'vpic-enriches',
        'behavior',
        'the federal decode fills model/body/plant and finds no mismatch',
        report?.vinCheck?.decoded?.model === 'M3' &&
          report?.vinCheck?.decoded?.bodyClass === 'Coupe' &&
          report?.vinCheck?.mismatches.length === 0,
      );
      g.check(
        'no-history-verdict',
        'honesty',
        'the VIN section never prints a history verdict — it links the services that do check',
        Boolean(report?.vinCheck) &&
          /NOT checked/i.test(report!.vinCheck!.note) &&
          (report!.vinCheck!.links.length ?? 0) >= 3,
        { spec: 'SPEC 26' },
      );
    },
  },
  {
    name: 'rust changes the research path',
    description:
      'The same car with rust in the photos must produce a different, rust-driven research plan, and cited findings must flow into the money math.',
    async run(g) {
      const clean = await collect(M3_INPUT, fixtureDeps());
      const rusty = await collect(
        M3_INPUT,
        fixtureDeps({
          visionCaller: returns(VISION_RUSTY),
          webCaller: returns(WEB_MIXED_CITATIONS),
        }),
      );
      const cleanTopics = clean.report?.topics ?? [];
      const rustyTopics = rusty.report?.topics ?? [];
      g.check(
        'plan-differs',
        'behavior',
        'two cars with different photos produce different research paths',
        rustyTopics.length > cleanTopics.length &&
          rustyTopics.some((t) => t.topic.includes('rust')),
        { spec: 'SPEC 23' },
      );
      g.check(
        'plan-reasons-stated',
        'invariant',
        'every research topic states the reason it was chosen',
        rustyTopics.every((t) => t.reason.length > 10),
        { spec: 'SPEC 23' },
      );
      g.check(
        'verdict-degrades',
        'behavior',
        'high-severity rust pulls the verdict to caution',
        rusty.report?.assessment.verdict === 'caution',
      );
      g.check(
        'cost-estimates-flow',
        'behavior',
        'cited repair costs surface in the report for the money panel',
        (rusty.report?.web ?? []).some((f) => f.costEstimate === '$1,500-3,000'),
      );
    },
  },
  {
    name: 'uncited claims do not survive',
    description:
      'The research agent returns four findings: two cited, one with no source, one with a garbage URL. Only the cited two may exist afterward.',
    async run(g) {
      const { report } = await collect(
        M3_INPUT,
        fixtureDeps({
          visionCaller: returns(VISION_RUSTY),
          webCaller: returns(WEB_MIXED_CITATIONS),
        }),
      );
      const web = report?.web ?? [];
      g.check(
        'uncited-dropped',
        'invariant',
        'findings without a valid http(s) source are discarded during validation',
        web.length === 2 && web.every((f) => f.sources.length > 0),
        { spec: 'SPEC 22', detail: `survived: ${web.map((f) => f.topic).join(', ')}` },
      );
      g.check(
        'critical-cited-survives',
        'behavior',
        'the cited critical finding survives and becomes a red flag',
        web.some((f) => f.severity === 'critical') &&
          (report?.assessment.redFlags ?? []).some((r) => r.includes('subframe')),
      );
    },
  },
  {
    name: 'photo anchors are validated',
    description:
      'Vision returns anchors pointing at photos 7 and -1 of a 3-photo set. The finding must survive with no anchors rather than being assigned one.',
    async run(g) {
      const { report } = await collect(
        M3_INPUT,
        fixtureDeps({ visionCaller: returns(VISION_BAD_ANCHORS) }),
      );
      const issue = report?.analysis.issues[0];
      g.check(
        'anchors-clamped',
        'invariant',
        'out-of-range anchors are dropped, the finding keeps none',
        Boolean(issue) && issue!.photos.length === 0,
        { spec: 'SPEC 21' },
      );
      g.check(
        'finding-survives',
        'behavior',
        'the de-anchored finding still reaches the report',
        issue?.description.includes('respray') ?? false,
      );
    },
  },
  {
    name: 'federal identity mismatch forces avoid',
    description:
      'vPIC decodes the VIN as a Honda Civic while the listing claims a BMW M3 — the run must flag it with federal wording and refuse to pass the car.',
    async run(g) {
      const { report } = await collect(
        M3_INPUT,
        fixtureDeps({ vpicFetcher: returns(VPIC_MISMATCH) }),
      );
      g.check(
        'mismatch-flagged',
        'behavior',
        'the mismatch cites the federal database',
        (report?.vinCheck?.mismatches ?? []).some((m) => m.includes('vPIC')),
      );
      g.check(
        'verdict-avoid',
        'behavior',
        'an identity mismatch is an automatic avoid',
        report?.assessment.verdict === 'avoid',
      );
    },
  },
  {
    name: 'missing key refuses honestly',
    description:
      'No vision caller and no ANTHROPIC_API_KEY: the inspection must refuse with a fatal, never mock an analysis.',
    async run(g) {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const { events, report, fatal } = await collect(
          M3_INPUT,
          fixtureDeps({ visionCaller: undefined }),
        );
        g.check(
          'refusal',
          'honesty',
          'no key means an honest fatal, not a mocked inspection',
          Boolean(fatal) && !report,
          { spec: 'SPEC 24' },
        );
        g.check(
          'vision-degraded-visibly',
          'honesty',
          'the vision stage reports its failure before the fatal',
          stagesOf(events).some((s) => s.stage === 'vision' && !s.ok),
          { spec: 'SPEC 24' },
        );
      } finally {
        if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
      }
    },
  },
  {
    name: 'stage isolation under dead upstreams',
    description:
      'NHTSA is down and no comps cover the car: both stages must degrade visibly while the report still lands with a computed verdict.',
    async run(g) {
      const { events, report } = await collect(
        { ...M3_INPUT, make: 'Lexus', model: 'ES350', year: 2019, vin: undefined },
        fixtureDeps({ nhtsaFetcher: nhtsaDown }),
      );
      const stages = stagesOf(events);
      g.check(
        'nhtsa-degrades',
        'invariant',
        'NHTSA failure yields a named degraded status, not a crash',
        stages.some((s) => s.stage === 'nhtsa' && !s.ok),
        { spec: 'SPEC 24' },
      );
      g.check(
        'market-degrades',
        'invariant',
        'no comps means a visibly degraded market stage, not a guess',
        stages.some((s) => s.stage === 'market' && !s.ok && /no comps/.test(s.detail ?? '')),
        { spec: 'SPEC 27' },
      );
      g.check(
        'report-still-lands',
        'invariant',
        'independent failures never kill the run',
        report !== undefined && report.assessment.verdict.length > 0,
        { spec: 'SPEC 24' },
      );
      g.check(
        'degradations-in-report',
        'honesty',
        'the report carries the degraded stages for the UI to show',
        (report?.stages ?? []).filter((s) => !s.ok).length === 2,
      );
    },
  },
  {
    name: 'malformed vision output is fatal, not papered over',
    description:
      'The vision model returns garbage. The run must fail validation loudly instead of inventing an analysis.',
    async run(g) {
      const { report, fatal } = await collect(
        M3_INPUT,
        fixtureDeps({ visionCaller: returns(VISION_GARBAGE) }),
      );
      g.check(
        'validation-fatal',
        'honesty',
        'unparseable vision output ends the run with a validation error',
        Boolean(fatal && /validation/i.test(fatal)) && !report,
      );
    },
  },
  {
    name: 'VIN provenance is citation-gated',
    description:
      'The sweep returns the subject listing, a real sighting, and an uncited one. Only the real sighting may survive, with its host derived.',
    async run(g) {
      const { report } = await collect(
        M3_INPUT,
        fixtureDeps({ sweepCaller: returns(SWEEP_MIXED) }),
      );
      const sightings = report?.sightings ?? [];
      g.check(
        'sightings-cited',
        'invariant',
        'uncited sightings are discarded; the subject listing is excluded',
        sightings.length === 1 && sightings[0].source === 'm3post.com',
        { spec: 'SPEC 22' },
      );
      g.check(
        'sighting-facts-kept',
        'behavior',
        'date and price ride along verbatim',
        sightings[0]?.date === 'March 2024' && sightings[0]?.note === 'asked $38,500',
      );
    },
  },
  {
    name: 'determinism under a frozen clock',
    description:
      'The same fixtures and a frozen clock must produce byte-identical reports across two runs — the agent has no hidden nondeterminism.',
    async run(g) {
      const deps = () =>
        fixtureDeps({
          visionCaller: returns(VISION_RUSTY),
          webCaller: returns(WEB_MIXED_CITATIONS),
          vpicFetcher: returns(VPIC_MATCHING),
          sweepCaller: returns(SWEEP_MIXED),
          nhtsaFetcher: nhtsaFetcherFixtureStable(),
        });
      const a = await collect(M3_INPUT, deps());
      const b = await collect(M3_INPUT, deps());
      g.check(
        'reports-identical',
        'invariant',
        'two runs over identical fixtures produce identical reports',
        JSON.stringify(a.report) === JSON.stringify(b.report),
      );
      g.check(
        'timestamp-frozen',
        'invariant',
        'generatedAt comes from the injected clock',
        a.report?.generatedAt === FROZEN_NOW.toISOString(),
      );
    },
  },
];

// Local stable NHTSA fixture used by the determinism case (fresh closure per
// run so odi counters can't leak between the two executions).
function nhtsaFetcherFixtureStable() {
  return async (url: string): Promise<unknown> => {
    if (url.includes('/products/vehicle/models'))
      return { results: [{ make: 'BMW', model: 'M3' }] };
    if (url.includes('complaintsByVehicle')) {
      return {
        results: [
          {
            odiNumber: 1,
            components: 'STRUCTURE',
            summary: 'subframe cracked',
            crash: false,
            fire: false,
          },
        ],
      };
    }
    return { results: [] };
  };
}

export async function runInspectorSuite(): Promise<InspectorCaseResult[]> {
  const results: InspectorCaseResult[] = [];
  for (const def of CASES) {
    const grader = new Grader();
    try {
      await def.run(grader);
    } catch (err) {
      grader.check('no-crash', 'invariant', 'the case executes without throwing', false, {
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    results.push({
      name: def.name,
      description: def.description,
      checks: grader.checks,
      pass: grader.checks.every((c) => c.pass),
    });
  }
  return results;
}
