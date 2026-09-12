/** Persist inspectable action and usage events without reasoning text; event IDs deduplicate delivery. */
import { randomUUID } from 'node:crypto';
import { activityStatement, type ActivityEvent } from '../../src/assessment-http/activity';
import { modelMode } from './settings';

export type { ActivityEvent };

export async function saveActivity(
  ownerId: string,
  assessmentId: string,
  event: Omit<ActivityEvent, 'modelMode'>,
) {
  await activityStatement((db) =>
    db.execute({
      sql: 'INSERT OR IGNORE INTO assessment_agent_events VALUES (?,?,?,?,?,?,?,?)',
      args: [
        event.id,
        ownerId,
        assessmentId,
        event.sessionId,
        event.type,
        event.at,
        modelMode(),
        JSON.stringify(event.data),
      ],
    }),
  );
}

export async function reserveLiveModelCall(
  ownerId: string,
  assessmentId: string,
  sessionId: string,
): Promise<void> {
  const reserved = await activityStatement((db) =>
    db.execute({
      sql: 'INSERT INTO assessment_agent_model_calls (id,session_id,owner_id,assessment_id,requested_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM assessment_agent_model_calls WHERE session_id=?) < 12',
      args: [randomUUID(), sessionId, ownerId, assessmentId, new Date().toISOString(), sessionId],
    }),
  );
  if (!reserved.rowsAffected) throw new Error('Coordinator provider-call limit reached.');
}
