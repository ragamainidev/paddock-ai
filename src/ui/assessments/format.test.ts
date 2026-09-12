import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { USER_LOT_SOURCE } from '@/assessments/lot-source';
import type { AssessmentDecision, AssessmentEvidence, EvidenceInput } from '@/assessments/types';
import { getSalvageLot } from '@/salvage/seed-lots';
import type { CostLine } from '@/salvage/types';
import { ActivityLog } from './activity';
import {
  ceilingCell,
  ceilingHeadline,
  dateLabel,
  edgeCell,
  EDGE_META,
  evidenceLabel,
  ledgerRows,
  ledgerSummary,
  lotFooterSentence,
  lotProvenance,
  marketCell,
  moneyLabel,
  outcomeLabel,
  outcomePrompt,
  provenanceLabel,
  runNotice,
} from './format';

const decision = (over: Partial<AssessmentDecision> = {}): AssessmentDecision => ({
  revision: 3,
  at: '2026-09-06T12:00:00.000Z',
  readiness: 'ready',
  verdict: 'build',
  ceiling: 61_500,
  provisionalCeiling: 61_500,
  unknowns: [],
  reasons: ['Comparable rebuilt sales anchor the exit.'],
  evidenceIds: [],
  ...over,
});

type BuyerEconomics = NonNullable<AssessmentDecision['buyerEconomics']>;

const economics = (over: Partial<BuyerEconomics> = {}): BuyerEconomics => ({
  laborOpportunityCost: 1_750,
  holdingCost: 900,
  fixedCost: 59_868,
  maxBid: 61_500,
  kernelMaxBid: 97_000,
  market: {
    maxBid: 57_500,
    basis: 'the professional rebuilder who sets the room’s price',
    lines: [],
  },
  edge: 4_000,
  maxAllIn: 200_000,
  minSurplus: 20_000,
  stressMaxBid: 40_000,
  bestCaseMaxBid: 80_000,
  cashAtCeiling: 120_000,
  totalEconomicCostAtCeiling: 140_000,
  exit: { low: 305_000, typical: 310_000, high: 315_000, basis: 'a private sale' },
  discipline: { share: 0.75, basis: 'your discipline', bound: 'discipline' },
  lines: [],
  ...over,
});

const costLine = (id: string, expected: number): CostLine => ({
  id,
  label: id,
  group: 'repair',
  low: expected,
  expected,
  high: expected,
  basis: `basis for ${id}`,
  evidence: 'derived',
});

const source = (
  over: Partial<AssessmentEvidence['source']> = {},
): AssessmentEvidence['source'] => ({
  url: 'https://bringatrailer.com/listing/one',
  label: 'Listing',
  capturedBy: 'provider',
  retrievedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const record = (payload: EvidenceInput): AssessmentEvidence => ({
  ...payload,
  id: 'e1',
  fingerprint: 'f1',
  recordedAt: '2026-09-01T00:00:00.000Z',
  status: 'accepted',
  reason: 'recorded',
});

const subject = { vin: 'ZFF95NLA0P0289517', make: 'Ferrari', model: 'SF90', year: 2023 };

// The record is keyed by the evidence union's own tag, so a new kind fails to
// compile here until this suite covers it.
const samples: Record<EvidenceInput['kind'], AssessmentEvidence> = {
  comp: record({
    kind: 'comp',
    subject,
    source: source(),
    value: {
      lane: 'rebuilt',
      outcome: 'bid_no_sale',
      price: 322_000,
      year: 2022,
      vehicle: { make: 'Ferrari', model: 'SF90 Stradale', year: 2022 },
      url: 'https://bringatrailer.com/listing/one',
      source: 'bringatrailer.com',
    },
  }),
  repair_price: record({
    kind: 'repair_price',
    subject,
    source: source(),
    value: {
      line: 'front-structure',
      item: 'Front subframe replacement',
      kind: 'job_quote',
      low: 9000,
      high: 14_000,
      url: 'https://shop.example.com/quote',
      source: 'shop.example.com',
    },
  }),
  identity: record({
    kind: 'identity',
    subject,
    source: source(),
    value: {
      vin: 'ZFF95NLA0P0289517',
      valid: true,
      mismatches: [],
      note: 'Check digit only; history services are linked, not checked.',
      links: [],
    },
  }),
  triage: record({
    kind: 'triage',
    subject,
    source: source(),
    value: {
      overall: 'rebuildable',
      areas: [
        {
          area: 'front clip',
          kind: 'structural',
          severity: 'heavy',
          description: 'bumper and rad support',
          photos: [1],
        },
        {
          area: 'left front corner',
          kind: 'mechanical',
          severity: 'moderate',
          description: 'wheel and control arm',
          photos: [2],
        },
      ],
      airbagsDeployed: 'yes',
      floodEvidence: false,
      fireEvidence: false,
      drivetrainRisk: 'none visible',
      observations: [],
      confidence: 0.7,
    },
  }),
  title: record({
    kind: 'title',
    subject,
    source: source(),
    value: { titleBrand: 'Illinois salvage' },
  }),
  registration: record({
    kind: 'registration',
    subject,
    source: source(),
    value: { jurisdiction: 'US-NY', eligible: true, requirements: ['anti-theft inspection'] },
  }),
  inspection: record({
    kind: 'inspection',
    subject,
    source: source(),
    value: {
      inspector: 'Rennwerks Chicago',
      inspectedAt: '2026-08-30T00:00:00.000Z',
      method: 'physical',
      systems: [],
      repairScopeConfirmed: true,
    },
  }),
};

it('labels every evidence kind with what the record actually says', () => {
  const labels = Object.fromEntries(
    Object.entries(samples).map(([kind, evidence]) => [kind, evidenceLabel(evidence)]),
  );
  expect(labels).toMatchObject({
    comp: '2022 Ferrari SF90 Stradale · bid no sale $322,000',
    repair_price: 'Front subframe replacement · $9,000–$14,000',
    identity: 'VIN identity check',
    triage: 'Photo triage · 2 damage areas',
    title: 'Title observation · Illinois salvage',
    registration: 'Registration eligibility · US-NY',
    inspection: 'Physical inspection · Rennwerks Chicago',
  });
  for (const label of Object.values(labels)) expect(label.trim().length).toBeGreaterThan(0);
});

it('dates a record with its year, so a stale record cannot read as recent', () => {
  const label = dateLabel('2026-09-06T15:04:00.000Z');
  expect(label).toContain('2026');
  expect(label).toMatch(/Sep/);
});

it('says a date is unknown rather than rendering an invalid one', () => {
  expect(dateLabel('not a date')).toBe('date unknown');
});

it('states a solved ceiling in the accent, and zero as a refusal', () => {
  expect(ceilingHeadline(decision())).toEqual({
    word: 'Bid ceiling',
    value: '$61,500',
    tone: 'accent',
  });
  expect(ceilingHeadline(decision({ ceiling: 0 }))).toEqual({
    word: 'Bid ceiling',
    value: '$0',
    tone: 'danger',
  });
});

it('renders an absent ceiling as an en dash with the decision’s own reason', () => {
  expect(ceilingHeadline(decision({ ceiling: null }))).toEqual({
    word: 'Bid ceiling',
    value: '–',
    tone: 'dim',
    reason: 'Comparable rebuilt sales anchor the exit.',
  });
  expect(
    ceilingHeadline(decision({ ceiling: null, reasons: [], unknowns: ['Exit anchor unknown.'] }))
      .reason,
  ).toBe('Exit anchor unknown.');
  expect(ceilingHeadline(decision({ ceiling: null, reasons: [], unknowns: [] })).reason).toBe(
    'no solved ceiling on the current evidence',
  );
});

it('states the refusal states without a number', () => {
  expect(ceilingHeadline(decision({ verdict: 'walk' }))).toEqual({
    word: 'No bid',
    tone: 'danger',
  });
  expect(ceilingHeadline(decision({ readiness: 'needs_evidence', ceiling: null }))).toEqual({
    word: 'More evidence needed',
    tone: 'dim',
  });
  expect(
    ceilingHeadline(
      decision({ economicDominance: { bestCaseMaxBid: 10, observedBid: 90, asOf: 'now' } }),
    ),
  ).toEqual({ word: 'Pass under the current economics', tone: 'danger' });
});

it('signs a negative figure instead of flooring it at zero', () => {
  expect(moneyLabel(-4200)).toBe('−$4,200');
  expect(moneyLabel(0)).toBe('$0');
  expect(moneyLabel(4200)).toBe('$4,200');
});

it('distinguishes an invented fixture from a replayed recording', () => {
  const synthetic = record({
    kind: 'title',
    subject,
    source: source({ capturedBy: 'synthetic_fixture' }),
    value: { titleBrand: 'Illinois salvage' },
  });
  expect(provenanceLabel({ mode: 'fixture', evidence: [samples.title, synthetic] })).toBe(
    'synthetic fixture · not a real acquisition',
  );
  expect(provenanceLabel({ mode: 'fixture', evidence: [samples.title] })).toBe(
    'recorded demo · no live research',
  );
  expect(provenanceLabel({ mode: 'live', evidence: [] })).toBe('live evidence');
});

it('states what happened to a research request, not what was hoped for', () => {
  expect(runNotice('run', { accepted: true })).toBe('Research started.');
  expect(runNotice('run', { accepted: false, reason: 'already_running' })).toBe(
    'Research is already running.',
  );
  expect(runNotice('run', { accepted: false, reason: 'agent_unreachable' })).toBe(
    'Research queued; the agent will continue when it is reachable.',
  );
  expect(runNotice('run', { accepted: false, reason: 'agent_not_configured' })).toBe(
    'The research agent is not configured for this deployment. Your assessment is saved.',
  );
  expect(runNotice('run', { accepted: false, reason: 'not_runnable' })).toBe(
    'There is no runnable research request for this assessment.',
  );
  // Only the run route dispatches inline; every other route reports `saved`
  // and never `accepted`, so a refresh is never `started`.
  expect(runNotice('refresh', {})).toBe(
    'Research queued; the agent will continue when it is reachable.',
  );
  expect(runNotice('run', undefined)).toBe(
    'Research queued; the agent will continue when it is reachable.',
  );
  expect(runNotice('stop', { accepted: false })).toBe(
    'Research stopped. The evidence and decisions are saved.',
  );
});

it('states the two ceilings and the edge between them (SPEC 60)', () => {
  const ready = decision({ buyerEconomics: economics() });
  expect(ceilingCell(ready)).toEqual({
    label: 'your ceiling',
    value: '$61,500',
    note: 'your ceiling, after your cash limit, DIY time and holding costs',
    tone: 'accent',
  });
  expect(marketCell(ready.buyerEconomics)).toEqual({
    label: 'what a pro can pay',
    value: '$57,500',
    note: 'the professional rebuilder who sets the room’s price',
    tone: 'dim',
  });
  expect(edgeCell(ready.buyerEconomics)).toEqual({
    label: 'edge',
    value: '$4,000',
    note: "you can pay more for this lot than the room's price setter",
    tone: 'ok',
  });
  expect(EDGE_META).toContain('negative means you would be the optimist in the room');
});

it('reads a negative edge as the optimist in the room, and an equal one as neither', () => {
  const below = economics({
    maxBid: 53_500,
    market: { maxBid: 57_500, basis: 'b', lines: [] },
    edge: -4_000,
  });
  expect(edgeCell(below)).toEqual({
    label: 'edge',
    value: '−$4,000',
    note: 'you would be the optimist in the room',
    tone: 'danger',
  });
  // An equal ceiling is not a walk, so it is not stated as one.
  expect(edgeCell(economics({ edge: 0 }))).toEqual({
    label: 'edge',
    value: '$0',
    note: "your ceiling is the room's price",
  });
});

it('does not accent a ceiling the verdict does not recommend bidding to', () => {
  // A no-edge walk still has a solved ceiling; the strip states it without the
  // accent the headline reserves for a bid.
  const walk = decision({
    verdict: 'walk',
    buyerEconomics: economics({ edge: -4_000 }),
    reasons: ['No edge on this lot'],
  });
  expect(ceilingCell(walk).value).toBe('$61,500');
  expect(ceilingCell(walk).tone).toBeUndefined();
  // Zero and absent are different states. A zero ceiling states a short basis
  // and leaves the decision's own sentence — which names both ceilings — to
  // `reasons`, where the reader meets it once.
  const noEdgeSentence =
    "No edge on this lot: a professional rebuilder can pay $144,500 and you can pay $0; bidding above your ceiling to win is the winner's curse.";
  expect(ceilingCell(decision({ ceiling: 0, reasons: [noEdgeSentence] }))).toEqual({
    label: 'your ceiling',
    value: '$0',
    note: 'no bid clears your constraints on this lot',
    tone: 'danger',
  });
  expect(ceilingCell(decision({ ceiling: null, reasons: ['awaiting the plan'] }))).toEqual({
    label: 'your ceiling',
    note: 'awaiting the plan',
  });
});

it('says why a market ceiling or an edge is missing rather than printing a number', () => {
  expect(marketCell(undefined)).toEqual({
    label: 'what a pro can pay',
    note: 'needs an exit anchor and a repair plan',
  });
  expect(edgeCell(undefined)).toEqual({
    label: 'edge',
    note: 'needs an exit anchor and a repair plan',
  });
  const unsolved = economics({
    market: { maxBid: null, basis: 'the professional rebuilder', lines: [] },
    edge: null,
  });
  expect(marketCell(unsolved)).toEqual({
    label: 'what a pro can pay',
    note: 'the professional rebuilder',
  });
  expect(edgeCell(unsolved)).toEqual({
    label: 'edge',
    note: 'no professional ceiling was solved on this evidence',
  });
});

it('reads a decision saved before the ceiling became bidder-relative', () => {
  // A record written before the buyer layer carries economics with no market
  // ceiling, no edge and no lines. The strip says so and renders; a projection
  // that read through those keys would take the whole workspace with it.
  const legacy = economics();
  delete (legacy as Partial<BuyerEconomics>).market;
  delete (legacy as Partial<BuyerEconomics>).edge;
  delete (legacy as Partial<BuyerEconomics>).kernelMaxBid;
  delete (legacy as Partial<BuyerEconomics>).lines;
  expect(marketCell(legacy)).toEqual({
    label: 'what a pro can pay',
    note: 'no professional ceiling was solved on this evidence',
  });
  expect(edgeCell(legacy)).toEqual({
    label: 'edge',
    note: 'no professional ceiling was solved on this evidence',
  });
  // The buyer's own ceiling is on the decision, not in the economics, so it
  // still states its number.
  expect(ceilingCell(decision({ buyerEconomics: legacy })).value).toBe('$61,500');
});

it('summarizes a ledger with its money and hides the lines that cost nothing', () => {
  const lines = [costLine('repair', 32_000), costLine('selling', 0), costLine('labor', 0)];
  expect(ledgerSummary('your lines', lines)).toBe(
    'your lines — 3 lines · $32,000 expected · 2 at $0',
  );
  expect(ledgerRows(lines).map((line) => line.id)).toEqual(['repair']);
  // Nothing is hidden when nothing is free, so the summary states no count.
  expect(ledgerSummary('market lines', [costLine('repair', 1)])).toBe(
    'market lines — 1 line · $1 expected',
  );
});

it('user lot renders provenance, not a link', () => {
  const brought = lotProvenance({
    id: 'lot_01',
    source: USER_LOT_SOURCE,
    collectedOn: '2026-09-11T14:32:07.000Z',
  });
  expect(brought).toEqual({
    text: 'user-supplied listing',
    day: '2026-09-11',
    example: false,
  });
  // A listing address the buyer pasted is provenance the server keeps and
  // never dereferences; it is not the lot's own page (SPEC 61).
  expect(
    lotProvenance({
      id: 'lot_01',
      source: USER_LOT_SOURCE,
      url: 'https://example.test/lot/63198496',
      collectedOn: '2026-09-11T14:32:07.000Z',
    }),
  ).toEqual({ text: 'user-supplied listing', day: '2026-09-11', example: false });
  // A recorded catalog lot keeps its host link and says what it is.
  const seeded = getSalvageLot('sf90-front-il')!;
  expect(lotProvenance(seeded)).toEqual({
    text: 'abetter.bid',
    href: seeded.url,
    day: '2026-08-13',
    example: true,
  });
  // A lot stated through the API is neither: it has no page to link and no
  // place in the catalog, so it states the source it claims and its day.
  expect(
    lotProvenance({
      id: 'lot_02',
      source: 'A yard sheet',
      collectedOn: '2026-08-13',
    }),
  ).toEqual({ text: 'A yard sheet', day: '2026-08-13', example: false });
  // An unparseable collection stamp still reads as a date rather than a hole.
  expect(
    lotProvenance({ id: 'lot_03', source: USER_LOT_SOURCE, collectedOn: 'whenever' }).day,
  ).toBe('date unknown');
});

it('closes the salvage report with the lot it priced, and links only what it can', () => {
  const seeded = getSalvageLot('sf90-front-il')!;
  const recorded = lotFooterSentence(seeded, '2026-08-01');
  expect(recorded.lead + recorded.source + recorded.tail).toBe(
    'lot data collected 2026-08-13 from abetter.bid · bids shown are as of collection and move daily · fees from the Copart schedule as of 2026-08-01, simplified',
  );
  expect(recorded.href).toBe(seeded.url);
  // A lot the buyer brought states its source where the link would be, and the
  // day it was collected rather than the stamp it was saved with (SPEC 61). No
  // ledger priced this one, so the fees clause is absent.
  const brought = lotFooterSentence({
    id: 'lot_01',
    source: USER_LOT_SOURCE,
    collectedOn: '2026-09-11T14:32:07.000Z',
  });
  expect(brought.lead + brought.source + brought.tail).toBe(
    'lot data collected 2026-09-11 from user-supplied listing · bids shown are as of collection and move daily',
  );
  expect(brought.href).toBeUndefined();
});

it('keeps the outcome prompt pending until an outcome answers it', () => {
  expect(outcomePrompt({ assessment: { outcomes: [] } })).toEqual({ pending: false });
  expect(
    outcomePrompt({
      assessment: { outcomes: [] },
      outcomePromptedAt: '2026-09-08T06:00:00.000Z',
    }),
  ).toEqual({ pending: true, at: '2026-09-08T06:00:00.000Z' });
});

it('reads the ask the record carries, so a second week reopens an answered prompt', () => {
  const answered = [{ at: '2026-09-09T10:00:00.000Z', kind: 'passed' as const, note: 'let it go' }];
  expect(
    outcomePrompt({
      assessment: { outcomes: answered },
      outcomePromptedAt: '2026-09-08T06:00:00.000Z',
    }),
  ).toEqual({ pending: false });
  expect(
    outcomePrompt({
      assessment: { outcomes: answered },
      outcomePromptedAt: '2026-09-15T06:00:00.000Z',
    }),
  ).toEqual({ pending: true, at: '2026-09-15T06:00:00.000Z' });
});

it('names a lost lot as the pass it was, not as the stored kind', () => {
  expect(outcomeLabel('lost_to_hammer')).toBe('passed, sold to someone else');
  expect(outcomeLabel('purchased')).toBe('purchased');
});

it.each([
  ['no-model', 'schedule · no model · $0 model cost'],
  ['fixture', 'fixture model · $0 model cost'],
  ['live-coordinator', 'live model'],
] as const)('labels %s activity by what actually ran', (modelMode, label) => {
  const html = renderToStaticMarkup(
    createElement(ActivityLog, {
      events: [
        {
          id: 'event-1',
          sessionId: modelMode === 'no-model' ? 'schedule' : 'session-1',
          type: 'outcome_prompt',
          at: '2026-09-06T06:00:00.000Z',
          data: {},
          modelMode,
        },
      ],
      unavailable: false,
    }),
  );
  expect(html).toContain(label);
});
