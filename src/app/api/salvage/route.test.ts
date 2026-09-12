import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartRunOptions } from '@/runs/manager';
import { SALVAGE_LOTS } from '@/salvage/seed-lots';
import { finalizeSalvage, GET, POST } from './route';

/**
 * Same start-route contract as the inspector, plus the dedup rule: a lot
 * already being assessed attaches to the run in flight instead of paying
 * for a second one. The assessment itself is stubbed — starting one here
 * would mean model calls.
 */

const hoisted = vi.hoisted(() => ({
  afterCalls: [] as (() => unknown)[],
  startRun: vi.fn<(opts: StartRunOptions) => string>(),
  runCompletion: vi.fn<(id: string) => Promise<void>>(),
  findActiveRun:
    vi.fn<
      (predicate: (record: { kind: string; input: unknown }) => boolean) => string | undefined
    >(),
  store: { persistent: true },
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (fn: () => unknown) => void hoisted.afterCalls.push(fn) };
});

vi.mock('@/runs/manager', () => ({
  startRun: hoisted.startRun,
  runCompletion: hoisted.runCompletion,
  findActiveRun: hoisted.findActiveRun,
}));

vi.mock('@/runs/resolve-store', () => ({
  resolveRunStore: async () => hoisted.store,
}));

const RUN_ID = '99999999-8888-4777-8666-555555555555';
const LOT = SALVAGE_LOTS[0];

const post = (body: unknown, raw?: string) =>
  POST(
    new NextRequest('https://paddock.test/api/salvage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }),
  );

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

describe('POST /api/salvage', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    hoisted.afterCalls.length = 0;
    hoisted.store.persistent = true;
    hoisted.startRun.mockReset().mockReturnValue(RUN_ID);
    hoisted.runCompletion.mockReset().mockResolvedValue(undefined);
    hoisted.findActiveRun.mockReset().mockReturnValue(undefined);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('a body that is not JSON is a 400', async () => {
    const response = await post(undefined, '<html>');
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('body must be JSON');
  });

  it('a body without a lotId is a 400', async () => {
    const response = await post({ lot: 'sf90' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('provide a lotId');
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('without a key it refuses with 503', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const response = await post({ lotId: LOT.id });
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('ANTHROPIC_API_KEY is not configured on the server');
  });

  it('an unknown lot is a 404 naming the lot', async () => {
    const response = await post({ lotId: 'no-such-lot' });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe('unknown lot "no-such-lot"');
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('a lot already in flight attaches to that run with 200, spending nothing', async () => {
    hoisted.findActiveRun.mockReturnValue('existing-run-id');
    const response = await post({ lotId: LOT.id });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 'existing-run-id', existing: true });
    expect(hoisted.startRun).not.toHaveBeenCalled();
    expect(hoisted.afterCalls).toHaveLength(0);
  });

  it('the dedup predicate matches this lot alone', async () => {
    await post({ lotId: LOT.id });
    const predicate = hoisted.findActiveRun.mock.calls[0][0];
    expect(predicate({ kind: 'salvage', input: { lotId: LOT.id } })).toBe(true);
    expect(predicate({ kind: 'salvage', input: { lotId: 'another-lot' } })).toBe(false);
    expect(predicate({ kind: 'inspect', input: { lotId: LOT.id } })).toBe(false);
    expect(predicate({ kind: 'salvage', input: undefined })).toBe(false);
  });

  it('a seeded lot starts a run and answers 202 with the id and persistence', async () => {
    const response = await post({ lotId: LOT.id });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ id: RUN_ID, persisted: true });

    const opts = hoisted.startRun.mock.calls[0][0];
    expect(opts.kind).toBe('salvage');
    expect(opts.title).toBe(LOT.title);
    expect(opts.vehicle).toEqual({ make: LOT.make, model: LOT.model, year: LOT.year });
    expect(opts.input).toMatchObject({ lotId: LOT.id, listing: { url: LOT.url } });
  });

  it('hands the run completion to after()', async () => {
    await post({ lotId: LOT.id });
    expect(hoisted.afterCalls).toHaveLength(1);
    await hoisted.afterCalls[0]();
    expect(hoisted.runCompletion).toHaveBeenCalledWith(RUN_ID);
  });
});

describe('GET /api/salvage', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('reports readiness and the catalog size', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await expect((await GET()).json()).resolves.toEqual({
      status: 'ready',
      lots: SALVAGE_LOTS.length,
    });
    delete process.env.ANTHROPIC_API_KEY;
    await expect((await GET()).json()).resolves.toMatchObject({ status: 'degraded' });
  });
});

describe('finalizeSalvage', () => {
  const report = { assessment: { verdict: 'walk' } };

  it('takes the report event as the outcome', () => {
    expect(finalizeSalvage([{ type: 'report', report }])).toEqual({ report, verdict: 'walk' });
  });

  it('a fatal beats a report', () => {
    expect(
      finalizeSalvage([
        { type: 'report', report },
        { type: 'fatal', message: 'triage failed' },
      ]),
    ).toEqual({ error: 'triage failed' });
  });

  it('a stream that ends with neither is named as such', () => {
    expect(finalizeSalvage([])).toEqual({ error: 'assessment ended without a report' });
  });
});
