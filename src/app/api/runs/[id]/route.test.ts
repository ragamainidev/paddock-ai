import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRunStore, type RunStore } from '@/runs/store';
import type { RunRecord } from '@/runs/types';
import { GET } from './route';

/**
 * One run's record. A malformed id is a 400 before any storage is touched,
 * an unknown id a 404, and a storage failure a 503 — never a 500 (SPEC 31).
 */

const hoisted = vi.hoisted(() => ({
  resolveRunStore: vi.fn<() => Promise<RunStore>>(),
}));

vi.mock('@/runs/resolve-store', () => ({ resolveRunStore: hoisted.resolveRunStore }));

const get = (id: string) =>
  GET(new NextRequest(`https://paddock.test/api/runs/${id}`), {
    params: Promise.resolve({ id }),
  });

async function storeWithRun(id: string, status: 'running' | 'done' = 'done') {
  const store = new MemoryRunStore();
  await store.createRun({
    id,
    kind: 'inspect',
    title: '2004 BMW M3',
    vehicle: { make: 'BMW', model: 'M3', year: 2004 },
    input: { seedId: 'e46-m3-original-owner' },
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  if (status === 'done') {
    await store.finishRun(id, {
      status: 'done',
      verdict: 'pass',
      report: { assessment: { verdict: 'pass' } },
      finishedAt: '2026-09-01T00:04:00.000Z',
    });
  }
  return store;
}

describe('GET /api/runs/[id]', () => {
  const savedVercel = process.env.VERCEL_ENV;
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    hoisted.resolveRunStore.mockReset();
  });

  afterEach(() => {
    if (savedVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = savedVercel;
    vi.restoreAllMocks();
  });

  it('an id that is not a uuid is a 400 before storage is touched', async () => {
    hoisted.resolveRunStore.mockResolvedValue(new MemoryRunStore());
    for (const bad of [
      'abc',
      '../secrets',
      '3fa85f64-5717-4562-b3fc',
      `${id}0`,
      'zzz85f64-5717-4562-b3fc-2c963f66afa6',
    ]) {
      const response = await get(bad);
      expect(response.status, bad).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'malformed run id' });
    }
    expect(hoisted.resolveRunStore).not.toHaveBeenCalled();
  });

  it('a well-formed id the store does not know is a 404', async () => {
    hoisted.resolveRunStore.mockResolvedValue(new MemoryRunStore());
    const response = await get(id);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'run not found' });
  });

  it('a finished run comes back with its report', async () => {
    hoisted.resolveRunStore.mockResolvedValue(await storeWithRun(id));
    const response = await get(id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { run: RunRecord };
    expect(body.run).toMatchObject({ id, status: 'done', verdict: 'pass', title: '2004 BMW M3' });
  });

  it('a run this process no longer holds is reconciled rather than reported as running', async () => {
    hoisted.resolveRunStore.mockResolvedValue(await storeWithRun(id, 'running'));
    const body = (await (await get(id)).json()) as { run: RunRecord };
    expect(body.run).toMatchObject({
      status: 'error',
      error: 'interrupted before finishing (server restart or function timeout)',
    });
  });

  it('a storage failure is a 503 with a sentence, not a stack', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hoisted.resolveRunStore.mockRejectedValue(new Error('ECONNREFUSED 5433'));
    const response = await get(id);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'run storage is unavailable right now',
    });
    expect(error).toHaveBeenCalled();
  });
});
