/**
 * The inspectable agent activity log, as the app sees it. The app reads it from
 * the shared assessments database directly, so a saved event is visible without
 * an HTTP hop into the agent, and writes the events the deployment itself
 * produces — what no model session did (SPEC 62). The agent's own write side
 * lives in agent/lib/events.ts and reaches the same table through
 * `activityStatement`; both sides reach the same file, so every statement
 * tolerates a held lock.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { resolveAssessmentsUrl } from '@/assessments/database-url';
import { BUSY_TIMEOUT_MS, prepareSharedDatabase, withBusyRetry } from '@/assessment-queue/schema';
import type { ModelMode } from './settings';

export type ActivityEvent = {
  id: string;
  sessionId: string;
  type: string;
  at: string;
  data: unknown;
  modelMode: ModelMode | 'no-model';
};

let db: Client | undefined;
let ready: Promise<void> | undefined;

function connection(): { db: Client; ready: Promise<void> } {
  db ??= createClient({
    url: resolveAssessmentsUrl(process.env),
    authToken: process.env.ASSESSMENTS_AUTH_TOKEN,
    timeout: BUSY_TIMEOUT_MS,
  });
  const connected = db;
  ready ??= prepareSharedDatabase(connected)
    .then(() =>
      connected.batch(
        [
          `CREATE TABLE IF NOT EXISTS assessment_agent_events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, assessment_id TEXT NOT NULL, session_id TEXT NOT NULL, event_type TEXT NOT NULL, emitted_at TEXT NOT NULL, model_mode TEXT NOT NULL, data TEXT NOT NULL)`,
          // The scoped last-ask read states an assessment, a type and takes
          // the latest time, which is this index's own order; the
          // collection-wide read and `listActivity` are not index-ordered
          // (docs/database.md §6.1).
          `CREATE INDEX IF NOT EXISTS assessment_agent_events_by_assessment ON assessment_agent_events(assessment_id, event_type, emitted_at)`,
          `CREATE TABLE IF NOT EXISTS assessment_agent_model_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT NOT NULL, assessment_id TEXT NOT NULL, requested_at TEXT NOT NULL)`,
        ],
        'write',
      ),
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
  return { db, ready };
}

/** One statement against the shared activity tables, resilient to a held lock. */
export async function activityStatement<T>(operation: (db: Client) => Promise<T>): Promise<T> {
  const { db, ready } = connection();
  await ready;
  return withBusyRetry(db, () => operation(db));
}

/** The session id an event the deployment's own schedule wrote carries. */
export const SCHEDULE_SESSION = 'schedule';

export type ActivityWriter = (event: {
  ownerId: string;
  assessmentId: string;
  type: string;
  data: unknown;
  at: string;
}) => Promise<void>;

/**
 * The app's own write into the activity log, for what the deployment does
 * rather than what a model session did: today the outcome prompt the schedule
 * records once a lot's sale is over (SPEC 62). The row shape is the agent's,
 * because both sides render from the same table. Its activity-only mode records
 * what actually ran — no model — regardless of the deployment's model setting.
 */
export const recordActivity: ActivityWriter = async ({ ownerId, assessmentId, type, data, at }) => {
  await activityStatement((db) =>
    db.execute({
      sql: 'INSERT INTO assessment_agent_events (id,owner_id,assessment_id,session_id,event_type,emitted_at,model_mode,data) VALUES (?,?,?,?,?,?,?,?)',
      args: [
        randomUUID(),
        ownerId,
        assessmentId,
        SCHEDULE_SESSION,
        type,
        at,
        'no-model',
        JSON.stringify(data),
      ],
    }),
  );
};

/**
 * When each of an owner's assessments was last prompted for its outcome, read
 * in one statement so a collection answer costs no query per row, and scoped to
 * one assessment for a detail answer, so both surfaces read the same fact
 * rather than one of them scanning a window of events (SPEC 62).
 */
export async function lastPromptedAt(
  ownerId: string,
  type: string,
  assessmentId?: string,
): Promise<Map<string, string>> {
  const only = assessmentId === undefined ? '' : ' AND assessment_id=?';
  const rows = await activityStatement((db) =>
    db.execute({
      sql: `SELECT assessment_id, MAX(emitted_at) AS prompted_at FROM assessment_agent_events WHERE owner_id=? AND event_type=?${only} GROUP BY assessment_id`,
      args: assessmentId === undefined ? [ownerId, type] : [ownerId, type, assessmentId],
    }),
  );
  return new Map(rows.rows.map((row) => [String(row.assessment_id), String(row.prompted_at)]));
}

export async function listActivity(
  ownerId: string,
  assessmentId: string,
): Promise<ActivityEvent[]> {
  const rows = await activityStatement((db) =>
    db.execute({
      sql: 'SELECT id, session_id, event_type, emitted_at, model_mode, data FROM assessment_agent_events WHERE owner_id=? AND assessment_id=? ORDER BY emitted_at, id LIMIT 500',
      args: [ownerId, assessmentId],
    }),
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    type: String(row.event_type),
    at: String(row.emitted_at),
    // Older schedule rows carried the deployment's model setting even though
    // the schedule called no model. Preserve that fact when reading them too.
    modelMode:
      row.session_id === SCHEDULE_SESSION || row.model_mode === 'no-model'
        ? 'no-model'
        : row.model_mode === 'fixture'
          ? 'fixture'
          : 'live-coordinator',
    data: JSON.parse(String(row.data)),
  }));
}
