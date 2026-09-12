import { describe, expect, test, vi } from 'vitest';
import { userFacingReason } from '@/lib/failure';
import type { Interpretation } from '@/lib/types';
import { interpretWithModel, type ModelCaller } from './model';

function det(partial?: Partial<Interpretation>): Interpretation {
  return { branches: [], unparsed: [], conflicts: [], ...partial };
}

function porscheBranch(): Interpretation {
  return det({
    branches: [
      {
        label: 'Porsche 911',
        constraint: { make: 'Porsche', models: ['911'] },
        assumptions: [],
      },
    ],
    unparsed: ['slantnose'],
  });
}

// A caller that returns a fixed tool payload, standing in for the API.
function fixtureCaller(payload: unknown): ModelCaller {
  return vi.fn(async () => payload);
}

describe('interpretWithModel', () => {
  test('does not call the model when the deterministic pass is complete', async () => {
    const caller = fixtureCaller({ mappings: [] });
    const deterministic = det({
      branches: [{ label: 'BMW M3', constraint: { make: 'BMW' }, assumptions: [] }],
    });
    const r = await interpretWithModel('e46 m3', deterministic, caller);
    expect(caller).not.toHaveBeenCalled();
    expect(r.status.called).toBe(false);
    expect(r.status.ok).toBe(true);
    expect(r.interpretation).toEqual(deterministic);
  });

  test('applies a mapping to an unparsed token: field set, assumption added, token consumed', async () => {
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'slantnose',
          meaning: 'the 930 flachbau front end',
          reason: 'body style detail not present in vehicle data',
          patch: { unfilterable: { reason: 'body detail not in the data', forwarded: true } },
        },
      ],
    });
    const r = await interpretWithModel('911 slantnose', porscheBranch(), caller);
    expect(r.status).toMatchObject({ called: true, ok: true });
    expect(r.interpretation.unparsed).toEqual([]);
    const b = r.interpretation.branches[0];
    expect(b.constraint.unfilterable).toEqual([
      { term: 'slantnose', reason: 'body detail not in the data', forwardedToListings: true },
    ]);
    expect(b.assumptions).toEqual([
      {
        source: 'llm',
        input: 'slantnose',
        meaning: 'the 930 flachbau front end',
        reason: 'body style detail not present in vehicle data',
      },
    ]);
  });

  test('deterministic wins: a patch cannot override an already-set field', async () => {
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'slantnose',
          meaning: 'a Honda thing, wrongly',
          reason: 'model hallucination',
          patch: { make: 'Honda' },
        },
      ],
    });
    const r = await interpretWithModel('911 slantnose', porscheBranch(), caller);
    expect(r.interpretation.branches[0].constraint.make).toBe('Porsche');
    // Nothing from the patch applied, so the token stays honest: still unparsed.
    expect(r.interpretation.unparsed).toEqual(['slantnose']);
    expect(r.interpretation.branches[0].assumptions).toEqual([]);
  });

  test('non-conflicting fields of a partly-conflicting patch still apply', async () => {
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'slantnose',
          meaning: 'flachbau 911, 1987 on',
          reason: 'factory slantnose option started in 1987',
          patch: { make: 'Honda', yearMin: 1987 },
        },
      ],
    });
    const r = await interpretWithModel('911 slantnose', porscheBranch(), caller);
    const c = r.interpretation.branches[0].constraint;
    expect(c.make).toBe('Porsche');
    expect(c.yearMin).toBe(1987);
    expect(r.interpretation.unparsed).toEqual([]);
    expect(r.interpretation.branches[0].assumptions[0]?.source).toBe('llm');
  });

  test('trimContains patches append an OR-group instead of replacing', async () => {
    const deterministic = det({
      branches: [
        {
          label: 'Porsche 911 GT3',
          constraint: { make: 'Porsche', models: ['911'], trimContains: [['GT3']] },
          assumptions: [],
        },
      ],
      unparsed: ['weissach'],
    });
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'weissach',
          meaning: 'the Weissach package',
          reason: 'named trim package',
          patch: { trimContains: ['Weissach'] },
        },
      ],
    });
    const r = await interpretWithModel('gt3 weissach', deterministic, caller);
    expect(r.interpretation.branches[0].constraint.trimContains).toEqual([['GT3'], ['Weissach']]);
  });

  test('mappings for tokens that were never unparsed are ignored', async () => {
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'gt3',
          meaning: 'already parsed token',
          reason: 'should be ignored',
          patch: { yearMin: 2004 },
        },
      ],
    });
    const before = porscheBranch();
    const r = await interpretWithModel('911 slantnose', before, caller);
    expect(r.interpretation.branches[0].constraint.yearMin).toBeUndefined();
    expect(r.interpretation.unparsed).toEqual(['slantnose']);
  });

  test('malformed tool output returns the deterministic interpretation unchanged', async () => {
    const caller = fixtureCaller({ mappings: [{ token: 42, patch: 'nope' }] });
    const before = porscheBranch();
    const r = await interpretWithModel('911 slantnose', before, caller);
    expect(r.interpretation).toEqual(before);
    expect(r.status).toMatchObject({ called: true, ok: false });
  });

  test('a throwing caller degrades softly to the deterministic interpretation', async () => {
    const caller: ModelCaller = vi.fn(async () => {
      throw new Error('api down');
    });
    const before = porscheBranch();
    const r = await interpretWithModel('911 slantnose', before, caller);
    expect(r.interpretation).toEqual(before);
    expect(r.status.called).toBe(true);
    expect(r.status.ok).toBe(false);
    // The caller's own message is a library's; the reader gets a fixed
    // reason and the server log keeps the error (SPEC 24).
    expect(r.status.detail).toBe(userFacingReason('unknown'));
    expect(r.status.detail).not.toContain('api down');
  });

  test('empty deterministic branches get seeded so a mapping has somewhere to land', async () => {
    const deterministic = det({ unparsed: ['hakosuka'] });
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'hakosuka',
          meaning: 'Nissan Skyline C10, JDM only',
          reason: 'enthusiast nickname for the 1969-72 Skyline GT-R',
          patch: { make: 'Nissan', models: ['Skyline%'] },
        },
      ],
    });
    const r = await interpretWithModel('hakosuka', deterministic, caller);
    expect(r.interpretation.branches).toHaveLength(1);
    expect(r.interpretation.branches[0].constraint).toMatchObject({
      make: 'Nissan',
      models: ['Skyline%'],
    });
    expect(r.interpretation.unparsed).toEqual([]);
  });

  test('empty branches stay empty when the model maps nothing', async () => {
    const deterministic = det({ unparsed: ['zzr9000', 'blorp'] });
    const caller = fixtureCaller({ mappings: [] });
    const r = await interpretWithModel('zzr9000 blorp', deterministic, caller);
    expect(r.interpretation.branches).toEqual([]);
    expect(r.interpretation.unparsed).toEqual(['zzr9000', 'blorp']);
    expect(r.status).toMatchObject({ called: true, ok: true });
  });

  test('a fork gets the patch on every branch it does not conflict with', async () => {
    const deterministic = det({
      branches: [
        { label: 'Chevrolet', constraint: { make: 'Chevrolet' }, assumptions: [] },
        { label: 'Audi', constraint: { make: 'Audi' }, assumptions: [] },
      ],
      unparsed: ['lowered'],
    });
    const caller = fixtureCaller({
      mappings: [
        {
          token: 'lowered',
          meaning: 'lowered suspension',
          reason: 'modification, not in vehicle data',
          patch: {
            unfilterable: { reason: 'suspension mods are not in the data', forwarded: true },
          },
        },
      ],
    });
    const r = await interpretWithModel('c7 lowered', deterministic, caller);
    for (const b of r.interpretation.branches) {
      expect(b.constraint.unfilterable?.[0]?.term).toBe('lowered');
      expect(b.assumptions[0]?.source).toBe('llm');
    }
    expect(r.interpretation.unparsed).toEqual([]);
  });
});
