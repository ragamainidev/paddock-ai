'use client';

/**
 * What the decision still needs: the evidence gates and their state, the
 * investigations that would close them, and the assumptions that survive
 * whatever the evidence closes.
 */
import { dollars } from '@/ui/inspect-format';
import type { AssessmentDetail } from './client';

export function Requirements({ data }: { data: AssessmentDetail }) {
  const a = data.assessment;
  const decision = a.decision;
  return (
    <>
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="type-h2 border-b border-border pb-3">Decision requirements</h2>
          {decision.gates?.length ? (
            <ul className="divide-y divide-border">
              {decision.gates.map((gate) => (
                <li key={gate.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="type-body">{gate.label}</p>
                    <span
                      className={`type-label ${gate.status === 'met' ? 'text-dim' : 'text-warn'}`}
                    >
                      {gate.status}
                    </span>
                  </div>
                  <p className="type-body mt-1 text-dim">{gate.detail}</p>
                </li>
              ))}
            </ul>
          ) : decision.unknowns.length ? (
            <ul className="divide-y divide-border">
              {decision.unknowns.map((unknown, i) => (
                <li key={i} className="type-body py-3">
                  {unknown}
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-body py-3 text-dim">
              No outstanding evidence gates in this assessment. The stated assumptions still apply.
            </p>
          )}
        </section>
        <section>
          <h2 className="type-h2 border-b border-border pb-3">Next useful investigations</h2>
          {a.offeredActions.length ? (
            <ol className="divide-y divide-border">
              {a.offeredActions.map((action) => (
                <li key={action.id} className="py-3">
                  <p className="type-body">{action.label}</p>
                  <p className="type-body mt-1 text-dim">{action.reason}</p>
                  {action.impactDollars !== undefined && (
                    <p className="type-spec mt-1 text-dim">
                      Estimated ceiling sensitivity: {dollars(action.impactDollars)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="type-body py-3 text-dim">
              No further automated investigation is currently available. The decision above records
              the remaining limits.
            </p>
          )}
        </section>
      </div>

      {!!decision.residualRisks?.length && (
        <section>
          <h2 className="type-h2 border-b border-border pb-3">Assumptions and residual risk</h2>
          <ul className="space-y-2 py-3">
            {decision.residualRisks.map((risk, i) => (
              <li className="type-body text-dim" key={i}>
                {risk}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
