import type { Client } from '@libsql/client';
import { userFacingReason } from '@/lib/failure';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createRichCatalogFixture } from '@/resolve/fixtures/rich-catalog';
import type { ModelCaller } from '@/interpret/model';
import { runSearch } from './search';

let db: Client;

beforeAll(async () => {
  db = await createRichCatalogFixture();
});

afterAll(() => db.close());

describe('runSearch', () => {
  test('a clean query resolves without any model call', async () => {
    const modelCaller: ModelCaller = vi.fn(async () => ({ mappings: [] }));
    const r = await runSearch('e46 m3', { db, modelCaller });
    expect(modelCaller).not.toHaveBeenCalled();
    expect(r.statuses.find((s) => s.stage === 'interpret')).toMatchObject({ ok: true });
    expect(r.statuses.find((s) => s.stage === 'resolve')).toMatchObject({ ok: true });
    const top = r.branches[0].vehicles[0];
    expect(top).toMatchObject({ make: 'BMW', model: 'M3', yearMin: 2001, yearMax: 2006 });
  });

  test('unparsed tokens go through the model caller and land as assumptions', async () => {
    const modelCaller: ModelCaller = vi.fn(async () => ({
      mappings: [
        {
          token: 'slicktop',
          meaning: 'no sunroof',
          reason: 'option detail not in vehicle data',
          patch: { unfilterable: { reason: 'options are not in the data', forwarded: true } },
        },
      ],
    }));
    const r = await runSearch('e46 m3 slicktop', { db, modelCaller });
    expect(modelCaller).toHaveBeenCalledOnce();
    expect(r.interpretation.unparsed).toEqual([]);
    expect(r.branches[0].branch.assumptions.some((a) => a.source === 'llm')).toBe(true);
    expect(r.branches[0].vehicles[0]).toMatchObject({ make: 'BMW', model: 'M3' });
  });

  test('a failing model degrades interpret but never resolution', async () => {
    const modelCaller: ModelCaller = vi.fn(async () => {
      throw new Error('api down');
    });
    const r = await runSearch('e46 m3 slicktop', { db, modelCaller });
    const interpret = r.statuses.find((s) => s.stage === 'interpret');
    expect(interpret?.ok).toBe(false);
    expect(interpret?.detail).toBe(`model fallback failed: ${userFacingReason('unknown')}`);
    expect(interpret?.detail).not.toContain('api down');
    expect(r.interpretation.unparsed).toEqual(['slicktop']);
    expect(r.branches[0].vehicles[0]).toMatchObject({ make: 'BMW', model: 'M3' });
  });

  test('without a model configured, leftover tokens are reported, not hidden', async () => {
    const r = await runSearch('e46 m3 slicktop', { db, modelCaller: null });
    const interpret = r.statuses.find((s) => s.stage === 'interpret');
    expect(interpret?.ok).toBe(false);
    expect(interpret?.detail).toMatch(/ANTHROPIC_API_KEY/);
    expect(r.interpretation.unparsed).toEqual(['slicktop']);
  });

  test('a database failure degrades resolve while interpret stays intact', async () => {
    const broken = { execute: vi.fn(async () => Promise.reject(new Error('db gone'))) };
    const r = await runSearch('e46 m3', { db: broken as unknown as Client, modelCaller: null });
    expect(r.statuses.find((s) => s.stage === 'interpret')).toMatchObject({ ok: true });
    const resolve = r.statuses.find((s) => s.stage === 'resolve');
    expect(resolve?.ok).toBe(false);
    expect(resolve?.detail).toBe(userFacingReason('unknown'));
    expect(resolve?.detail).not.toContain('db gone');
    expect(r.branches[0].vehicles).toEqual([]);
  });

  test('one fixed reason stands for every branch that failed the same way', async () => {
    const broken = { execute: vi.fn(async () => Promise.reject(new Error('db gone'))) };
    const r = await runSearch('c7', { db: broken as unknown as Client, modelCaller: null });
    expect(r.branches).toHaveLength(2);
    expect(broken.execute).toHaveBeenCalledTimes(3);
    expect(r.statuses.find((s) => s.stage === 'resolve')?.detail).toBe(userFacingReason('unknown'));
  });

  test('ambiguous queries keep every branch, resolved independently', async () => {
    const r = await runSearch('c7', { db, modelCaller: null });
    expect(r.branches).toHaveLength(2);
    const makes = r.branches.map((b) => b.branch.constraint.make).sort();
    expect(makes).toEqual(['Audi', 'Chevrolet']);
    for (const b of r.branches) expect(b.vehicles.length).toBeGreaterThan(0);
  });

  test('nonsense resolves to zero vehicles, never an invented one', async () => {
    const r = await runSearch('zzr9000 blorp', { db, modelCaller: null });
    expect(r.branches.flatMap((b) => b.vehicles)).toEqual([]);
  });
});
