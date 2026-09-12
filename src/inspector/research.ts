import { z } from 'zod';
import { runToolWorker, type AnthropicClient } from '@/agent/worker';
import { failureReason, statedFailure } from '@/lib/failure';
import { hostOf } from '@/lib/url';
import type { NhtsaEnrichment } from '@/enrich/nhtsa';
import type {
  DetectedIssue,
  IssueType,
  NhtsaResearch,
  PhotoAnalysis,
  ReliabilityReport,
  ResearchTopic,
  VinSighting,
  WebFinding,
} from './types';

/**
 * The research half of the agent. Two layers, both real:
 *
 * 1. planResearchTopics — deterministic: turns what the photos showed into
 *    an ordered list of topics with stated reasons. This is where the agent's
 *    decisions live, so it is pure and tested offline.
 * 2. runWebResearch — a genuine agent loop over the Anthropic API with the
 *    server-side web_search tool: the model runs real searches (each query
 *    surfaces as a progress event), then reports findings through a forced
 *    tool call. Findings without a source URL are discarded — no uncited
 *    claims survive validation.
 */

const MAX_TOPICS = 5;

// -- Topic planning (pure) ----------------------------------------------------

export function planResearchTopics(
  analysis: PhotoAnalysis,
  reliability: ReliabilityReport,
  vehicle: { make: string; model: string; year: number },
): ResearchTopic[] {
  const label = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const topics: ResearchTopic[] = [];

  for (const issue of analysis.issues) {
    const worthIt =
      issue.severity === 'critical' ||
      issue.severity === 'high' ||
      (issue.severity === 'medium' &&
        ['rust', 'frame_damage', 'fluid_leak', 'undercarriage_issue'].includes(issue.type));
    if (!worthIt) continue;
    topics.push({
      topic:
        `${label} ${issue.type.replace(/_/g, ' ')} ${issue.location ?? ''} repair cost and severity`.trim(),
      reason: `photos show ${issue.severity} ${issue.type.replace(/_/g, ' ')}: ${issue.description}`,
      priority: issue.severity === 'critical' ? 10 : issue.severity === 'high' ? 8 : 6,
    });
  }

  for (const mod of analysis.modifications) {
    if (mod.quality !== 'budget_aftermarket' && mod.quality !== 'unknown') continue;
    topics.push({
      topic: `${label} ${mod.type.replace(/_/g, ' ')} aftermarket reliability problems`,
      reason: `photos show ${mod.quality.replace(/_/g, ' ')} ${mod.type.replace(/_/g, ' ')}: ${mod.description}`,
      priority: 7,
    });
  }

  // Known failure points get verified against current owner reports even on
  // a clean-looking car — that's the diligence a PPI buys.
  for (const concern of reliability.modelConcerns) {
    if (concern.frequency !== 'very_common' && concern.frequency !== 'common') continue;
    topics.push({
      topic: `${label} ${concern.component} failure symptoms and inspection`,
      reason: `known ${concern.frequency.replace(/_/g, ' ')} failure point for this model: ${concern.component}`,
      priority: concern.frequency === 'very_common' ? 5 : 4,
    });
  }

  return topics.sort((a, b) => b.priority - a.priority).slice(0, MAX_TOPICS);
}

// -- Web research agent -------------------------------------------------------

export type WebResearchCaller = (
  input: { vehicleLabel: string; listingLine?: string; topics: ResearchTopic[] },
  onProgress?: (note: string) => void,
) => Promise<unknown>;

const TOOL_NAME = 'report_findings';

const REPORT_FINDINGS_TOOL = {
  name: TOOL_NAME,
  description:
    'Report research findings. Call exactly once, after searching. Every finding must cite the source pages it came from.',
  // Constrained decoding: severity and shape can't drift off-schema.
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            topic: { type: 'string', description: 'the research topic, verbatim' },
            summary: {
              type: 'string',
              description: 'what owners/mechanics actually report, 1-3 sentences, specific',
            },
            severity: { type: 'string', enum: ['info', 'concern', 'critical'] },
            costEstimate: {
              type: 'string',
              description: 'repair cost range if sources state one, e.g. "$2,500-4,000"',
            },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                },
                required: ['url', 'title'],
              },
            },
          },
          required: ['topic', 'summary', 'severity', 'sources'],
        },
      },
    },
    required: ['findings'],
  },
};

const RESEARCH_SYSTEM = `You research used-vehicle problems for a buyer deciding on a specific car. For each topic, search the web for what owners and independent mechanics actually report — enthusiast forums, owner communities, repair guides. Prefer model-specific sources over generic car-advice content.
Rules:
- Search first; report only what sources say. If sources disagree, say so.
- Include repair cost ranges when sources state them; never invent figures.
- severity: critical = can total the car or is a safety issue, concern = expensive or common, info = worth knowing.
- When done searching, call ${TOOL_NAME} exactly once with every finding.
- CITATIONS ARE MANDATORY: every finding's sources array must contain the full http(s) URLs of the actual pages from your search results (copy them exactly). A finding with an empty sources array is discarded — report fewer, cited findings over many uncited ones. If searches truly surface nothing, report an empty findings list.`;

// Source URLs validate as plain strings here; the http(s) filter below does
// the real gating. A schema-level .url() would let one malformed source kill
// every finding in the payload instead of just its own citation.
const webFindingSchema = z.object({
  topic: z.string().min(1),
  summary: z.string().min(1),
  severity: z.enum(['info', 'concern', 'critical']),
  costEstimate: z.string().optional(),
  sources: z.array(z.object({ url: z.string(), title: z.string() })).default([]),
});

const webOutputSchema = z.object({ findings: z.array(webFindingSchema).default([]) });

// Would this raw report survive validation with zero findings? Used by the
// caller to fix citations inside the SAME conversation (one cheap turn)
// instead of burning a whole fresh research pass. Pure and tested.
export function needsCitationNudge(raw: unknown): boolean {
  try {
    const parsed = webOutputSchema.safeParse(raw);
    if (!parsed.success) return true; // malformed → worth one repair attempt
    if (parsed.data.findings.length === 0) return false; // honestly empty
    return parseWebFindings(raw).length === 0; // findings exist, none cited
  } catch {
    return true;
  }
}

// An empty report from a worker that actually read search results gets one
// push-back: strict citation rules make "findings: []" the safe answer even
// when the sources it read stated prices. Pure and tested.
export function isEmptyReport(raw: unknown): boolean {
  const parsed = webOutputSchema.safeParse(raw);
  return parsed.success && parsed.data.findings.length === 0;
}

// -- Parallel topic workers ----------------------------------------------------
//
// One small agent per topic, all topics concurrently. Each worker holds
// ONLY its topic: two searches, a tight token budget, and a hard wall-clock
// deadline that ABORTS the stream (the SDK's request timeout does not cover
// a stream that keeps trickling). The orchestrator never sees raw search
// dumps, only structured findings, so context stays small, wall time is the
// slowest single worker instead of the sum, and one dead topic cannot take
// the others' anchors with it.

export const WORKER_BUDGET_MS = 120_000;
const WORKER_MAX_SEARCHES = 2;
const WORKER_MAX_TURNS = 3; // enough for search, pause resume or repair, report
// max_tokens must fit search reasoning + the findings JSON in ONE turn: a
// worker that runs out mid-report burns a whole extra turn re-searching,
// which is how workers die at the budget wall with nothing to show.
const WORKER_MAX_TOKENS = 3000;

// Appended to the shared research system prompt for single-topic workers:
// the tool call is the deliverable, and the clock is real.
const WORKER_DISCIPLINE = `
You are researching ONE topic on a hard time budget. Search at most twice, then call ${TOOL_NAME} IMMEDIATELY after reading results. Do not write analysis text before the tool call — the tool call is your entire output. Keep each summary to 1-2 sentences. One or two well-cited findings beat a thorough answer that arrives too late.
Any dollar figure or range a finding relies on MUST be copied into that finding's costEstimate field (e.g. "$180,000-$210,000"); never leave costEstimate empty when the summary states prices. When the topic asks for per-component prices, report one finding per component, each with its own costEstimate.`;

// Short lane tag for the console: '[rust rear] searching: …'. Inspector
// topics are prose derived from the photos, so the lane comes from the
// topic itself; the salvage workers carry their own fixed tags.
export function topicTag(topic: string, vehicleLabel: string): string {
  const rest = topic.replace(vehicleLabel, '').trim().split(/\s+/).slice(0, 2).join(' ');
  return (rest || 'topic').toLowerCase().slice(0, 16);
}

async function researchTopicWorker(
  client: AnthropicClient,
  topic: ResearchTopic,
  vehicleLabel: string,
  listingLine: string | undefined,
  onProgress?: (note: string) => void,
): Promise<unknown[]> {
  const tag = topicTag(topic.topic, vehicleLabel);
  const outcome = await runToolWorker(client, {
    tag,
    system: RESEARCH_SYSTEM + WORKER_DISCIPLINE,
    userMessage: `Vehicle: ${vehicleLabel}${listingLine ? `\nThe exact listing under evaluation: ${listingLine}` : ''}\nResearch exactly ONE topic:\n- ${topic.topic}\n  reason: ${topic.reason}`,
    tool: REPORT_FINDINGS_TOOL,
    maxSearches: WORKER_MAX_SEARCHES,
    maxTurns: WORKER_MAX_TURNS,
    maxTokens: WORKER_MAX_TOKENS,
    budgetMs: WORKER_BUDGET_MS,
    repair: (input) =>
      needsCitationNudge(input)
        ? 'Every finding was rejected: the sources arrays were empty or not valid http(s) URLs. Call report_findings again with the SAME findings, each citing the exact URLs from your search results. A finding you cannot cite must be dropped.'
        : null,
    // A worker that READ sources and reports nothing gets one push-back:
    // strict citation rules make the empty list feel like the safe answer,
    // and prices sitting in already-read sources are the usual reality.
    emptyPushback: (input) =>
      isEmptyReport(input)
        ? 'You read search results before reporting an empty list. If ANY source you read stated a price, dollar figure, or concrete fact FOR THIS EXACT TOPIC, call report_findings again now with those findings, citing the exact URLs. Do NOT repurpose prices about something else (e.g. clean-title retail prices when the topic is wreck/salvage prices). Only report an empty list if genuinely none of the sources spoke to this topic.'
        : null,
    onProgress,
  });
  // Either stop drops the topic: one worker's silence is not a claim about
  // the car, and the loop's own progress line already named which stop it
  // was. Findings are additive, so the other topics stand.
  if ('stopped' in outcome) return [];
  const raw = outcome.result;
  const findings = Array.isArray((raw as { findings?: unknown[] })?.findings)
    ? (raw as { findings: unknown[] }).findings
    : [];
  onProgress?.(
    `[${tag}] ${findings.length > 0 ? `${findings.length} cited finding(s)` : 'nothing citable found'}`,
  );
  // Stamp the ASKED topic over the model's echo. Models rewrite topic
  // strings in practice, and every downstream money path keys on the
  // topic; the worker knows what it was asked, so the finding carries
  // that verbatim.
  return findings.map((f) =>
    f && typeof f === 'object' ? { ...(f as object), topic: topic.topic } : f,
  );
}

// The default caller fans the topics out to parallel workers and merges
// their findings. The return shape is unchanged, so validation, tests, and
// injected fakes all keep working.
export const defaultWebResearchCaller: WebResearchCaller = async (
  { vehicleLabel, listingLine, topics },
  onProgress,
) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // Worker retries are the turn loop; SDK retries would eat the budget.
  const client = new Anthropic({ timeout: 90_000, maxRetries: 0 });
  const perTopic = await Promise.all(
    topics.map((topic) =>
      researchTopicWorker(client, topic, vehicleLabel, listingLine, onProgress).catch((err) => {
        console.error(`inspection research: worker "${topic.topic}" failed:`, err);
        onProgress?.(`[${topicTag(topic.topic, vehicleLabel)}] failed: ${failureReason(err)}`);
        return [] as unknown[];
      }),
    ),
  );
  return { findings: perTopic.flat() };
};

// Validate agent output. Findings with no valid source URL are dropped —
// an uncited claim is indistinguishable from an invented one.
export function parseWebFindings(raw: unknown): WebFinding[] {
  const parsed = webOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw statedFailure(
      `web research output failed validation: ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data.findings
    .map((f) => ({ ...f, sources: f.sources.filter((s) => /^https?:\/\//.test(s.url)) }))
    .filter((f) => f.sources.length > 0);
}

export async function runWebResearch(
  vehicle: { make: string; model: string; year: number },
  topics: ResearchTopic[],
  caller: WebResearchCaller = defaultWebResearchCaller,
  onProgress?: (note: string) => void,
  listingLine?: string,
): Promise<WebFinding[]> {
  if (topics.length === 0) return [];
  const vehicleLabel = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const raw = await caller({ vehicleLabel, listingLine, topics }, onProgress);
  return parseWebFindings(raw);
}

// -- VIN provenance sweep ------------------------------------------------------

// Search the exact VIN and report where this specific car has appeared
// before: earlier listings, auction results, forum threads. Real signal —
// a car relisted three times in a year, or sold for half the ask six months
// ago, changes the negotiation. Same citation rule as research: a sighting
// without a source URL is discarded.

export type VinSweepCaller = (
  input: { vin: string; vehicleLabel: string },
  onProgress?: (note: string) => void,
) => Promise<unknown>;

const SIGHTINGS_TOOL_NAME = 'report_vin_sightings';
const SWEEP_TAG = 'vin'; // the console lane the sweep's progress lands in
const MAX_SWEEP_SEARCHES = 2;
const MAX_SWEEP_TURNS = 4;
const SWEEP_MAX_TOKENS = 2048;

const REPORT_SIGHTINGS_TOOL = {
  name: SIGHTINGS_TOOL_NAME,
  description:
    'Report every page where this exact VIN appears. Call exactly once, after searching. No sighting without its source URL.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      sightings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string' },
            title: { type: 'string', description: 'the page title or listing title' },
            date: {
              type: 'string',
              description:
                'when, exactly as the source states it (e.g. "sold 8/12/26", "listed June 2025")',
            },
            note: {
              type: 'string',
              description:
                'what the page says about the car: price, mileage, outcome, condition claims',
            },
          },
          required: ['url', 'title'],
        },
      },
    },
    required: ['sightings'],
  },
};

const SWEEP_SYSTEM = `You trace a specific used car's public history by its VIN. Search for the exact VIN string (in quotes). Report only pages that actually reference this VIN — auction results, dealer listings, forum threads, registry entries. Never include pages about the model in general.
When done, call ${SIGHTINGS_TOOL_NAME} exactly once. If nothing references this VIN, report an empty list — absence of history is a normal, honest result.`;

const sightingSchema = z.object({
  url: z.string(),
  title: z.string().min(1),
  date: z.string().optional(),
  note: z.string().optional(),
});

const sweepOutputSchema = z.object({ sightings: z.array(sightingSchema).default([]) });

export const SWEEP_BUDGET_MS = 60_000;

export const defaultVinSweepCaller: VinSweepCaller = async ({ vin, vehicleLabel }, onProgress) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The worker loop owns the retries; SDK retries would eat the budget.
  const client = new Anthropic({ timeout: 90_000, maxRetries: 0 });
  const outcome = await runToolWorker(client, {
    tag: SWEEP_TAG,
    system: SWEEP_SYSTEM,
    userMessage: `VIN: ${vin}\nThe car under evaluation: ${vehicleLabel}. Trace this VIN's public appearances.`,
    tool: REPORT_SIGHTINGS_TOOL,
    maxSearches: MAX_SWEEP_SEARCHES,
    maxTurns: MAX_SWEEP_TURNS,
    maxTokens: SWEEP_MAX_TOKENS,
    budgetMs: SWEEP_BUDGET_MS,
    // No repair and no push-back: absence of history is the honest result
    // for most private-party cars, and there is nothing to re-cite.
    onProgress,
  });
  if ('result' in outcome) return outcome.result;
  // An exhausted budget is "no history found": most private-party VINs have
  // none, and a sweep that ran out of clock saw nothing either way. A worker
  // that had its turns and never reported claims nothing about the VIN, so
  // the VIN stage states it as the failure it is. The loop names which
  // happened; the clock is not consulted.
  if (outcome.stopped === 'out-of-time') return { sightings: [] };
  throw new Error(`VIN sweep agent never called ${SIGHTINGS_TOOL_NAME}`);
};

// Validate sweep output: no URL, no sighting; hostnames derived, the subject
// listing itself is excluded (the buyer already has that page open).
export function parseVinSightings(raw: unknown, excludeUrl?: string): VinSighting[] {
  const parsed = sweepOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw statedFailure(`VIN sweep output failed validation: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data.sightings
    .filter((s) => /^https?:\/\//.test(s.url))
    .filter((s) => !excludeUrl || s.url !== excludeUrl)
    .map((s) => ({
      url: s.url,
      title: s.title,
      source: hostOf(s.url),
      date: s.date,
      note: s.note,
    }));
}

export async function runVinSweep(
  vin: string,
  vehicle: { make: string; model: string; year: number },
  caller: VinSweepCaller = defaultVinSweepCaller,
  onProgress?: (note: string) => void,
  excludeUrl?: string,
): Promise<VinSighting[]> {
  const vehicleLabel = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const raw = await caller({ vin, vehicleLabel }, onProgress);
  return parseVinSightings(raw, excludeUrl);
}

// -- NHTSA narrowing (pure over fetched data) ---------------------------------

// Detected issue types → NHTSA component vocabulary, so photo findings can be
// checked against federal complaint volume for this exact vehicle.
const ISSUE_TO_NHTSA: Record<IssueType, string[]> = {
  rust: ['STRUCTURE', 'SUSPENSION'],
  frame_damage: ['STRUCTURE'],
  body_damage: ['STRUCTURE'],
  paint_issue: [],
  fluid_leak: ['ENGINE', 'POWER TRAIN', 'ENGINE AND ENGINE COOLING'],
  tire_wear: ['TIRES', 'SUSPENSION'],
  glass_damage: ['VISIBILITY'],
  lighting_issue: ['EXTERIOR LIGHTING'],
  undercarriage_issue: ['SUSPENSION', 'STRUCTURE'],
  interior_wear: ['INTERIOR'],
};

const TOP_COMPONENTS = 5;
const MAX_RECALLS = 6;

export function narrowNhtsa(enrichment: NhtsaEnrichment, issues: DetectedIssue[]): NhtsaResearch {
  const matchedIssues: NhtsaResearch['matchedIssues'] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    for (const keyword of ISSUE_TO_NHTSA[issue.type]) {
      const hit = enrichment.components.find((c) => c.component.includes(keyword));
      const key = `${issue.type}:${hit?.component}`;
      if (hit && !seen.has(key)) {
        seen.add(key);
        matchedIssues.push({ issueType: issue.type, component: hit.component, count: hit.count });
      }
    }
  }
  return {
    complaintsTotal: enrichment.complaints.length,
    topComponents: enrichment.components.slice(0, TOP_COMPONENTS),
    recalls: enrichment.recalls
      .slice(0, MAX_RECALLS)
      .map(({ campaign, component, summary }) => ({ campaign, component, summary })),
    matchedIssues,
  };
}
