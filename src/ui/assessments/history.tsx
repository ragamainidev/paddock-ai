'use client';

/**
 * How the decision got here: every investigation the agent ran and every
 * revision the decision passed through, oldest investigation first and newest
 * revision first. A ceiling that was never solved stays unknown here too.
 */
import { dollars } from '@/ui/inspect-format';
import type { AssessmentDetail } from './client';
import { dateLabel } from './format';

export function History({ data }: { data: AssessmentDetail }) {
  const a = data.assessment;
  return (
    <>
      <section>
        <h2 className="type-h2 border-b border-border pb-3">Investigation history</h2>
        <ol className="divide-y divide-border">
          {a.investigations.map((investigation) => (
            <li key={investigation.id} className="py-3">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="type-body">{investigation.action.label}</p>
                <span className="type-meta">{investigation.status}</span>
              </div>
              <p className="type-body mt-1 text-dim">
                {investigation.detail || investigation.action.reason}
              </p>
              <p className="type-meta mt-2">
                {dateLabel(investigation.startedAt)} · {investigation.evidenceIds.length} evidence
                records
              </p>
            </li>
          ))}
        </ol>
        {a.investigations.length === 0 && (
          <p className="type-body py-4 text-dim">The agent has not started an investigation yet.</p>
        )}
      </section>

      <section>
        <h2 className="type-h2 border-b border-border pb-3">Decision revisions</h2>
        <ol className="divide-y divide-border">
          {[...a.history].reverse().map((revision) => (
            <li key={revision.revision} className="py-3">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="type-spec">
                  Revision {revision.revision} · {revision.readiness.replaceAll('_', ' ')}
                </p>
                <p className="type-spec">
                  {revision.provisionalCeiling === null
                    ? 'Ceiling unknown'
                    : `${dollars(revision.provisionalCeiling)} provisional`}
                </p>
              </div>
              <p className="type-body mt-1 text-dim">{revision.reasons.join(' ')}</p>
              <p className="type-meta mt-2">
                {revision.evidenceIds.length} accepted evidence records · {dateLabel(revision.at)}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
