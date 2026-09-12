/**
 * Salvage evidence research: parallel single-topic workers that report
 * STRUCTURED payloads — typed comps for the exit and wreck lanes, typed
 * price evidence for the repair lines — through forced tool calls. Money
 * never arrives as prose (SPEC 44): an item without a numeric price or an
 * http(s) source is dropped in the parser, and each worker stamps the lane
 * or line it was asked about over whatever the model echoed. The worker
 * loop itself is the shared `runToolWorker` (`src/agent/worker.ts`); this
 * module owns the topics, the two tools, their zod twins, and the parsers.
 */

import { runToolWorker } from '@/agent/worker';
import { failureReason } from '@/lib/failure';
import { hostOf } from '@/lib/url';
import { z } from 'zod';
import type { WebFinding } from '@/inspector/types';
import type { LineResearchTopic } from './knowledge';
import type { Comp, CompLane, PriceEvidence, SalvageLot } from './types';

// -- Topics -----------------------------------------------------------------------

export type EvidenceTopic =
  | { kind: 'comps'; id: string; lane: CompLane; tag: string; topic: string; reason: string }
  | { kind: 'prices'; id: string; lineId: string; tag: string; topic: string; reason: string };

export type EvidenceCoverage = { cleanAsks?: boolean; wreckAsks?: boolean };

// The research plan: four market lanes plus one worker per top repair
// line. Every topic is a parallel worker; wall clock is the slowest one.
export function salvageEvidenceTopics(
  lot: SalvageLot,
  lineTopics: LineResearchTopic[],
  coverage: EvidenceCoverage = {},
): EvidenceTopic[] {
  const label = `${lot.year} ${lot.make} ${lot.model}`;
  const topics: EvidenceTopic[] = [
    {
      kind: 'comps',
      id: 'comps.rebuilt',
      lane: 'rebuilt',
      tag: 'rebuilt comps',
      topic: `${lot.make} ${lot.model} (any recent model year) with a REBUILT, RECONSTRUCTED, or SALVAGE title: finished, road-registered cars sold or listed for sale (Bring a Trailer, Cars & Bids, eBay Motors, dealer sites, FerrariChat/forums). NOT salvage-auction wrecks.`,
      reason: 'the exit itself: what a branded-title example of this model actually sells for',
    },
    {
      kind: 'comps',
      id: 'comps.clean_sold',
      lane: 'clean',
      tag: 'clean sold',
      topic: `${label} clean-title SOLD prices: completed auction results and recorded sales, model years ${lot.year - 1}–${lot.year + 1} (Classic.com results, Bring a Trailer, Cars & Bids, Bonhams, RM Sotheby's, Gooding, PCARMARKET, Collecting Cars). One comp per car with its sale date, mileage, and variant.`,
      reason: 'the clean anchor the rebuilt band derives from: transacted money, not asks',
    },
  ];
  if (!coverage.cleanAsks) {
    topics.push({
      kind: 'comps',
      id: 'comps.clean_asks',
      lane: 'clean',
      tag: 'clean asks',
      topic: `${label} clean-title cars currently for sale: dealer and private ASKING prices (cars.com, Autotrader, duPont Registry, dealer sites, Classic.com listings). One comp per car with mileage and variant.`,
      reason: 'the ask side of the clean market, haircut to sold money when no sales are found',
    });
  }
  topics.push({
    kind: 'comps',
    id: 'comps.wreck',
    lane: 'wreck',
    tag: 'wreck market',
    topic: `${lot.make} ${lot.model} salvage-auction RESULTS: Copart and IAAI lots of damaged/wrecked ${lot.model}s with the high bid, whether it SOLD or was "not sold / on approval", the damage type, odometer, and sale date (autoastat.com, bid.cars, salvagebid history, poctra, carsfromwest, autobidmaster). NOT clean retail listings.`,
    reason: 'what wrecks like this actually hammer for: context for the ceiling, never its input',
  });
  for (const lt of lineTopics) {
    topics.push({
      kind: 'prices',
      id: `prices.${lt.lineId}`,
      lineId: lt.lineId,
      tag: lt.lineId.split('.').pop() ?? lt.lineId,
      topic: lt.topic,
      reason: lt.reason,
    });
  }
  return topics;
}

// -- Tools and schemas ---------------------------------------------------------------

const OUTCOMES = ['sold', 'ask', 'bid_no_sale'] as const;
const TITLES = ['clean', 'rebuilt', 'salvage', 'unknown'] as const;
const PRICE_KINDS = ['part_new', 'part_used', 'labor', 'job_quote'] as const;

const COMPS_TOOL_NAME = 'report_comps';
const PRICES_TOOL_NAME = 'report_prices';

const NOTE_ITEMS = {
  type: 'array',
  description:
    'Short cited facts that are not a price: e.g. "no rebuilt-title SF90 has sold publicly". Each needs the URL of the page it comes from.',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' }, url: { type: 'string' } },
    required: ['text', 'url'],
  },
};

const REPORT_COMPS_TOOL = {
  name: COMPS_TOOL_NAME,
  description:
    'Report comparable cars, one entry per car, with the price as a NUMBER in US dollars. Call exactly once, after searching. Every comp needs the URL of the page it came from.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      comps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            price: {
              type: 'number',
              description: 'US dollars, no symbols; convert GBP/EUR at a stated rate in note',
            },
            outcome: {
              type: 'string',
              enum: [...OUTCOMES],
              description:
                'sold = a completed sale price; ask = an asking price; bid_no_sale = a high bid that did not meet reserve / did not sell',
            },
            year: { type: 'integer', description: 'model year of the comp car' },
            mileage: { type: 'integer', description: 'odometer in miles, when stated' },
            date: {
              type: 'string',
              description: 'sale or listing date as stated, ISO (YYYY-MM-DD) when possible',
            },
            title: {
              type: 'string',
              enum: [...TITLES],
              description: 'title status of the comp car',
            },
            variant: {
              type: 'string',
              description:
                'trim/body words that make it a different car: Spider, Assetto Fiorano, GTS, Performante…',
            },
            damage: { type: 'string', description: 'wreck lots: the listed damage type' },
            url: { type: 'string', description: 'exact http(s) URL of the page' },
            source_title: { type: 'string', description: 'the page title' },
            note: { type: 'string' },
          },
          required: ['price', 'outcome', 'url', 'source_title'],
        },
      },
      notes: NOTE_ITEMS,
    },
    required: ['comps', 'notes'],
  },
};

const REPORT_PRICES_TOOL = {
  name: PRICES_TOOL_NAME,
  description:
    'Report cited prices for the repair items asked about, one entry per item, low and high as NUMBERS in US dollars. Call exactly once, after searching. Every price needs the URL of the page it came from.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      prices: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            item: {
              type: 'string',
              description: 'what is priced, e.g. "LED headlamp assembly, left"',
            },
            kind: {
              type: 'string',
              enum: [...PRICE_KINDS],
              description:
                'part_new = new OEM/aftermarket part; part_used = used/salvage part; labor = a labor figure; job_quote = a whole-job quote or invoice',
            },
            low: {
              type: 'number',
              description: 'US dollars; equal to high when the source states one figure',
            },
            high: { type: 'number' },
            url: { type: 'string', description: 'exact http(s) URL of the page' },
            source_title: { type: 'string' },
            note: { type: 'string', description: 'currency conversion, condition, quantity' },
          },
          required: ['item', 'kind', 'low', 'high', 'url', 'source_title'],
        },
      },
      notes: NOTE_ITEMS,
    },
    required: ['prices', 'notes'],
  },
};

const httpUrl = z.string().refine((u) => /^https?:\/\//.test(u), 'http(s) URL required');
const money = z.number().finite().positive();

const compSchema = z.object({
  price: money,
  outcome: z.enum(OUTCOMES),
  year: z.number().int().optional(),
  mileage: z.number().int().nonnegative().optional(),
  date: z.string().optional(),
  title: z.enum(TITLES).optional(),
  variant: z.string().optional(),
  damage: z.string().optional(),
  url: httpUrl,
  source_title: z.string().default(''),
  note: z.string().optional(),
});
const noteSchema = z.object({ text: z.string().min(1), url: httpUrl });
const compsOutputSchema = z.object({
  comps: z.array(z.unknown()).default([]),
  notes: z.array(z.unknown()).default([]),
});
const priceSchema = z.object({
  item: z.string().min(1),
  kind: z.enum(PRICE_KINDS),
  low: money,
  high: money,
  url: httpUrl,
  source_title: z.string().default(''),
  note: z.string().optional(),
});
const pricesOutputSchema = z.object({
  prices: z.array(z.unknown()).default([]),
  notes: z.array(z.unknown()).default([]),
});

// -- Parsers (pure, take unknown) --------------------------------------------------------

// Items validate one at a time so a single malformed entry cannot take the
// rest of a worker's report with it. The asked lane is stamped over
// whatever the model echoed.
export function parseComps(raw: unknown, lane: CompLane): Comp[] {
  const parsed = compsOutputSchema.safeParse(raw);
  if (!parsed.success) return [];
  const out: Comp[] = [];
  for (const item of parsed.data.comps) {
    const c = compSchema.safeParse(item);
    if (!c.success) continue;
    const d = c.data;
    out.push({
      lane,
      outcome: d.outcome,
      price: Math.round(d.price),
      year: d.year,
      mileage: d.mileage,
      date: d.date,
      title: d.title,
      variant: d.variant,
      damage: d.damage,
      url: d.url,
      source: hostOf(d.url),
      note: [d.source_title, d.note].filter(Boolean).join(' · ') || undefined,
    });
  }
  return out;
}

export function parsePrices(raw: unknown, lineId: string): PriceEvidence[] {
  const parsed = pricesOutputSchema.safeParse(raw);
  if (!parsed.success) return [];
  const out: PriceEvidence[] = [];
  for (const item of parsed.data.prices) {
    const p = priceSchema.safeParse(item);
    if (!p.success) continue;
    const d = p.data;
    out.push({
      line: lineId,
      item: d.item,
      kind: d.kind,
      low: Math.round(Math.min(d.low, d.high)),
      high: Math.round(Math.max(d.low, d.high)),
      url: d.url,
      source: hostOf(d.url),
      note: [d.source_title, d.note].filter(Boolean).join(' · ') || undefined,
    });
  }
  return out;
}

export function parseNotes(raw: unknown, topic: string): WebFinding[] {
  const parsed = z.object({ notes: z.array(z.unknown()).default([]) }).safeParse(raw);
  if (!parsed.success) return [];
  const out: WebFinding[] = [];
  for (const item of parsed.data.notes) {
    const n = noteSchema.safeParse(item);
    if (!n.success) continue;
    out.push({
      topic,
      summary: n.data.text,
      severity: 'info',
      sources: [{ url: n.data.url, title: hostOf(n.data.url) }],
    });
  }
  return out;
}

// Would this raw report survive parsing with nothing usable? Used for the
// one in-conversation repair turn: items exist but none carries a valid URL
// or numeric price.
export function needsEvidenceRepair(raw: unknown, kind: 'comps' | 'prices'): boolean {
  const items =
    kind === 'comps'
      ? (compsOutputSchema.safeParse(raw).data?.comps ?? [])
      : (pricesOutputSchema.safeParse(raw).data?.prices ?? []);
  if (items.length === 0) return false; // honestly empty: the push-back handles it
  return kind === 'comps'
    ? parseComps(raw, 'clean').length === 0
    : parsePrices(raw, 'x').length === 0;
}

export function isEmptyEvidence(raw: unknown, kind: 'comps' | 'prices'): boolean {
  const items =
    kind === 'comps'
      ? (compsOutputSchema.safeParse(raw).data?.comps ?? [])
      : (pricesOutputSchema.safeParse(raw).data?.prices ?? []);
  return items.length === 0;
}

// -- Prompts ------------------------------------------------------------------------------

const COMPS_SYSTEM = `You research used-car market prices for a salvage rebuilder deciding what to bid on ONE specific lot. Search the web, then report comparable cars through the ${COMPS_TOOL_NAME} tool: ONE entry per car, price as a plain number in US dollars.
Rules:
- outcome is a fact, not a guess: "sold" only for a completed sale price; "ask" for an asking/listing price; "bid_no_sale" for a high bid that did not sell (reserve not met, on approval).
- Report the comp's own model year, mileage, sale/listing date, title status, and any variant words (Spider, GTS, Assetto Fiorano, Performante, STO…) exactly as the page states them. Variants matter: a Spider is not a coupe.
- Never put a retail/clean listing price in a report about salvage-auction results, and never put a wreck's hammer price in a report about clean sales. If a source shows both (e.g. "high bid $193,000, retail value $850,000"), report ONLY the figure the topic asks for.
- One or two well-cited comps beat many vague ones. Prices from a page you did not read are invented; drop them.
- CITATIONS ARE MANDATORY: every comp's url is the exact http(s) address of the page from your search results. An entry without a URL is discarded.
- Copart / IAAI lots and salvage-auction aggregators (autoastat, bid.cars, bidfax, poctra, carsfromwest) are WRECK evidence: report them only when the topic asks for salvage-auction results, never as clean or rebuilt-title comps. A rebuilt-title comp is a finished, road-registered car sold or listed at retail.
- If the searches genuinely surface nothing, report an empty comps list and put what you learned (e.g. "no rebuilt-title example has sold publicly") in notes with its URL.
You are on a hard time budget. Search at most three times, then call ${COMPS_TOOL_NAME} IMMEDIATELY. Do not write analysis text; the tool call is your entire output.`;

const PRICES_SYSTEM = `You research repair costs for a salvage rebuilder pricing ONE repair line on ONE specific car. Search the web, then report cited prices through the ${PRICES_TOOL_NAME} tool: ONE entry per item, low and high as plain numbers in US dollars.
Rules:
- kind is a fact: part_new (new OEM or aftermarket part price), part_used (used/salvage part), labor (a labor figure or rate × hours the source states), job_quote (a whole-job quote, invoice, or estimate for the same repair).
- Convert GBP/EUR to USD at an approximate rate and say so in note. Prefer marque parts specialists, dealer quotes, forum invoices, and rebuild write-ups with stated numbers.
- Never invent a figure or extrapolate from a different model. If the source prices a similar-model part, say which model in note.
- ONLY parts for this exact model and variant: no special-series or track versions (XX, Challenge, Assetto Fiorano, GT4), no aftermarket (Novitec, Mansory…), no "comparison" figures from other models, no warranty or service-contract prices. Report each distinct item once; never report the same part twice.
- CITATIONS ARE MANDATORY: every entry's url is the exact http(s) address of the page from your search results. An entry without a URL is discarded.
- If nothing citable exists, report an empty prices list and put what you learned in notes with URLs.
You are on a hard time budget. Search at most three times, then call ${PRICES_TOOL_NAME} IMMEDIATELY. Do not write analysis text; the tool call is your entire output.`;

export const WORKER_BUDGET_MS = 150_000;
const WORKER_MAX_SEARCHES = 3;
const WORKER_MAX_TURNS = 4;
const WORKER_MAX_TOKENS = 4_000;

// -- Caller -----------------------------------------------------------------------------

export type SalvageEvidenceCaller = (
  input: { vehicleLabel: string; listingLine?: string; topics: EvidenceTopic[] },
  onProgress?: (note: string) => void,
) => Promise<unknown>; // { results: { id: string; payload: unknown }[] }

export const defaultSalvageEvidenceCaller: SalvageEvidenceCaller = async (
  { vehicleLabel, listingLine, topics },
  onProgress,
) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // Worker retries are the turn loop; SDK retries would eat the budget.
  const client = new Anthropic({ timeout: 90_000, maxRetries: 0 });
  const results = await Promise.all(
    topics.map(async (t) => {
      const kind = t.kind;
      const tool = kind === 'comps' ? REPORT_COMPS_TOOL : REPORT_PRICES_TOOL;
      try {
        const outcome = await runToolWorker(client, {
          tag: t.tag,
          system: kind === 'comps' ? COMPS_SYSTEM : PRICES_SYSTEM,
          userMessage: `Vehicle: ${vehicleLabel}${listingLine ? `\nThe exact lot under evaluation: ${listingLine}` : ''}\nResearch exactly ONE topic:\n- ${t.topic}\n  reason: ${t.reason}`,
          tool,
          maxSearches: WORKER_MAX_SEARCHES,
          maxTurns: WORKER_MAX_TURNS,
          maxTokens: WORKER_MAX_TOKENS,
          budgetMs: WORKER_BUDGET_MS,
          repair: (input) =>
            needsEvidenceRepair(input, kind)
              ? `Every entry was rejected: missing http(s) url or a non-numeric price. Call ${tool.name} again with the SAME entries, each with its price as a plain number and the exact URL from your search results. Drop any entry you cannot cite.`
              : null,
          emptyPushback: (input) =>
            isEmptyEvidence(input, kind)
              ? `You read search results before reporting an empty list. If ANY source you read stated a ${kind === 'comps' ? 'sale price, asking price, or high bid for this exact model' : 'price or quote for this exact repair item'}, call ${tool.name} again now with those entries and their exact URLs. Only report empty if genuinely none did.`
              : null,
          onProgress,
        });
        // Both stops drop the topic: a worker that reported nothing cites
        // nothing, and a null payload parses to zero comps or prices — the
        // same absence a genuinely empty report produces.
        const payload = 'result' in outcome ? outcome.result : null;
        const n =
          kind === 'comps'
            ? parseComps(payload, 'clean').length
            : parsePrices(payload, t.kind === 'prices' ? t.lineId : '').length;
        onProgress?.(
          `[${t.tag}] ${n > 0 ? `${n} cited ${kind === 'comps' ? 'comp' : 'price'}${n === 1 ? '' : 's'}` : 'nothing citable found'}`,
        );
        return { id: t.id, payload };
      } catch (err) {
        console.error(`salvage research: worker "${t.tag}" failed:`, err);
        onProgress?.(`[${t.tag}] failed: ${failureReason(err)}`);
        return { id: t.id, payload: null };
      }
    }),
  );
  return { results };
};

// -- Runner -------------------------------------------------------------------------------

export type EvidenceResult = { comps: Comp[]; prices: PriceEvidence[]; notes: WebFinding[] };

const resultsSchema = z.object({
  results: z.array(z.object({ id: z.string(), payload: z.unknown() })).default([]),
});

export async function runSalvageEvidence(
  lot: SalvageLot,
  topics: EvidenceTopic[],
  caller: SalvageEvidenceCaller = defaultSalvageEvidenceCaller,
  onProgress?: (note: string) => void,
  listingLine?: string,
): Promise<EvidenceResult> {
  if (topics.length === 0) return { comps: [], prices: [], notes: [] };
  const vehicleLabel = `${lot.year} ${lot.make} ${lot.model}`;
  const raw = await caller({ vehicleLabel, listingLine, topics }, onProgress);
  const parsed = resultsSchema.safeParse(raw);
  if (!parsed.success) throw new Error('evidence caller returned a malformed result set');
  const out: EvidenceResult = { comps: [], prices: [], notes: [] };
  for (const { id, payload } of parsed.data.results) {
    const topic = topics.find((t) => t.id === id);
    if (!topic || payload === null || payload === undefined) continue;
    if (topic.kind === 'comps') out.comps.push(...parseComps(payload, topic.lane));
    else out.prices.push(...parsePrices(payload, topic.lineId));
    out.notes.push(...parseNotes(payload, topic.topic));
  }
  return out;
}
