'use client';

/**
 * The assessment's identity and its research controls: which car this is,
 * what evidence it is built from, and the one action this screen offers.
 * Failure, notice and capability lines sit here because they qualify the
 * action rather than the decision.
 */
import Link from 'next/link';
import { actionLinkClass, buttonClass, type AssessmentDetail } from './client';
import { provenanceLabel, type ResearchAction } from './format';
import { LotProvenanceLine } from './lot-provenance';

export function AssessmentHeader({
  data,
  busy,
  failure,
  notice,
  act,
}: {
  data: AssessmentDetail;
  busy: boolean;
  failure: string;
  notice: string;
  act: (action: ResearchAction) => void;
}) {
  const a = data.assessment;
  return (
    <header className="space-y-3">
      <Link href="/assessments" className="type-body text-accent">
        All assessments
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="type-h1 break-words">{a.lot.title}</h1>
          <p className="type-spec break-all text-dim">{a.lot.vin}</p>
          {/* DESIGN.md places this under the VIN: who brought the lot, on the
              record itself, with a link only when the lot has a page of its
              own (SPEC 61). The record's own line follows it. */}
          <LotProvenanceLine lot={a.lot} />
          <p className="type-meta">
            {provenanceLabel(a)} · revision {a.revision} · {a.status}
          </p>
        </div>
        {/* DESIGN.md: one primary action per screen. A stopped assessment
            can only be refreshed; a working one can only be continued. */}
        <div className="flex flex-wrap items-center gap-4">
          {a.status === 'stopped' ? (
            <button
              type="button"
              className={buttonClass}
              disabled={busy || a.budget.usedInvestigations >= a.budget.maxInvestigations}
              onClick={() => void act('refresh')}
            >
              Refresh evidence
            </button>
          ) : (
            <button
              type="button"
              className={buttonClass}
              disabled={
                busy ||
                (a.mode === 'live' && !data.agent.liveEvidenceEnabled) ||
                a.status === 'investigating'
              }
              onClick={() => void act('run')}
            >
              Continue research
            </button>
          )}
          {a.status !== 'stopped' && (
            <button
              type="button"
              className={actionLinkClass}
              disabled={busy}
              onClick={() => void act('stop')}
            >
              Stop research
            </button>
          )}
        </div>
      </div>
      {failure && (
        <p role="alert" className="type-body text-warn">
          {failure}
        </p>
      )}
      {notice && (
        <p role="status" className="type-body text-dim">
          {notice}
        </p>
      )}
      {!data.agent.configured && (
        <p className="type-body text-warn">
          Research agent disconnected. Saved research requests remain queued for bounded recovery.
        </p>
      )}
      {data.research && (
        <p className="type-meta">
          Research delivery: {data.research.status} · {data.research.attempts} attempts
          {data.research.lastError ? ` · ${data.research.lastError}` : ''}
        </p>
      )}
      {a.mode === 'live' && data.agent.configured && !data.agent.liveEvidenceEnabled && (
        <p className="type-body text-warn">
          Live research is disabled. The listing is saved; research will be available when the
          operator enables live sources.
        </p>
      )}
    </header>
  );
}
