import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_LISTINGS } from '@/inspector/seed-listings';
import type { StartRunOptions } from '@/runs/manager';
import { finalizeInspect, GET, POST } from './route';

/**
 * The start route is the boundary between an untrusted request and a
 * detached run: it validates, refuses honestly when a key or a seed is
 * missing, hands the run's completion to `after()` (SPEC 30), and never
 * persists photo bytes (SPEC 29). The run itself is stubbed — starting one
 * here would mean model calls.
 */

const hoisted = vi.hoisted(() => ({
  afterCalls: [] as (() => unknown)[],
  startRun: vi.fn<(opts: StartRunOptions) => string>(),
  runCompletion: vi.fn<(id: string) => Promise<void>>(),
  store: { persistent: true },
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  // `after` throws outside a request scope; the test observes the callback.
  return { ...actual, after: (fn: () => unknown) => void hoisted.afterCalls.push(fn) };
});

vi.mock('@/runs/manager', () => ({
  startRun: hoisted.startRun,
  runCompletion: hoisted.runCompletion,
}));

vi.mock('@/runs/resolve-store', () => ({
  resolveRunStore: async () => hoisted.store,
}));

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const SEED = SEED_LISTINGS[0];

const post = (body: unknown, raw?: string) =>
  POST(
    new NextRequest('https://paddock.test/api/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }),
  );

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error;

describe('POST /api/inspect', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    hoisted.afterCalls.length = 0;
    hoisted.store.persistent = true;
    hoisted.startRun.mockReset().mockReturnValue(RUN_ID);
    hoisted.runCompletion.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('a body that is not JSON is a 400, not a crash', async () => {
    const response = await post(undefined, 'not json at all');
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('body must be JSON');
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('a request with neither a seed nor photos plus identity is refused', async () => {
    const response = await post({});
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('provide a seedId, or photos plus make/model/year');
  });

  it('more than eight photos is refused before any run starts', async () => {
    const photo = { kind: 'url', url: 'https://cdn.test/photo.jpg' };
    const response = await post({
      photos: Array.from({ length: 9 }, () => photo),
      make: 'BMW',
      model: 'M3',
      year: 2004,
    });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/8/);
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('an upload past the size cap is refused', async () => {
    const response = await post({
      photos: [{ kind: 'upload', mediaType: 'image/jpeg', data: 'A'.repeat(7_000_001) }],
      make: 'BMW',
      model: 'M3',
      year: 2004,
    });
    expect(response.status).toBe(400);
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('a non-https photo url is refused: the probe dereferences these', async () => {
    const response = await post({
      photos: [{ kind: 'url', url: 'http://cdn.test/photo.jpg' }],
      make: 'BMW',
      model: 'M3',
      year: 2004,
    });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('photo urls must be https');
  });

  it('without a key it refuses with 503 rather than faking an inspection', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const response = await post({ seedId: SEED.id });
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe('ANTHROPIC_API_KEY is not configured on the server');
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('the key check comes after validation, so a bad body is still a 400', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await post({})).status).toBe(400);
  });

  it('an unknown seed listing is a 404 naming the seed', async () => {
    const response = await post({ seedId: 'no-such-listing' });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe('unknown seed listing "no-such-listing"');
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('a seeded listing starts a run and answers 202 with the id and persistence', async () => {
    const response = await post({ seedId: SEED.id });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ id: RUN_ID, persisted: true });

    const opts = hoisted.startRun.mock.calls[0][0];
    expect(opts.kind).toBe('inspect');
    expect(opts.title).toBe(SEED.title);
    expect(opts.vehicle).toEqual({ make: SEED.make, model: SEED.model, year: SEED.year });
    expect(opts.input).toMatchObject({ seedId: SEED.id, vin: SEED.vin, askingPrice: SEED.price });
  });

  it('a degraded store is reported to the client, not hidden', async () => {
    hoisted.store.persistent = false;
    const response = await post({ seedId: SEED.id });
    await expect(response.json()).resolves.toEqual({ id: RUN_ID, persisted: false });
  });

  it('photo bytes never reach the store: uploads persist as a kind alone', async () => {
    const response = await post({
      photos: [
        { kind: 'upload', mediaType: 'image/jpeg', data: 'QUJD' },
        { kind: 'url', url: 'https://cdn.test/photo.jpg' },
      ],
      make: 'BMW',
      model: 'M3',
      year: 2004,
      askingPrice: 32_000,
    });
    expect(response.status).toBe(202);
    const input = hoisted.startRun.mock.calls[0][0].input as { photos: unknown[] };
    expect(input.photos).toEqual([
      { kind: 'upload' },
      { kind: 'url', url: 'https://cdn.test/photo.jpg' },
    ]);
    expect(JSON.stringify(input)).not.toContain('QUJD');
  });

  it('hands the run completion to after() so the instance outlives the response', async () => {
    await post({ seedId: SEED.id });
    expect(hoisted.afterCalls).toHaveLength(1);
    const completion = hoisted.afterCalls[0]();
    expect(hoisted.runCompletion).toHaveBeenCalledWith(RUN_ID);
    await expect(completion).resolves.toBeUndefined();
  });
});

describe('GET /api/inspect', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('reports which stages this deployment can actually run', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    hoisted.store.persistent = true;
    await expect((await GET()).json()).resolves.toEqual({
      status: 'ready',
      capabilities: {
        vision: true,
        webResearch: true,
        nhtsa: true,
        vinDecode: true,
        marketComps: true,
        persistence: true,
      },
      seedListings: SEED_LISTINGS.length,
    });
  });

  it('no key is a degraded probe, not an error', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    hoisted.store.persistent = false;
    const body = (await (await GET()).json()) as {
      status: string;
      capabilities: Record<string, boolean>;
    };
    expect(body.status).toBe('degraded');
    expect(body.capabilities).toMatchObject({
      vision: false,
      webResearch: false,
      nhtsa: true,
      persistence: false,
    });
  });
});

describe('finalizeInspect', () => {
  const report = { assessment: { verdict: 'pass' } };

  it('takes the report event as the outcome', () => {
    expect(finalizeInspect([{ type: 'thought' }, { type: 'report', report }])).toEqual({
      report,
      verdict: 'pass',
    });
  });

  it('a fatal beats a report', () => {
    expect(
      finalizeInspect([
        { type: 'report', report },
        { type: 'fatal', message: 'vision failed' },
      ]),
    ).toEqual({ error: 'vision failed' });
  });

  it('a stream that ends with neither is named as such', () => {
    expect(finalizeInspect([{ type: 'thought' }])).toEqual({
      error: 'inspection ended without a report',
    });
  });
});
