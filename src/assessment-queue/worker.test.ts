/** Real queue and domain behind the worker; only the runtime transport is a stub. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { ActivityWriter } from '../assessment-http/activity';
import { createAssessmentService } from '../assessments/service';
import { LibsqlAssessmentStore } from '../assessments/store';
import { OUTCOME_PROMPT_EVENT, OUTCOME_PROMPT_MESSAGE } from '../assessments/outcome-prompt';
import { LibsqlAssessmentQueue } from './queue';
import { createAssessmentWorker, type QueueDispatch } from './worker';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'paddock-worker-'));
  const db = createClient({ url: `file:${join(dir, 'test.db')}` });
  let clock = new Date('2026-09-06T00:00:00Z');
  const store = new LibsqlAssessmentStore(db);
  const service = createAssessmentService({ store, now: () => clock });
  const queue = new LibsqlAssessmentQueue(db, () => clock);
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const dispatch = vi.fn<QueueDispatch>(async (a) => ({ sessionId: `session-${a.id}` }));
  const activity = vi.fn<ActivityWriter>(async () => undefined);
  return {
    dispatch,
    activity,
    queue,
    service,
    store,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    worker: createAssessmentWorker({
      queue,
      domain: service,
      dispatch,
      activity,
      clock: () => clock,
    }),
  };
}

async function create(service: Awaited<ReturnType<typeof setup>>['service'], key: string) {
  return service.createAssessment('alice', {
    seedLotId: 'sf90-front-il',
    budget: { maxInvestigations: 12 },
    idempotencyKey: key,
  });
}

it('tickFor dispatches only the named assessment', async () => {
  const { dispatch, queue, service, worker } = await setup();
  const first = await create(service, 'first');
  const second = await create(service, 'second');
  expect(await queue.status('alice', second.id)).toMatchObject({ status: 'pending', attempts: 0 });

  expect(await worker.tickFor('alice', first.id)).toEqual({
    kind: 'dispatched',
    assessmentId: first.id,
    sessionId: `session-${first.id}`,
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0].id).toBe(first.id);
  expect(await queue.status('alice', first.id)).toMatchObject({
    status: 'running',
    sessionId: `session-${first.id}`,
  });
  // The unnamed assessment keeps its untouched intent for the schedule.
  expect(await queue.status('alice', second.id)).toMatchObject({ status: 'pending', attempts: 0 });

  // A scoped claim is owner-scoped too, so another account cannot start it.
  expect(await worker.tickFor('bob', second.id)).toEqual({ kind: 'idle' });
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(await queue.status('alice', second.id)).toMatchObject({ status: 'pending', attempts: 0 });
});

it('tick returns idle when nothing is claimable', async () => {
  const { dispatch, queue, service, worker } = await setup();
  const a = await create(service, 'only');
  await queue.running((await queue.claim())!, 'held-session');
  expect(await queue.status('alice', a.id)).toMatchObject({ status: 'running' });

  expect(await worker.tick()).toEqual({ kind: 'idle' });
  expect(dispatch).not.toHaveBeenCalled();
});

it('asks what happened once a week, in the activity log and nowhere else', async () => {
  const { activity, dispatch, service, store, advance, worker } = await setup();
  const a = await create(service, 'settled');
  const settled = { ...a, revision: a.revision + 1 };
  settled.lot = { ...a.lot, saleDate: '2026-09-05T00:00:00Z' };
  settled.decision = { ...a.decision, readiness: 'ready' };
  await store.save(settled, a.revision);

  expect(await worker.promptOutcomes()).toBe(1);
  expect(activity).toHaveBeenCalledTimes(1);
  expect(activity.mock.calls[0][0]).toEqual({
    ownerId: 'alice',
    assessmentId: a.id,
    type: OUTCOME_PROMPT_EVENT,
    data: { message: OUTCOME_PROMPT_MESSAGE },
    at: '2026-09-06T00:00:00.000Z',
  });
  // The desk asks; it starts no session and spends no model call.
  expect(dispatch).not.toHaveBeenCalled();

  advance(6 * 86_400_000);
  expect(await worker.promptOutcomes()).toBe(0);
  expect(activity).toHaveBeenCalledTimes(1);

  advance(86_400_000);
  expect(await worker.promptOutcomes()).toBe(1);
  expect(activity).toHaveBeenCalledTimes(2);
  expect(activity.mock.calls[1][0].at).toBe('2026-09-13T00:00:00.000Z');
});

it('asks nothing about a lot whose sale has not happened', async () => {
  const { activity, service, store, worker } = await setup();
  const a = await create(service, 'upcoming');
  const upcoming = { ...a, revision: a.revision + 1 };
  upcoming.lot = { ...a.lot, saleDate: '2026-09-20T00:00:00Z' };
  upcoming.decision = { ...a.decision, readiness: 'ready' };
  await store.save(upcoming, a.revision);

  expect(await worker.promptOutcomes()).toBe(0);
  expect(activity).not.toHaveBeenCalled();
});
