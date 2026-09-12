'use client';

/**
 * The runtime's persisted events: what actually executed for this assessment.
 * Fixture model events prove orchestration and nothing about model judgment,
 * so each event states its model mode, or that the schedule called no model.
 */
import type { AgentActivity } from '@/assessment-http/agent';
import { activityModelLabel, dateLabel } from './format';

export function ActivityLog({
  events,
  unavailable,
}: {
  events: AgentActivity[];
  unavailable: boolean;
}) {
  if (events.length === 0 && !unavailable) return null;
  return (
    <section>
      <h2 className="type-h2 border-b border-border pb-3">Agent activity</h2>
      <p className="type-body py-3 text-dim">
        Persisted runtime events show what executed. Fixture model events test orchestration; they
        do not measure model judgment.
      </p>
      {unavailable && (
        <p className="type-meta text-warn">activity unavailable: the last read failed</p>
      )}
      <ol className="divide-y divide-border">
        {events.slice(-30).map((event) => (
          <li key={event.id} className="py-3">
            <p className="type-body">
              {event.type.replaceAll('_', ' ')}{' '}
              <span className="type-meta">· {activityModelLabel(event)}</span>
            </p>
            <p className="type-meta mt-1">{dateLabel(event.at)}</p>
            <details className="mt-1">
              <summary className="type-body cursor-pointer text-accent">Event details</summary>
              <pre className="type-meta mt-2 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(event.data, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
