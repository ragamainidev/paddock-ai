'use client';

/**
 * The assessment's five-second answer: the action, the two ceilings the lot has
 * — this buyer's and the marginal professional rebuilder's — the edge between
 * them, and the vehicle baseline the buyer's constraints are applied to. Every
 * figure is read from the saved decision and every label and tone comes from a
 * projection in `./format`; nothing here computes money, and a number the
 * decision never solved renders as an en dash with its reason (SPEC 60).
 */
import { dollars } from '@/ui/inspect-format';
import { CeilingLadder } from '@/ui/run/ceiling-ladder';
import type { AssessmentDetail } from './client';
import {
  ceilingCell,
  ceilingHeadline,
  edgeCell,
  EDGE_META,
  marketCell,
  MISSING,
  OUTCOME_PROMPT_BANNER,
  outcomePrompt,
  RECORD_OUTCOME,
  type StripCell,
} from './format';

const TONE = {
  accent: 'text-accent',
  danger: 'text-danger',
  dim: 'text-dim',
  ok: 'text-ok',
} as const;

export function DecisionHeadline({ data }: { data: AssessmentDetail }) {
  const a = data.assessment;
  const decision = a.decision;
  const headline = ceilingHeadline(decision);
  const prompt = outcomePrompt(data);
  const economics = decision.buyerEconomics;
  const ledger = decision.report?.ledger;
  return (
    <section className="border-y border-border py-6" aria-label="Current decision">
      <h2 className={`type-display ${TONE[headline.tone]}`}>
        {headline.word}
        {headline.value ? ` ${headline.value}` : ''}
      </h2>
      {headline.reason && <p className="type-meta mt-2">{headline.reason}</p>}
      {/* The sale is over and nobody has said what happened; the anchor is the
          scroll, so the link needs no script of its own (SPEC 62). */}
      {prompt.pending && (
        <p className="type-meta mt-2">
          {OUTCOME_PROMPT_BANNER}
          <a className="text-accent underline underline-offset-4" href="#outcome">
            {RECORD_OUTCOME}
          </a>
        </p>
      )}
      {decision.readiness === 'needs_evidence' && decision.provisionalCeiling !== null && (
        <p className="type-spec mt-2 text-dim">
          Provisional calculation: {dollars(decision.provisionalCeiling)}. Not a bid recommendation.
        </p>
      )}
      <ul className="mt-3 max-w-3xl space-y-2">
        {decision.reasons.map((reason, i) => (
          <li key={i} className="type-body">
            {reason}
          </li>
        ))}
      </ul>
      {a.stopReason && <p className="type-body mt-4 text-dim">Research paused: {a.stopReason}</p>}

      <div className="mt-6 flex flex-col gap-1">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[4px] border border-border bg-border sm:grid-cols-3">
          <Cell {...ceilingCell(decision)} />
          <Cell {...marketCell(economics)} />
          <Cell {...edgeCell(economics)} />
        </div>
        <p className="type-meta">
          {a.budget.usedInvestigations} of {a.budget.maxInvestigations} investigations used
          {ledger?.exit
            ? ` · rebuilt exit ${dollars(ledger.exit.low)}–${dollars(ledger.exit.high)} over ${ledger.exit.n} comp${ledger.exit.n === 1 ? '' : 's'}`
            : ''}
        </p>
        <p className="type-meta">{EDGE_META}</p>
      </div>

      {ledger?.exit && ledger.ladder.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <p className="type-meta">vehicle baseline · before your constraints</p>
          <CeilingLadder ledger={ledger} />
          <p className="type-body max-w-3xl text-dim">
            This baseline excludes your cash limit, DIY opportunity cost and holding costs. Its
            ceiling can be higher than yours, and higher than what a professional rebuilder can pay.
            The buyer-specific decision above governs; this baseline is not your bid recommendation.
          </p>
        </div>
      )}
    </section>
  );
}

// DESIGN.md numbers strip: a label over a 20px mono value, and a meta line
// that carries the basis, or the reason the number is missing. The buyer's
// economics section reads it too, so both strips keep one grammar.
export function Cell({ label, value, note, tone }: StripCell) {
  return (
    <div className="bg-surface p-4">
      <div className="type-label">{label}</div>
      <div
        className={`mt-1 font-mono text-[20px] font-semibold tabular-nums ${tone ? TONE[tone] : ''}`}
      >
        {value ?? MISSING}
      </div>
      <div className="type-meta mt-0.5">{note}</div>
    </div>
  );
}
