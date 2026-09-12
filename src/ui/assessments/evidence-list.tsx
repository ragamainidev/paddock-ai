'use client';

/**
 * Every record the decision is allowed to use, with where it came from and
 * who stands behind it. Owner provenance is labeled (SPEC 56), and only a
 * source the owner can actually inspect offers the review form.
 */
import { hostOf } from '@/ui/inspect-format';
import { actionLinkClass, fieldClass, type SectionProps } from './client';
import { dateLabel, evidenceLabel } from './format';

export function EvidenceList({ data, busy, save }: SectionProps) {
  const a = data.assessment;
  const decision = a.decision;
  return (
    <>
      <section>
        <h2 className="type-h2 border-b border-border pb-3">Evidence</h2>
        {a.evidence.length === 0 && (
          <p className="type-body py-4 text-dim">
            Evidence will appear as investigations complete.
          </p>
        )}
        <ul className="divide-y divide-border">
          {a.evidence.map((e) => (
            <li key={e.id} id={`evidence-${e.id}`} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="type-body">{evidenceLabel(e)}</p>
                <span
                  className={`type-label ${e.status === 'accepted' ? 'text-dim' : 'text-warn'}`}
                >
                  {e.status}
                </span>
              </div>
              <p className="type-body mt-1 text-dim">{e.reason}</p>
              <p className="type-meta mt-2 break-words">
                <a
                  href={e.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline underline-offset-4"
                >
                  {e.source.label || hostOf(e.source.url)}
                </a>{' '}
                · {e.source.capturedBy.replaceAll('_', ' ')} · {dateLabel(e.source.retrievedAt)}
                {e.source.capturedBy === 'user' && (
                  <>
                    {' '}
                    · <span className="text-dim">self-attested</span>
                  </>
                )}
              </p>
              {e.source.capturedBy === 'user' ? (
                // A self-attested record has no captured observation to inspect;
                // its provenance is the owner (SPEC 56).
                <p className="type-meta mt-2">Typed by the owner</p>
              ) : (
                <details className="mt-2">
                  <summary className="type-body cursor-pointer text-accent">
                    Inspect captured observation
                  </summary>
                  <pre className="type-meta mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all border-l border-border pl-3">
                    {JSON.stringify(
                      {
                        subject: e.subject,
                        value: e.value,
                        observation: e.source.observation ?? null,
                        basis: e.source.basis,
                        artifact: e.source.artifact,
                        extraction: e.source.extraction,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
              {e.review && (
                <p className="type-body mt-2 text-dim">
                  Owner review: {e.review.rationale} · {dateLabel(e.review.at)}
                </p>
              )}
              {e.status !== 'rejected' &&
                (e.source.observation || e.source.capturedBy === 'user') &&
                e.source.basis !== 'model_inference' &&
                e.source.capturedBy !== 'model' &&
                (!e.review || ['inspection', 'repair_price'].includes(e.kind)) && (
                  <details className="mt-3">
                    <summary className="type-body cursor-pointer text-accent">
                      Review this source for the assessment
                    </summary>
                    <form
                      className="mt-3 max-w-3xl space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const values = new FormData(event.currentTarget);
                        void save('review', {
                          evidenceIds: [e.id],
                          rationale: String(values.get('rationale') ?? ''),
                        });
                      }}
                    >
                      <p className="type-body text-dim">
                        Accept only findings supported by the source you inspected and applicable to
                        this vehicle. This records your review; it does not independently verify the
                        document or make the car safe.
                      </p>
                      <label className="block space-y-2">
                        <span className="type-label">
                          What did you check, and why does it apply?
                        </span>
                        <textarea
                          className={fieldClass}
                          name="rationale"
                          rows={2}
                          required
                          minLength={10}
                          maxLength={2000}
                        />
                      </label>
                      <button className={actionLinkClass} type="submit" disabled={busy}>
                        Accept reviewed evidence
                      </button>
                    </form>
                  </details>
                )}
            </li>
          ))}
        </ul>
      </section>

      {!!decision.lineage?.length && (
        <details className="border-t border-border pt-4">
          <summary className="type-body cursor-pointer text-accent">
            Trace the decision to its evidence
          </summary>
          <ul className="divide-y divide-border mt-3">
            {decision.lineage
              .filter((node) => node.kind !== 'claim')
              .map((node) => (
                <li className="py-3" key={node.id}>
                  <p className="type-body">{node.summary}</p>
                  <div className="type-meta mt-2 flex flex-wrap gap-3">
                    {node.evidenceIds.map((evidenceId, i) => (
                      <a
                        key={evidenceId}
                        className="text-accent underline underline-offset-4"
                        href={`#evidence-${encodeURIComponent(evidenceId)}`}
                      >
                        Evidence {i + 1}
                      </a>
                    ))}
                  </div>
                </li>
              ))}
          </ul>
        </details>
      )}
    </>
  );
}
