import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createClient } from '@libsql/client';
import { LibsqlRunStore } from './libsql-store';
import { PgRunStore } from './pg-store';
import { MemoryRunStore, type RunStore } from './store';

// One contract, three implementations. Memory and libSQL (in-memory
// database) run everywhere; the Postgres half runs only when
// POSTGRES_TEST_URL is set — a service container in CI, `pnpm db:up`
// locally. The skip announces itself, because a third of the contract
// quietly not running looks exactly like it passing.

const vehicle = { make: 'BMW', model: 'M3', year: 2004 };

function contractTests(name: string, makeStore: () => RunStore) {
  describe(`${name} run store contract`, () => {
    const freshRun = (store: RunStore, createdAt = new Date().toISOString()) => {
      const id = crypto.randomUUID();
      return {
        id,
        create: () =>
          store.createRun({
            id,
            kind: 'inspect',
            title: '2004 BMW M3',
            vehicle,
            input: { seedId: 'x' },
            createdAt,
          }),
      };
    };

    it('creates a run and reads it back as running', async () => {
      const store = makeStore();
      const { id, create } = freshRun(store);
      await create();
      const run = await store.getRun(id);
      expect(run).toMatchObject({
        id,
        kind: 'inspect',
        status: 'running',
        title: '2004 BMW M3',
        vehicle,
        input: { seedId: 'x' },
      });
      expect(run?.finishedAt).toBeUndefined();
    });

    it('returns null for unknown runs', async () => {
      expect(await makeStore().getRun(crypto.randomUUID())).toBeNull();
    });

    it('appends and replays events in order, honoring fromSeq', async () => {
      const store = makeStore();
      const { id, create } = freshRun(store);
      await create();
      const at = new Date().toISOString();
      await store.appendEvent(id, { seq: 1, at, event: { type: 'a' } });
      await store.appendEvent(id, { seq: 2, at, event: { type: 'b' } });
      await store.appendEvent(id, { seq: 3, at, event: { type: 'c' } });

      const all = await store.getEvents(id);
      expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(all.map((e) => (e.event as { type: string }).type)).toEqual(['a', 'b', 'c']);

      const tail = await store.getEvents(id, 3);
      expect(tail.map((e) => e.seq)).toEqual([3]);
    });

    it('finishes a run with report, verdict, and timestamps', async () => {
      const store = makeStore();
      const { id, create } = freshRun(store);
      await create();
      const finishedAt = new Date().toISOString();
      await store.finishRun(id, {
        status: 'done',
        report: { assessment: { verdict: 'caution' } },
        verdict: 'caution',
        finishedAt,
      });
      const run = await store.getRun(id);
      expect(run).toMatchObject({
        status: 'done',
        verdict: 'caution',
        report: { assessment: { verdict: 'caution' } },
      });
      expect(run?.finishedAt).toBeDefined();
    });

    it('finishes a failed run with an error and no report', async () => {
      const store = makeStore();
      const { id, create } = freshRun(store);
      await create();
      await store.finishRun(id, {
        status: 'error',
        error: 'vision failed',
        finishedAt: new Date().toISOString(),
      });
      const run = await store.getRun(id);
      expect(run).toMatchObject({ status: 'error', error: 'vision failed' });
      expect(run?.report).toBeUndefined();
    });

    it('lists runs newest first and filters by kind', async () => {
      const store = makeStore();
      const a = freshRun(store, new Date(Date.now() - 5000).toISOString());
      await a.create();
      const b = freshRun(store, new Date().toISOString());
      await b.create();

      const list = await store.listRuns({ kind: 'inspect', limit: 500 });
      const ours = list.filter((r) => r.id === a.id || r.id === b.id);
      expect(ours).toHaveLength(2);
      // b was created strictly after a, so b must come first.
      const ids = list.map((r) => r.id);
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
      expect(list.every((r) => r.kind === 'inspect')).toBe(true);
    });
  });
}

contractTests('memory', () => new MemoryRunStore());

const libsql = createClient({ url: ':memory:' });
contractTests('libsql', () => new LibsqlRunStore(libsql));

// The skip is announced by scripts/vitest-global-setup.ts: the reporter
// shows nothing a worker writes to the console, and the main process is
// the only place a warning is actually read.
const pgUrl = process.env.POSTGRES_TEST_URL;
describe.skipIf(!pgUrl)('postgres', () => {
  const pool = new Pool({ connectionString: pgUrl, max: 3 });
  // Three idle connections keep the worker's event loop alive, so the run
  // hangs after the last assertion instead of exiting.
  afterAll(() => pool.end());
  contractTests('postgres', () => new PgRunStore(pool));
});
