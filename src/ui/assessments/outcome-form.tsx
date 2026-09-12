'use client';

/**
 * What actually happened, recorded against the decision revision it is
 * compared with. An outcome never joins the evidence a past decision was
 * allowed to use; it only measures that decision after the fact.
 */
import { useState } from 'react';
import { dollars } from '@/ui/inspect-format';
import { actionLinkClass, fieldClass, type SectionProps } from './client';
import { dateLabel, outcomeLabel } from './format';
import { SEED_CHANGED, useSeededForm } from './form-seed';
import { outcomePayload } from './payloads';

export function OutcomeForm({ data, busy, save }: SectionProps) {
  const a = data.assessment;
  const form = useSeededForm(a.revision);
  const [invalid, setInvalid] = useState('');
  return (
    // The decision headline links here once the desk has asked what happened.
    <section id="outcome">
      <h2 className="type-h2 border-b border-border pb-3">Observed outcome</h2>
      <p className="type-body py-3 text-dim">
        Record what happened to compare estimates with actual results. Outcomes never enter the
        evidence available at an earlier decision.
      </p>
      <form
        className="space-y-4"
        onInput={form.onEdit}
        onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const built = outcomePayload(new FormData(element));
          if (!built.ok) {
            setInvalid(built.error);
            return;
          }
          setInvalid('');
          void save('outcome', built.payload).then((saved) => {
            if (saved) {
              element.reset();
              form.settle();
            }
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-2">
            <span className="type-label">Outcome</span>
            <select className={fieldClass} name="kind">
              <option value="passed">Passed on the car</option>
              <option value="lost_to_hammer">Passed, and it sold to someone else</option>
              <option value="purchased">Purchased</option>
              <option value="sold">Sold</option>
              <option value="observed">New outcome observation</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span className="type-label">Earlier decision to compare</span>
            <select
              key={form.key}
              name="decisionRevision"
              className={fieldClass}
              defaultValue={a.decision.revision}
            >
              {[...a.history].reverse().map((d) => (
                <option key={d.revision} value={d.revision}>
                  Revision {d.revision} · {dateLabel(d.at)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-2">
            <span className="type-label">Observed at (blank means now)</span>
            <input name="observedAt" className={fieldClass} type="datetime-local" />
          </label>
          <MoneyField name="hammer" label="Winning bid, whoever won it ($)" />
          <MoneyField name="amount" label="Other observed amount ($)" />
          <MoneyField name="repairCost" label="Actual repair cash cost ($)" />
          <MoneyField name="holdingCost" label="Actual holding cost ($)" />
          <MoneyField name="saleProceeds" label="Net sale proceeds after selling fees ($)" />
        </div>
        <label className="block space-y-2">
          <span className="type-label">What happened and what is included?</span>
          <textarea name="note" className={fieldClass} rows={2} required />
        </label>
        {invalid && (
          <p role="alert" className="type-body text-warn">
            {invalid}
          </p>
        )}
        {form.stale && <p className="type-meta">{SEED_CHANGED}</p>}
        <button className={actionLinkClass} disabled={busy} type="submit">
          Record outcome
        </button>
      </form>
      <ul className="mt-4 divide-y divide-border">
        {a.outcomes.map((outcome, i) => (
          <li className="py-3" key={i}>
            <p className="type-body">
              {outcomeLabel(outcome.kind)}: {outcome.note}
            </p>
            <p className="type-meta mt-1">
              {dateLabel(outcome.at)} · decision revision{' '}
              {outcome.decisionRevision ?? 'not recorded'}
              {outcome.hammer === undefined ? '' : ` · winning bid ${dollars(outcome.hammer)}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MoneyField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block space-y-2">
      <span className="type-label">{label}</span>
      <input name={name} className={fieldClass} type="number" min={0} step="any" />
    </label>
  );
}
