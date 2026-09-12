import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStore } from '@/runs/store';
import type { RunSummary } from '@/runs/types';
import { GET } from './route';

/**
 * The run index: a bounded, kind-filtered list whose orphans reconcile on
 * sight (SPEC 30) and whose storage failure is a 503, never a 500.
 */

const hoisted = vi.hoisted(() => ({
  resolveRunStore: vi.fn<() => Promise<RunStore>>(),
}));

vi.mock('@/runs/resolve-store', () => ({ resolveRunStore: hoisted.resolveRunStore }));

type ListOpts = { kind?: string; limit?: number };

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: crypto.randomUUID(),
  kind: 'inspect',
  status: 'done',
  title: '2004 BMW M3',
  vehicle: { make: 'BMW', model: 'M3', year: 2004 },
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

function fakeStore(runs: RunSummary[], persistent = true) {
  const calls: ListOpts[] = [];
  const finished: { id: string; status: string }[] = [];
  const store = {
    persistent,
    async listRuns(opts: ListOpts = {}) {
      calls.push(opts);
      return runs;
    },
    async finishRun(id: string, outcome: { status: string }) {
      finished.push({ id, status: outcome.status });
    },
  } as unknown as RunStore;
  return { store, calls, finished };
}

const get = (query = '') => GET(new NextRequest(`https://paddock.test/api/runs${query}`));

describe('GET /api/runs', () => {
  const savedVercel = process.env.VERCEL_ENV;

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    hoisted.resolveRunStore.mockReset();
  });

  afterEach(() => {
    if (savedVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = savedVercel;
    vi.restoreAllMocks();
  });

  it('defaults to twelve runs and no kind filter', async () => {
    const { store, calls } = fakeStore([]);
    hoisted.resolveRunStore.mockResolvedValue(store);
    const response = await get();
    expect(response.status).toBe(200);
    expect(calls[0]).toEqual({ kind: undefined, limit: 12 });
    await expect(response.json()).resolves.toEqual({ runs: [], persisted: true });
  });

  it('clamps the limit to fifty and ignores junk', async () => {
    const cases: [string, number][] = [
      ['?limit=5', 5],
      ['?limit=50', 50],
      ['?limit=999', 50],
      ['?limit=0', 12],
      ['?limit=-3', 12],
      ['?limit=abc', 12],
      ['?limit=2.5', 12],
      ['?limit=', 12],
    ];
    for (const [query, expected] of cases) {
      const { store, calls } = fakeStore([]);
      hoisted.resolveRunStore.mockResolvedValue(store);
      await get(query);
      expect(calls[0].limit, query).toBe(expected);
    }
  });

  it('passes only the two real kinds through as a filter', async () => {
    for (const [query, expected] of [
      ['?kind=inspect', 'inspect'],
      ['?kind=salvage', 'salvage'],
      ['?kind=nonsense', undefined],
      ['?kind=', undefined],
    ] as const) {
      const { store, calls } = fakeStore([]);
      hoisted.resolveRunStore.mockResolvedValue(store);
      await get(query);
      expect(calls[0].kind, query).toBe(expected);
    }
  });

  it('a run left running by a restart is reconciled to error, in the list and in the store', async () => {
    const orphan = summary({ status: 'running', createdAt: '2026-09-01T00:00:00.000Z' });
    const finishedRun = summary({ status: 'done' });
    const { store, finished } = fakeStore([orphan, finishedRun]);
    hoisted.resolveRunStore.mockResolvedValue(store);

    const body = (await (await get()).json()) as { runs: RunSummary[] };
    expect(body.runs[0]).toMatchObject({
      id: orphan.id,
      status: 'error',
      error: 'interrupted before finishing (server restart or function timeout)',
    });
    expect(body.runs[0].finishedAt).toBeTruthy();
    // The correction is written back, not just rendered.
    expect(finished).toEqual([{ id: orphan.id, status: 'error' }]);
    // A run that already finished is untouched.
    expect(body.runs[1]).toMatchObject({ id: finishedRun.id, status: 'done' });
  });

  it('on a multi-instance deployment a young running run is left alone', async () => {
    process.env.VERCEL_ENV = 'production';
    const live = summary({ status: 'running', createdAt: new Date().toISOString() });
    const { store, finished } = fakeStore([live]);
    hoisted.resolveRunStore.mockResolvedValue(store);

    const body = (await (await get()).json()) as { runs: RunSummary[] };
    expect(body.runs[0]).toMatchObject({ status: 'running' });
    expect(finished).toEqual([]);
  });

  it('a store that cannot be reached is a 503 with a sentence, not a stack', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hoisted.resolveRunStore.mockRejectedValue(new Error('ECONNREFUSED 5433'));
    const response = await get();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'run history is unavailable right now',
    });
    expect(error).toHaveBeenCalled();
  });

  it('a degraded store still answers, and says so', async () => {
    const { store } = fakeStore([], false);
    hoisted.resolveRunStore.mockResolvedValue(store);
    await expect((await get()).json()).resolves.toEqual({ runs: [], persisted: false });
  });
});
