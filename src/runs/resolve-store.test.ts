import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibsqlRunStore } from './libsql-store';
import { PgRunStore } from './pg-store';
import { MemoryRunStore } from './store';

/**
 * The persistence ladder (SPEC 31): Postgres when reachable, else the libSQL
 * vehicle database when it answers, else memory. Both probes are cached, and
 * a cached failure has to expire sooner than a cached success or a recovered
 * database stays invisible for a minute.
 */

const pgAvailable = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
const execute = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getDb = vi.hoisted(() => vi.fn(() => ({ execute }) as unknown as never));

vi.mock('@/db/pg', () => ({
  pgAvailable,
  // PgRunStore takes its pool from here; nothing in these tests queries it.
  getPool: () => ({}) as never,
}));
vi.mock('@/lib/db', () => ({ getDb }));

type StoreGlobal = typeof globalThis & {
  __paddockStores?: unknown;
  __paddockLibsqlProbe?: unknown;
};

// The module keeps its stores and its probe on globalThis so a dev hot
// reload does not fork them; a test that leaked either would poison the next.
function resetSingletons() {
  delete (globalThis as StoreGlobal).__paddockStores;
  delete (globalThis as StoreGlobal).__paddockLibsqlProbe;
}

async function load() {
  return import('./resolve-store');
}

describe('run store ladder', () => {
  beforeEach(() => {
    resetSingletons();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    pgAvailable.mockReset();
    execute.mockReset();
    getDb.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSingletons();
  });

  it('takes Postgres when it answers, without probing libSQL at all', async () => {
    const { resolveRunStore } = await load();
    pgAvailable.mockResolvedValue(true);
    const store = await resolveRunStore();
    expect(store).toBeInstanceOf(PgRunStore);
    expect(store.persistent).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('falls to libSQL when Postgres is down but the vehicle database answers', async () => {
    const { resolveRunStore } = await load();
    pgAvailable.mockResolvedValue(false);
    execute.mockResolvedValue({ rows: [] });
    const store = await resolveRunStore();
    expect(store).toBeInstanceOf(LibsqlRunStore);
    expect(store.persistent).toBe(true);
  });

  it('falls to memory when neither answers, and says it is not persistent', async () => {
    const { resolveRunStore } = await load();
    pgAvailable.mockResolvedValue(false);
    execute.mockRejectedValue(new Error('SQLITE_CANTOPEN'));
    const store = await resolveRunStore();
    expect(store).toBeInstanceOf(MemoryRunStore);
    expect(store.persistent).toBe(false);
  });

  it('reuses one instance per rung rather than building a store per request', async () => {
    const { resolveRunStore, memoryRunStore } = await load();
    pgAvailable.mockResolvedValue(false);
    execute.mockRejectedValue(new Error('down'));
    const first = await resolveRunStore();
    const second = await resolveRunStore();
    expect(second).toBe(first);
    expect(memoryRunStore()).toBe(first);
  });
});

describe('libsql probe caching', () => {
  beforeEach(() => {
    resetSingletons();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    pgAvailable.mockReset().mockResolvedValue(false);
    execute.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSingletons();
  });

  it('a success is cached for a minute, then re-probed', async () => {
    const { libsqlAvailable } = await load();
    execute.mockResolvedValue({ rows: [] });
    expect(await libsqlAvailable()).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-06T12:00:59.000Z'));
    expect(await libsqlAvailable()).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-06T12:01:00.001Z'));
    expect(await libsqlAvailable()).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('a failure is cached for five seconds, so recovery is noticed quickly', async () => {
    const { libsqlAvailable } = await load();
    execute.mockRejectedValue(new Error('down'));
    expect(await libsqlAvailable()).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-06T12:00:04.900Z'));
    expect(await libsqlAvailable()).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);

    // Past the failure TTL the database is asked again, and a recovered one
    // is picked up long before the success TTL would have allowed.
    vi.setSystemTime(new Date('2026-09-06T12:00:05.001Z'));
    execute.mockResolvedValue({ rows: [] });
    expect(await libsqlAvailable()).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('the ladder climbs back to libSQL once the probe recovers', async () => {
    const { resolveRunStore } = await load();
    execute.mockRejectedValue(new Error('down'));
    expect(await resolveRunStore()).toBeInstanceOf(MemoryRunStore);

    vi.setSystemTime(new Date('2026-09-06T12:00:05.001Z'));
    execute.mockResolvedValue({ rows: [] });
    expect(await resolveRunStore()).toBeInstanceOf(LibsqlRunStore);
  });

  it('a fresh process starts with no cached probe', async () => {
    const { libsqlAvailable } = await load();
    execute.mockResolvedValue({ rows: [] });
    await libsqlAvailable();
    expect((globalThis as StoreGlobal).__paddockLibsqlProbe).toBeDefined();
    resetSingletons();
    expect((globalThis as StoreGlobal).__paddockLibsqlProbe).toBeUndefined();
    await libsqlAvailable();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
