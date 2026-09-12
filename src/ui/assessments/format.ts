/**
 * Pure labels for the assessment workspace, unit-tested like `src/ui/format.ts`.
 * Nothing here computes money: it states what the saved decision already holds,
 * and says so with an en dash and a reason when the decision holds nothing.
 */
import { USER_LOT_SOURCE } from '@/assessments/lot-source';
import type { ActivityEvent } from '@/assessment-http/activity';
import { outcomePromptPending } from '@/assessments/outcome-prompt';
import type {
  Assessment,
  AssessmentDecision,
  AssessmentEvidence,
  OutcomeKind,
} from '@/assessments/types';
import { isRecordedLot } from '@/salvage/seed-lot-ids';
import type { CostLine, SalvageLot } from '@/salvage/types';
import { dollars, hostOf } from '@/ui/inspect-format';

// DESIGN.md: a missing number renders as an en dash with its reason. The
// components that render a projection read the same one.
export const MISSING = '–';

export type HeadlineTone = 'accent' | 'danger' | 'dim';
export type CeilingHeadline = {
  word: string;
  // Absent when the state itself is the whole headline, as in a refusal.
  value?: string;
  tone: HeadlineTone;
  // Present only with a missing value; it says why the number is not there.
  reason?: string;
};

/**
 * The five-second answer. A null ceiling is never rendered as `$0`: the two
 * states mean different things, and only one of them is a solved number.
 */
export function ceilingHeadline(decision: AssessmentDecision): CeilingHeadline {
  if (decision.economicDominance)
    return { word: 'Pass under the current economics', tone: 'danger' };
  if (decision.readiness === 'needs_evidence' || decision.verdict === 'needs_evidence')
    return { word: 'More evidence needed', tone: 'dim' };
  if (decision.verdict === 'walk') return { word: 'No bid', tone: 'danger' };
  if (decision.ceiling === null)
    return {
      word: 'Bid ceiling',
      value: MISSING,
      tone: 'dim',
      reason: missingCeilingReason(decision),
    };
  if (decision.ceiling <= 0) return { word: 'Bid ceiling', value: '$0', tone: 'danger' };
  return { word: 'Bid ceiling', value: dollars(decision.ceiling), tone: 'accent' };
}

/** Why a decision carries no ceiling, in the decision's own words. */
export function missingCeilingReason(decision: AssessmentDecision): string {
  return decision.reasons[0] ?? decision.unknowns[0] ?? 'no solved ceiling on the current evidence';
}

/** Buyer-side figures can solve below zero; the sign carries that, not a `$0`. */
export function moneyLabel(value: number): string {
  return value < 0 ? `−${dollars(Math.abs(value))}` : dollars(value);
}

// -- The numbers strip ------------------------------------------------------------

type BuyerEconomics = NonNullable<AssessmentDecision['buyerEconomics']>;

/** What a decision with no exit anchor and no plan can say about money. */
export const NO_ECONOMICS = 'needs an exit anchor and a repair plan';

/** The sentence under the strip: what the edge is, and what its sign means. */
export const EDGE_META =
  "edge = your ceiling − a professional rebuilder's ceiling on this lot; negative means you would be the optimist in the room";

export type StripTone = 'accent' | 'danger' | 'dim' | 'ok';

/**
 * One numbers-strip cell (DESIGN.md): a label over a value, and the basis under
 * it — or, with no value, the reason the number is not there.
 */
export type StripCell = { label: string; value?: string; note: string; tone?: StripTone };

/**
 * The buyer's own ceiling. Accent is the headline's tone rather than the sign's:
 * a ceiling the verdict does not recommend bidding to is stated, not
 * highlighted. A ceiling of zero or less is stated in danger under a short
 * fixed basis, because the decision's own sentence for it names both ceilings
 * and `reasons` carries it already; an absent ceiling keeps the decision's own
 * reason, which is the only thing that says why there is no number.
 */
export function ceilingCell(decision: AssessmentDecision): StripCell {
  const label = 'your ceiling';
  const ceiling = decision.ceiling;
  if (ceiling === null) return { label, note: missingCeilingReason(decision) };
  // A strip cell's meta is a phrase under a number, and the decision's own
  // first reason for a ceiling of zero is a sentence that names both ceilings;
  // it is read once, from `reasons`, rather than twice.
  if (ceiling <= 0)
    return {
      label,
      value: '$0',
      note: 'no bid clears your constraints on this lot',
      tone: 'danger',
    };
  return {
    label,
    value: dollars(ceiling),
    note: 'your ceiling, after your cash limit, DIY time and holding costs',
    ...(ceilingHeadline(decision).tone === 'accent' ? { tone: 'accent' as const } : {}),
  };
}

/**
 * Economics as a saved decision may actually read back. A record written
 * before the ceiling became bidder-relative carries no market ceiling, no edge
 * and no lines; `service.getAssessment` re-projects one on read, and these
 * projections state the absence rather than reading through it, so a stale
 * record can never take the whole workspace down with it (SPEC 60).
 */
export type SavedBuyerEconomics = Omit<BuyerEconomics, 'market' | 'edge' | 'lines'> &
  Partial<Pick<BuyerEconomics, 'market' | 'edge' | 'lines'>>;

/** What stands where the professional rebuilder's ceiling would: unsolved, or never recorded. */
export const NO_MARKET = 'no professional ceiling was solved on this evidence';

/** The marginal professional rebuilder's ceiling on the same evidence (SPEC 60). */
export function marketCell(economics?: SavedBuyerEconomics): StripCell {
  const label = 'what a pro can pay';
  if (!economics) return { label, note: NO_ECONOMICS };
  const market = economics.market;
  if (!market) return { label, note: NO_MARKET };
  if (market.maxBid === null) return { label, note: market.basis };
  return {
    label,
    value: moneyLabel(market.maxBid),
    note: market.basis,
    tone: 'dim',
  };
}

/** The difference between the two ceilings, and what its sign means for the reader. */
export function edgeCell(economics?: SavedBuyerEconomics): StripCell {
  const label = 'edge';
  if (!economics) return { label, note: NO_ECONOMICS };
  const edge = economics.edge;
  if (edge === null || edge === undefined) return { label, note: NO_MARKET };
  return {
    label,
    value: moneyLabel(edge),
    note:
      edge > 0
        ? "you can pay more for this lot than the room's price setter"
        : edge < 0
          ? 'you would be the optimist in the room'
          : "your ceiling is the room's price",
    ...(edge > 0 ? { tone: 'ok' as const } : edge < 0 ? { tone: 'danger' as const } : {}),
  };
}

// -- Ledger lines -----------------------------------------------------------------

/**
 * The disclosure summary for one bidder's cost lines, in the collapsed-evidence
 * grammar (DESIGN.md): the count, the money, and how many lines cost nothing —
 * those carry their basis here instead of taking a row.
 */
export function ledgerSummary(label: string, lines: CostLine[]): string {
  const free = lines.filter((line) => line.expected === 0).length;
  const expected = lines.reduce((sum, line) => sum + line.expected, 0);
  return [
    `${label} — ${lines.length} line${lines.length === 1 ? '' : 's'}`,
    `${moneyLabel(expected)} expected`,
    ...(free ? [`${free} at $0`] : []),
  ].join(' · ');
}

/** The lines a table shows: a line that costs nothing is stated in the summary. */
export function ledgerRows(lines: CostLine[]): CostLine[] {
  return lines.filter((line) => line.expected !== 0);
}

/**
 * What the reader is looking at. A synthetic case is invented data and says
 * so; a recorded case is real evidence replayed without live research.
 */
export function provenanceLabel(assessment: Pick<Assessment, 'mode' | 'evidence'>): string {
  if (assessment.mode !== 'fixture') return 'live evidence';
  return assessment.evidence.some((e) => e.source.capturedBy === 'synthetic_fixture')
    ? 'synthetic fixture · not a real acquisition'
    : 'recorded demo · no live research';
}

// -- Where a lot came from --------------------------------------------------------

/** The label a recorded catalog lot carries, so a demonstration reads as one. */
export const RECORDED_EXAMPLE = 'recorded example';

/**
 * A lot's provenance as a surface renders it: who the data came from, the day
 * it was collected, a link only where there is a page to open, and whether the
 * lot is one the product recorded. Each surface writes its own sentence around
 * these; only `text` belongs inside the link.
 */
export type LotProvenance = { text: string; href?: string; day: string; example: boolean };

/** The day a lot's data was collected; a stamp carrying a time states its day alone. */
function collectedDay(collectedOn: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(collectedOn)?.[0] ?? dateLabel(collectedOn);
}

/**
 * Where a lot's data came from. A lot the buyer brought has no page of its
 * own: the listing address it may carry is provenance the server keeps and
 * never dereferences, so every surface states `user-supplied listing` and the
 * day instead of offering a link (SPEC 61). A recorded catalog lot keeps its
 * source host as a link and reads as an example.
 */
export function lotProvenance(
  lot: Pick<SalvageLot, 'id' | 'source' | 'url' | 'collectedOn'>,
): LotProvenance {
  const common = { day: collectedDay(lot.collectedOn), example: isRecordedLot(lot.id) };
  return lot.source !== USER_LOT_SOURCE && lot.url
    ? { text: hostOf(lot.url), href: lot.url, ...common }
    : { text: lot.source, ...common };
}

/**
 * The salvage report's closing line, as parts: the concatenation is the
 * sentence the reader sees, and only `source` belongs inside the link. The
 * fees clause is there when a ledger priced the lot and absent when none did.
 */
export type LotFooterSentence = { lead: string; source: string; href?: string; tail: string };

export function lotFooterSentence(
  lot: Pick<SalvageLot, 'id' | 'source' | 'url' | 'collectedOn'>,
  feesScheduleDate?: string,
): LotFooterSentence {
  const provenance = lotProvenance(lot);
  return {
    lead: `lot data collected ${provenance.day} from `,
    source: provenance.text,
    ...(provenance.href ? { href: provenance.href } : {}),
    tail:
      ' · bids shown are as of collection and move daily' +
      (feesScheduleDate
        ? ` · fees from the Copart schedule as of ${feesScheduleDate}, simplified`
        : ''),
  };
}

export type ResearchAction = 'run' | 'refresh' | 'stop';

/**
 * What actually happened to a research request. Only the run route dispatches
 * inline, so only its answer carries `accepted`, and it means one thing: a
 * session started. Every other route answers `saved`, and its intent waits for
 * the deployment's schedule (SPEC 57). Each refusal reason has its own
 * sentence; a reason that has none reads as queued work.
 */
export function runNotice(
  action: ResearchAction,
  research?: { accepted?: boolean; reason?: string },
): string {
  if (action === 'stop') return 'Research stopped. The evidence and decisions are saved.';
  if (research?.accepted === true) return 'Research started.';
  if (research?.reason === 'already_running') return 'Research is already running.';
  if (research?.reason === 'agent_not_configured')
    return 'The research agent is not configured for this deployment. Your assessment is saved.';
  if (research?.reason === 'not_runnable')
    return 'There is no runnable research request for this assessment.';
  return 'Research queued; the agent will continue when it is reachable.';
}

// -- The outcome loop ------------------------------------------------------------

/**
 * What the desk is still waiting to be told. The record carries when the
 * deployment's schedule last asked, read server-side exactly as the saved-
 * decisions list reads it; an outcome saved after that answers it, and until
 * then the workspace says so (SPEC 62).
 */
export type OutcomePromptState = { pending: boolean; at?: string };
export function outcomePrompt(detail: {
  assessment: Pick<Assessment, 'outcomes'>;
  outcomePromptedAt?: string;
}): OutcomePromptState {
  return outcomePromptPending(detail.outcomePromptedAt, detail.assessment.outcomes)
    ? { pending: true, at: detail.outcomePromptedAt }
    : { pending: false };
}

/** What the reader clicks to answer the prompt, beside what it is about. */
export const OUTCOME_PROMPT_BANNER = 'The sale date has passed · ';
export const RECORD_OUTCOME = 'Record outcome';
/** Beside a saved decision whose lot is waiting for its outcome. */
export const OUTCOME_DUE_TAG = 'outcome due';

/** A recorded outcome in words, not in the stored kind. */
export function outcomeLabel(kind: OutcomeKind): string {
  switch (kind) {
    case 'passed':
      return 'passed on the car';
    case 'lost_to_hammer':
      return 'passed, sold to someone else';
    case 'purchased':
      return 'purchased';
    case 'sold':
      return 'sold';
    case 'observed':
      return 'observation';
    default: {
      // A new outcome kind must name itself here before it can be listed.
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

export function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'date unknown'
    : date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** Activity provenance states the work that ran, not a deployment setting. */
export function activityModelLabel(event: Pick<ActivityEvent, 'modelMode' | 'sessionId'>): string {
  if (event.modelMode === 'no-model') return `${event.sessionId} · no model · $0 model cost`;
  return event.modelMode === 'fixture' ? 'fixture model · $0 model cost' : 'live model';
}

export function evidenceLabel(evidence: AssessmentEvidence): string {
  switch (evidence.kind) {
    case 'comp':
      return `${evidence.value.year ?? ''} ${evidence.value.vehicle?.make ?? evidence.subject.make} ${evidence.value.vehicle?.model ?? evidence.subject.model} · ${evidence.value.outcome.replaceAll('_', ' ')} ${dollars(evidence.value.price)}`;
    case 'repair_price':
      return `${evidence.value.item} · ${dollars(evidence.value.low)}–${dollars(evidence.value.high)}`;
    case 'identity':
      return 'VIN identity check';
    case 'triage':
      return `Photo triage · ${evidence.value.areas.length} damage areas`;
    case 'title':
      return `Title observation · ${evidence.value.titleBrand}`;
    case 'registration':
      return `Registration eligibility · ${evidence.value.jurisdiction}`;
    case 'inspection':
      return `Physical inspection · ${evidence.value.inspector}`;
    default: {
      // A new evidence kind must name itself here before it can be listed.
      const unhandled: never = evidence;
      return unhandled;
    }
  }
}
