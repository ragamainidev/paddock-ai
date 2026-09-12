import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartRunOptions } from '@/runs/manager';
import { POST } from './route';

/**
 * The synthetic run exists for UI verification and must be absent from any
 * normal deployment: without PADDOCK_DEBUG=1 the route is a 404, not a
 * disabled endpoint that admits it is there.
 */

const hoisted = vi.hoisted(() => ({
  afterCalls: [] as (() => unknown)[],
  startRun: vi.fn<(opts: StartRunOptions) => string>(),
  runCompletion: vi.fn<(id: string) => Promise<void>>(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (fn: () => unknown) => void hoisted.afterCalls.push(fn) };
});

vi.mock('@/runs/manager', () => ({
  startRun: hoisted.startRun,
  runCompletion: hoisted.runCompletion,
}));

vi.mock('@/runs/resolve-store', () => ({
  resolveRunStore: async () => ({ persistent: false }),
}));

const RUN_ID = '00000000-1111-4222-8333-444444444444';

describe('POST /api/debug-run', () => {
  const saved = process.env.PADDOCK_DEBUG;

  beforeEach(() => {
    hoisted.afterCalls.length = 0;
    hoisted.startRun.mockReset().mockReturnValue(RUN_ID);
    hoisted.runCompletion.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.PADDOCK_DEBUG;
    else process.env.PADDOCK_DEBUG = saved;
  });

  it('is a 404 wherever the flag is not exactly 1', async () => {
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      if (value === undefined) delete process.env.PADDOCK_DEBUG;
      else process.env.PADDOCK_DEBUG = value;
      const response = await POST();
      expect(response.status, String(value)).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not found' });
    }
    expect(hoisted.startRun).not.toHaveBeenCalled();
  });

  it('with the flag on it starts a synthetic run and hands it to after()', async () => {
    process.env.PADDOCK_DEBUG = '1';
    const response = await POST();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ id: RUN_ID });

    const opts = hoisted.startRun.mock.calls[0][0];
    expect(opts.kind).toBe('salvage');
    expect(opts.title).toBe('DEBUG synthetic run');
    // No model call is possible: the run has no report to finalize.
    expect(opts.finalize([])).toEqual({ error: 'synthetic run, no report' });

    expect(hoisted.afterCalls).toHaveLength(1);
    await hoisted.afterCalls[0]();
    expect(hoisted.runCompletion).toHaveBeenCalledWith(RUN_ID);
  });
});
