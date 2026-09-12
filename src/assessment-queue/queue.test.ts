import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, expect, it } from 'vitest';
import { LibsqlAssessmentStore } from '../assessments/store';
import type { Assessment } from '../assessments/types';
import { createAssessmentService } from '../assessments/service';
import { LibsqlAssessmentQueue, RUN_LEASE_MS } from './queue';
import { createAssessmentWorker } from './worker';
import { watchKindsDue } from './policy';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'paddock-outbox-')),
    url = `file:${join(dir, 'test.db')}`;
  const db = createClient({ url });
  let clock = new Date('2026-09-06T00:00:00Z');
  const store = new LibsqlAssessmentStore(db),
    queue = new LibsqlAssessmentQueue(db, () => clock);
  const service = createAssessmentService({ store, now: () => clock });
  const a = await service.createAssessment('alice', {
    seedLotId: 'sf90-front-il',
    budget: { maxInvestigations: 12 },
    idempotencyKey: 'create',
  });
  cleanups.push(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    a,
    db,
    url,
    store,
    queue,
    service,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
  };
}
it('commits the document and intent atomically, including failed creation and failed CAS', async () => {
  const { a, db, queue, service, store } = await setup();
  expect(await queue.status('alice', a.id)).toMatchObject({
    revision: 1,
    epoch: 0,
    status: 'pending',
    generation: 1,
  });
  await expect(queue.status('bob', a.id)).rejects.toMatchObject({ code: 'not_found' });
  const before = await queue.status('alice', a.id);
  await expect(store.save({ ...a, revision: 3 }, 2)).rejects.toMatchObject({ code: 'conflict' });
  expect(await queue.status('alice', a.id)).toEqual(before);
  await db.execute(
    "CREATE TRIGGER fail_dispatch BEFORE INSERT ON assessment_dispatch BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END",
  );
  await expect(
    service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      idempotencyKey: 'atomic-fail',
    }),
  ).rejects.toThrow();
  expect(
    (await db.execute("SELECT count(*) AS n FROM assessments WHERE create_key='atomic-fail'"))
      .rows[0].n,
  ).toBe(0);
  await db.execute('DROP TRIGGER fail_dispatch');
  await db.execute(
    "CREATE TRIGGER fail_dispatch BEFORE UPDATE ON assessment_dispatch BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END",
  );
  await expect(
    service.refreshAssessment('alice', a.id, a.revision, 'failed-refresh'),
  ).rejects.toThrow();
  expect((await store.get('alice', a.id))?.revision).toBe(1);
  expect(await queue.status('alice', a.id)).toEqual(before);
});
it('coalesces create replay and ordinary investigation updates into the same runtime generation', async () => {
  const { a, service, queue } = await setup();
  await service.createAssessment('alice', {
    seedLotId: 'sf90-front-il',
    budget: { maxInvestigations: 12 },
    idempotencyKey: 'create',
  });
  await queue.requestRun('alice', a.id);
  const lease = (await queue.claim())!;
  await queue.running(lease, 'session');
  const b = await service.investigateAssessment('alice', a.id, a.offeredActions[0].id, a.revision);
  expect(await queue.status('alice', a.id)).toMatchObject({
    generation: 1,
    status: 'running',
    revision: b.revision,
  });
  expect(await queue.claim()).toBeNull();
});
it('retries an outage with the same delivery ID and recovers a persisted expired lease', async () => {
  const { a, queue, service, advance, url } = await setup();
  let calls = 0;
  const worker = createAssessmentWorker({
    queue,
    domain: service,
    dispatch: async () => {
      calls++;
      if (calls === 1) throw new Error('outage');
      return { sessionId: 'session' };
    },
  });
  expect((await worker.tick()).kind).toBe('retry');
  const retry = await queue.status('alice', a.id);
  expect((await worker.tick()).kind).toBe('idle');
  advance(3000);
  expect((await worker.tick()).kind).toBe('dispatched');
  expect((await queue.status('alice', a.id))?.dispatchId).toBe(retry?.dispatchId);
  advance(RUN_LEASE_MS + 1);
  const db2 = createClient({ url });
  cleanups.unshift(() => db2.close());
  const recovered = new LibsqlAssessmentQueue(db2, () => new Date('2026-09-06T00:05:04Z'));
  const lease = (await recovered.claim())!;
  expect(lease.generation).toBe(2);
  expect(lease.ownerId).toBe('alice');
});
it('lets one worker lease an intent, and old acknowledgements cannot resurrect a stopped epoch', async () => {
  const { a, queue, service, url } = await setup();
  const db2 = createClient({ url });
  cleanups.unshift(() => db2.close());
  const other = new LibsqlAssessmentQueue(db2, () => new Date('2026-09-06T00:00:00Z'));
  const claims = await Promise.all([queue.claim(), other.claim()]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claimed = claims.find(Boolean)!;
  const stopped = await service.stopAssessment('alice', a.id, 'Owner cancelled', a.revision);
  await queue.running(claimed, 'late');
  await queue.retry(claimed);
  expect(await queue.status('alice', a.id)).toMatchObject({
    status: 'cancelled',
    revision: stopped.revision,
  });
  expect(await queue.claim()).toBeNull();
  await service.refreshAssessment('alice', a.id, stopped.revision, 'new-epoch');
  expect(await queue.current(claimed)).toBe(false);
  await expect(queue.beginDelivery('alice', a.id, 0, claimed.dispatchId)).rejects.toMatchObject({
    code: 'conflict',
  });
});
it('bounds repeated runtime outages without endless reruns', async () => {
  const { a, queue, service, advance } = await setup();
  let calls = 0;
  const worker = createAssessmentWorker({
    queue,
    domain: service,
    dispatch: async () => {
      calls++;
      throw new Error('offline');
    },
  });
  for (let n = 0; n < 8; n++) {
    await worker.tick();
    advance(400000);
  }
  expect(calls).toBe(5);
  expect(await queue.status('alice', a.id)).toMatchObject({ status: 'blocked', attempts: 5 });
});
it('a lost receipt is deduplicated and terminal hooks cannot settle a newer generation', async () => {
  const { a, queue, service } = await setup();
  const claim = (await queue.claim())!;
  expect((await queue.beginDelivery('alice', a.id, a.epoch, claim.dispatchId)).fresh).toBe(true);
  expect((await queue.beginDelivery('alice', a.id, a.epoch, claim.dispatchId)).fresh).toBe(false);
  await queue.received(claim.dispatchId, { sessionId: 'session' });
  expect((await queue.beginDelivery('alice', a.id, a.epoch, claim.dispatchId)).receipt).toEqual({
    sessionId: 'session',
  });
  const b = await service.refreshAssessment('alice', a.id, a.revision, 'refresh');
  await queue.settled('alice', a.id, a.epoch, claim.dispatchId, false);
  expect(await queue.status('alice', a.id)).toMatchObject({ status: 'pending', epoch: b.epoch });
});

it('acknowledges a saved receipt even after the same epoch completed', async () => {
  const { a, queue, service } = await setup();
  const claim = (await queue.claim())!;
  await queue.beginDelivery('alice', a.id, a.epoch, claim.dispatchId);
  await queue.received(claim.dispatchId, { sessionId: 'finished' });
  await service.stopAssessment('alice', a.id, 'Done', a.revision);
  expect((await queue.beginDelivery('alice', a.id, a.epoch, claim.dispatchId)).receipt).toEqual({
    sessionId: 'finished',
  });
});

it('recovers a transport lease with the same dispatch ID and rejects the old lease token', async () => {
  const { a, queue, advance } = await setup();
  const old = (await queue.claim(1000))!;
  advance(1001);
  const recovered = (await queue.claim())!;
  expect(recovered.dispatchId).toBe(old.dispatchId);
  expect(recovered.leaseToken).not.toBe(old.leaseToken);
  await queue.running(old, 'late');
  expect(await queue.status('alice', a.id)).toMatchObject({
    status: 'leased',
    leaseToken: recovered.leaseToken,
  });
});
it('requeues unfinished terminal turns but holds pending uncertain investigations for their deadline', async () => {
  const { a, queue, store, advance } = await setup();
  const claim = (await queue.claim())!;
  await queue.running(claim, 'session');
  await queue.settled('alice', a.id, 0, claim.dispatchId, true);
  expect(await queue.status('alice', a.id)).toMatchObject({ status: 'pending', generation: 2 });
  advance(3000);
  const next = (await queue.claim())!;
  const action = a.offeredActions[0];
  const b = {
    ...a,
    revision: 2,
    status: 'investigating' as const,
    offeredActions: [],
    investigations: [
      {
        id: 'uncertain',
        action,
        idempotencyKey: 'once',
        status: 'pending' as const,
        startedAt: '2026-09-06T00:00:03Z',
        deadlineAt: '2026-09-06T00:03:33Z',
        evidenceIds: [],
        costCents: 0,
      },
    ],
  };
  await store.save(b, 1);
  await queue.settled('alice', a.id, 0, next.dispatchId, true);
  expect(await queue.status('alice', a.id)).toMatchObject({
    status: 'running',
    leaseUntil: '2026-09-06T00:03:33Z',
  });
  expect(await queue.claim()).toBeNull();
});
it('watches require opt-in, bounded policy and ownership; owner stop disables them atomically', async () => {
  const { a, queue, service } = await setup();
  const manual = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'future', saleDate: '2026-09-07T00:00:00Z' },
  });
  expect(await queue.getWatch('alice', manual.id)).toBeNull();
  const policy = {
    actionKinds: ['market_comps' as const],
    intervalMs: 60000,
    until: '2026-09-06T12:00:00Z',
    maxRefreshes: 2,
  };
  await expect(queue.setWatch('bob', manual.id, policy)).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(
    queue.setWatch('alice', manual.id, { ...policy, until: '2026-09-08T00:00:00Z' }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(queue.setWatch('alice', manual.id, policy, 0)).rejects.toMatchObject({
    code: 'conflict',
  });
  await queue.setWatch('alice', manual.id, policy, manual.revision);
  await service.stopAssessment('alice', manual.id, 'Owner stop', manual.revision);
  expect(await queue.getWatch('alice', manual.id)).toMatchObject({ status: 'disabled' });
});
it('watch claims preserve wakeup count across crash recovery and stop at deadline', async () => {
  const { a, queue, service, advance } = await setup();
  const manual = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'future', saleDate: '2026-09-07T00:00:00Z' },
  });
  await queue.setWatch('alice', manual.id, {
    actionKinds: ['market_comps'],
    intervalMs: 60000,
    until: '2026-09-06T00:03:00Z',
    maxRefreshes: 1,
  });
  advance(60001);
  const first = (await queue.claimWatch())!;
  expect(first.refreshes).toBe(1);
  expect(first.actionKinds).toEqual(['market_comps']);
  advance(31000);
  const recovered = (await queue.claimWatch())!;
  expect(recovered.refreshes).toBe(1);
  expect(recovered.leaseToken).not.toBe(first.leaseToken);
  await queue.finishWatch(first);
  expect(await queue.getWatch('alice', manual.id)).toMatchObject({ status: 'leased' });
  await queue.finishWatch(recovered);
  advance(100000);
  expect(await queue.claimWatch()).toBeNull();
  expect(await queue.getWatch('alice', manual.id)).toMatchObject({ status: 'completed' });
});

it('recovers an expired paid investigation without executing that action again', async () => {
  const { a, queue, store, service, advance } = await setup();
  const action = { ...a.offeredActions[0], maxCostCents: 300 };
  const pending = {
    ...a,
    revision: 2,
    status: 'investigating' as const,
    offeredActions: [],
    budget: { ...a.budget, maxCostCents: 300, usedInvestigations: 1, reservedCostCents: 300 },
    investigations: [
      {
        id: 'paid-once',
        action,
        idempotencyKey: 'paid-once',
        status: 'pending' as const,
        startedAt: '2026-09-06T00:00:00Z',
        deadlineAt: '2026-09-06T00:03:30Z',
        evidenceIds: [],
        costCents: 0,
      },
    ],
  };
  await store.save(pending, 1);
  let calls = 0;
  const worker = createAssessmentWorker({
    queue,
    domain: service,
    dispatch: async (current) => {
      calls++;
      expect(current.investigations[0].status).toBe('failed');
      expect(current.offeredActions.some((x) => x.id === action.id)).toBe(false);
      expect(current.budget.spentCostCents).toBe(300);
      expect(current.budget.reservedCostCents).toBe(0);
      return { sessionId: 'recovered' };
    },
  });
  expect((await worker.tick()).kind).toBe('reconciled');
  advance(211000);
  expect((await worker.tick()).kind).toBe('dispatched');
  expect(calls).toBe(1);
});

it('an owner stop after watch claim cannot be undone by a worker refresh', async () => {
  const { a, queue, service, advance } = await setup();
  const manual = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'future', saleDate: '2026-09-07T00:00:00Z' },
  });
  await queue.setWatch('alice', manual.id, {
    actionKinds: ['market_comps'],
    intervalMs: 60000,
    until: '2026-09-06T01:00:00Z',
    maxRefreshes: 2,
  });
  advance(60001);
  const original = queue.claimWatch.bind(queue);
  queue.claimWatch = async () => {
    const value = await original();
    if (value) await service.stopAssessment('alice', manual.id, 'Owner stop', manual.revision);
    return value;
  };
  let refreshes = 0;
  const worker = createAssessmentWorker({
    queue,
    domain: {
      getAssessment: service.getAssessment,
      refreshAssessment: async (...args) => {
        refreshes++;
        return service.refreshAssessment(...args);
      },
    },
    dispatch: async () => ({ sessionId: 'unused' }),
  });
  expect((await worker.tick()).kind).toBe('watch');
  expect(refreshes).toBe(0);
  expect(await queue.getWatch('alice', manual.id)).toMatchObject({ status: 'disabled' });
});

it('does not automatically repeat an uncertain paid source through a watch', async () => {
  const { a } = await setup();
  const action = { ...a.offeredActions.find((x) => x.kind === 'photo_triage')!, maxCostCents: 300 };
  a.investigations.push({
    id: 'uncertain-paid',
    action,
    idempotencyKey: 'once',
    status: 'failed',
    startedAt: '2026-09-05T00:00:00Z',
    finishedAt: '2026-09-05T00:04:00Z',
    deadlineAt: '2026-09-05T00:03:30Z',
    evidenceIds: [],
    costCents: 300,
    costBasis: 'allowance_estimate',
  });
  expect(
    watchKindsDue(
      a,
      {
        actionKinds: ['photo_triage', 'market_comps'],
        intervalMs: 60000,
        until: '2026-09-07T00:00:00Z',
        maxRefreshes: 2,
      },
      '2026-09-06T00:00:00Z',
    ),
  ).toEqual(['market_comps']);
});

/** A saved record shaped as the outcome rule reads it, written without a projection. */
async function reshape(
  store: Awaited<ReturnType<typeof setup>>['store'],
  a: Assessment,
  change: Partial<Assessment>,
): Promise<Assessment> {
  const next = { ...a, ...change, revision: a.revision + 1 };
  await store.save(next, a.revision);
  return next;
}

it('asks for an outcome once the sale is over and the decision is one worth measuring', async () => {
  const { a, queue, service, store, now } = await setup();
  const settled = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'settled', saleDate: '2026-09-05T00:00:00Z' },
    idempotencyKey: 'settled',
  });
  const walked = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'walked', saleDate: '2026-09-04T00:00:00Z' },
    idempotencyKey: 'walked',
  });
  const upcoming = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'upcoming', saleDate: '2026-09-20T00:00:00Z' },
    idempotencyKey: 'upcoming',
  });
  // A sale that has happened is not enough: the decision has to have reached
  // something an outcome can measure.
  expect(await queue.dueOutcomePrompts(now())).toEqual([]);

  const ready = await reshape(store, settled, {
    decision: { ...settled.decision, readiness: 'ready' },
  });
  await reshape(store, walked, { decision: { ...walked.decision, verdict: 'walk' } });
  // A lot whose sale has not happened is never asked about, whatever it decided.
  await reshape(store, upcoming, { decision: { ...upcoming.decision, verdict: 'walk' } });
  expect((await queue.dueOutcomePrompts(now())).map((due) => due.assessmentId).sort()).toEqual(
    [settled.id, walked.id].sort(),
  );
  expect(await queue.dueOutcomePrompts(now())).toContainEqual({
    assessmentId: settled.id,
    ownerId: 'alice',
  });

  // An answered assessment is never asked again.
  await reshape(store, ready, {
    outcomes: [
      { at: now().toISOString(), kind: 'lost_to_hammer', note: 'Sold to the room', hammer: 141000 },
    ],
  });
  expect((await queue.dueOutcomePrompts(now())).map((due) => due.assessmentId)).toEqual([
    walked.id,
  ]);
});

it('asks at most once a week for the same assessment', async () => {
  const { a, queue, service, store, advance, now } = await setup();
  const settled = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'settled', saleDate: '2026-09-05T00:00:00Z' },
    idempotencyKey: 'settled',
  });
  await reshape(store, settled, { decision: { ...settled.decision, readiness: 'ready' } });
  expect(await queue.dueOutcomePrompts(now())).toHaveLength(1);

  await queue.recordOutcomePrompt('alice', settled.id, now().toISOString());
  expect(await queue.dueOutcomePrompts(now())).toEqual([]);
  advance(6 * 86_400_000);
  expect(await queue.dueOutcomePrompts(now())).toEqual([]);
  advance(86_400_000);
  expect(await queue.dueOutcomePrompts(now())).toEqual([
    { assessmentId: settled.id, ownerId: 'alice' },
  ]);

  // The second ask replaces the first, so the cadence runs from the last one.
  await queue.recordOutcomePrompt('alice', settled.id, now().toISOString());
  advance(86_400_000);
  expect(await queue.dueOutcomePrompts(now())).toEqual([]);
});

it('waits out the whole day a calendar sale date states', async () => {
  const { a, queue, service, store, advance, now } = await setup();
  // The shape production stores: the listing's own day, not an instant.
  const settled = await service.createAssessment('alice', {
    lot: { ...a.lot, id: 'settled', saleDate: '2026-09-06' },
    idempotencyKey: 'settled',
  });
  await reshape(store, settled, { decision: { ...settled.decision, readiness: 'ready' } });
  // The clock starts on the morning of the sale.
  advance(6 * 3_600_000);
  expect(now().toISOString()).toBe('2026-09-06T06:00:00.000Z');
  expect(await queue.dueOutcomePrompts(now())).toEqual([]);
  advance(86_400_000);
  expect(await queue.dueOutcomePrompts(now())).toEqual([]);
  advance(86_400_000);
  expect(await queue.dueOutcomePrompts(now())).toEqual([
    { assessmentId: settled.id, ownerId: 'alice' },
  ]);
});

it('returns at most the number of prompts it was asked for', async () => {
  const { a, queue, service, store, now } = await setup();
  for (const id of ['first', 'second', 'third']) {
    const saved = await service.createAssessment('alice', {
      lot: { ...a.lot, id, saleDate: '2026-09-05T00:00:00Z' },
      idempotencyKey: id,
    });
    await reshape(store, saved, { decision: { ...saved.decision, readiness: 'ready' } });
  }
  expect(await queue.dueOutcomePrompts(now(), 2)).toHaveLength(2);
  expect(await queue.dueOutcomePrompts(now())).toHaveLength(3);
});
