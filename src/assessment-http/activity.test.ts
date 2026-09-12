/** The app's own writes land in the table the workspace already reads (SPEC 62). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { OUTCOME_PROMPT_EVENT, OUTCOME_PROMPT_MESSAGE } from '@/assessments/outcome-prompt';
import {
  activityStatement,
  lastPromptedAt,
  listActivity,
  recordActivity,
  SCHEDULE_SESSION,
} from './activity';

// The module holds one connection for the process, so the address is set before
// the first statement and this file owns it.
const directory = mkdtempSync(join(tmpdir(), 'paddock-activity-'));
process.env.ASSESSMENTS_DATABASE_URL = `file:${join(directory, 'assessments.db')}`;
afterAll(() => rmSync(directory, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

it('records the outcome prompt as an inspectable event with no model behind it', async () => {
  // An admitted live deployment still writes this event without a model call.
  vi.stubEnv('PADDOCK_AGENT_MODE', 'live-coordinator');
  vi.stubEnv('PADDOCK_AGENT_LIVE_ACK', 'yes');
  vi.stubEnv('AI_GATEWAY_API_KEY', 'unused-test-key');
  vi.stubEnv('PADDOCK_AGENT_MODEL', 'unused-test-model');
  await recordActivity({
    ownerId: 'alice',
    assessmentId: 'lot-1',
    type: OUTCOME_PROMPT_EVENT,
    data: { message: OUTCOME_PROMPT_MESSAGE },
    at: '2026-09-06T06:00:00.000Z',
  });
  const events = await listActivity('alice', 'lot-1');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    sessionId: SCHEDULE_SESSION,
    type: OUTCOME_PROMPT_EVENT,
    at: '2026-09-06T06:00:00.000Z',
    modelMode: 'no-model',
    data: { message: OUTCOME_PROMPT_MESSAGE },
  });
  // Another owner's log is a different log.
  expect(await listActivity('bob', 'lot-1')).toEqual([]);
  const stored = await activityStatement((db) =>
    db.execute({
      sql: 'SELECT model_mode FROM assessment_agent_events WHERE id=?',
      args: [events[0].id],
    }),
  );
  expect(stored.rows[0].model_mode).toBe('no-model');
});

it.each(['fixture', 'live-coordinator'])(
  'reads a legacy %s schedule event as work with no model',
  async (mode) => {
    await activityStatement((db) =>
      db.execute({
        sql: 'INSERT INTO assessment_agent_events (id,owner_id,assessment_id,session_id,event_type,emitted_at,model_mode,data) VALUES (?,?,?,?,?,?,?,?)',
        args: [
          `legacy-${mode}`,
          'legacy-owner',
          `legacy-${mode}`,
          'schedule',
          OUTCOME_PROMPT_EVENT,
          '2026-09-06T06:00:00.000Z',
          mode,
          '{}',
        ],
      }),
    );
    expect((await listActivity('legacy-owner', `legacy-${mode}`))[0].modelMode).toBe('no-model');
  },
);

it.each(['fixture', 'live-coordinator', 'no-model'])(
  'preserves the recorded %s mode of an event outside the schedule',
  async (mode) => {
    await activityStatement((db) =>
      db.execute({
        sql: 'INSERT INTO assessment_agent_events (id,owner_id,assessment_id,session_id,event_type,emitted_at,model_mode,data) VALUES (?,?,?,?,?,?,?,?)',
        args: [
          `recorded-${mode}`,
          'recorded-owner',
          `recorded-${mode}`,
          `session-${mode}`,
          'turn.completed',
          '2026-09-06T06:00:00.000Z',
          mode,
          '{}',
        ],
      }),
    );
    expect((await listActivity('recorded-owner', `recorded-${mode}`))[0].modelMode).toBe(mode);
  },
);

it('reads the last ask per assessment for one owner', async () => {
  for (const at of ['2026-09-06T06:00:00.000Z', '2026-09-13T06:00:00.000Z'])
    await recordActivity({
      ownerId: 'carol',
      assessmentId: 'lot-2',
      type: OUTCOME_PROMPT_EVENT,
      data: { message: OUTCOME_PROMPT_MESSAGE },
      at,
    });
  await recordActivity({
    ownerId: 'carol',
    assessmentId: 'lot-3',
    type: 'turn.completed',
    data: {},
    at: '2026-09-14T06:00:00.000Z',
  });
  const prompted = await lastPromptedAt('carol', OUTCOME_PROMPT_EVENT);
  // The latest ask is what the cadence and the banner both read; an event of
  // another type is not an ask.
  expect(prompted.get('lot-2')).toBe('2026-09-13T06:00:00.000Z');
  expect(prompted.has('lot-3')).toBe(false);
  expect(await lastPromptedAt('dave', OUTCOME_PROMPT_EVENT)).toEqual(new Map());
  // Scoped to one record, the detail answer reads the same fact.
  expect(await lastPromptedAt('carol', OUTCOME_PROMPT_EVENT, 'lot-2')).toEqual(
    new Map([['lot-2', '2026-09-13T06:00:00.000Z']]),
  );
  expect(await lastPromptedAt('carol', OUTCOME_PROMPT_EVENT, 'lot-3')).toEqual(new Map());
});
