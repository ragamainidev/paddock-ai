'use client';

/**
 * The bounded watch: which sources are re-checked, how often, and until when.
 * A watch spends this assessment's own investigation and money limits, so the
 * form states its bounds and refuses input that would leave one of them open.
 */
import { useState } from 'react';
import { actionLinkClass, fieldClass, type SectionProps } from './client';
import { dateLabel } from './format';
import { watchPayload } from './payloads';

export function WatchForm({ data, busy, save }: SectionProps) {
  const [invalid, setInvalid] = useState('');
  return (
    <details className="border-t border-border pt-4">
      <summary className="type-body cursor-pointer text-accent">
        Watch for relevant evidence changes
      </summary>
      <div className="mt-4 space-y-4">
        <p className="type-body max-w-3xl text-dim">
          Schedule selected sources until your decision deadline. Watches share this assessment’s
          remaining investigation and spending limits. They cannot bid or purchase. The deployment’s
          schedule performs each refresh.
        </p>
        {data.watch && (
          <p className="type-body">
            Watch {data.watch.status}: {data.watch.refreshes} of {data.watch.policy.maxRefreshes}{' '}
            refreshes · next check {dateLabel(data.watch.nextAt)}
            {data.watch.lastError ? ` · ${data.watch.lastError}` : ''}
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const built = watchPayload(new FormData(event.currentTarget));
            if (!built.ok) {
              setInvalid(built.error);
              return;
            }
            setInvalid('');
            void save('watch', built.payload);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block space-y-2">
              <span className="type-label">Check interval (hours)</span>
              <input
                name="intervalHours"
                className={fieldClass}
                type="number"
                min={1}
                max={720}
                defaultValue={6}
                required
              />
            </label>
            <label className="block space-y-2">
              <span className="type-label">Stop watching at</span>
              <input name="until" className={fieldClass} type="datetime-local" required />
            </label>
            <label className="block space-y-2">
              <span className="type-label">Maximum refreshes</span>
              <input
                name="maxRefreshes"
                className={fieldClass}
                type="number"
                min={1}
                max={12}
                defaultValue={2}
                required
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              ['market_comps', 'Market prices'],
              ['photo_triage', 'Photo observations'],
              ['repair_evidence', 'Repair evidence'],
            ].map(([value, label]) => (
              <label key={value} className="type-body flex items-center gap-2">
                <input
                  type="checkbox"
                  name="actionKinds"
                  value={value}
                  defaultChecked={value === 'market_comps'}
                />
                {label}
              </label>
            ))}
          </div>
          {invalid && (
            <p role="alert" className="type-body text-warn">
              {invalid}
            </p>
          )}
          <div className="flex gap-3">
            <button type="submit" className={actionLinkClass} disabled={busy}>
              Save bounded watch
            </button>
            {data.watch?.status === 'active' && (
              <button
                type="button"
                className={actionLinkClass}
                disabled={busy}
                onClick={() => void save('watch', { policy: null })}
              >
                Disable watch
              </button>
            )}
          </div>
        </form>
      </div>
    </details>
  );
}
