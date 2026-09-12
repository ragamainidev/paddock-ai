import { describe, expect, test, vi } from 'vitest';
import { userFacingReason } from '@/lib/failure';
import type { ComplaintRecord } from './nhtsa';
import { themeComplaints, type ThemeCaller } from './themes';

function complaint(odi: number, components: string, summary: string): ComplaintRecord {
  return { odiNumber: odi, components, summary, crash: false, fire: false };
}

const COMPLAINTS: ComplaintRecord[] = [
  complaint(1, 'POWER TRAIN', 'rear subframe mounting points cracked'),
  complaint(2, 'POWER TRAIN', 'diff mount sheared at the floor'),
  complaint(3, 'POWER TRAIN', 'clunk from rear subframe'),
  complaint(4, 'ENGINE AND ENGINE COOLING', 'rod bearings failed at 60k'),
  complaint(5, 'ENGINE AND ENGINE COOLING', 'spun bearing, engine replaced'),
  complaint(6, 'AIR BAGS', 'takata recall part unavailable'),
];

function fixtureCaller(payload: unknown): ThemeCaller {
  return vi.fn(async () => payload);
}

describe('themeComplaints', () => {
  test('without ANTHROPIC_API_KEY the default caller is skipped, not exploded', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await themeComplaints('BMW M3 2001–2006', COMPLAINTS);
      expect(r.status.ok).toBe(false);
      expect(r.status.detail).toMatch(/ANTHROPIC_API_KEY/);
      expect(r.themes.length).toBeGreaterThan(0);
      expect(r.themes[0].title).toBe(r.themes[0].component);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test('no complaints: no model call, empty themes, stage ok', async () => {
    const caller = fixtureCaller({ themes: [] });
    const r = await themeComplaints('BMW M3 2001–2006', [], caller);
    expect(caller).not.toHaveBeenCalled();
    expect(r.themes).toEqual([]);
    expect(r.status).toMatchObject({ stage: 'themes', ok: true });
  });

  test('titles come from the model, counts and order come from the data', async () => {
    const caller = fixtureCaller({
      themes: [
        {
          component: 'ENGINE AND ENGINE COOLING',
          title: 'Rod bearing failures',
          detail: 'S54 bearing shells wear early.',
        },
        {
          component: 'POWER TRAIN',
          title: 'Rear subframe cracking',
          detail: 'Mounting points tear out of the floor.',
        },
      ],
    });
    const r = await themeComplaints('BMW M3 2001–2006', COMPLAINTS, caller);
    expect(r.status).toMatchObject({ stage: 'themes', ok: true });
    expect(r.themes).toEqual([
      {
        component: 'POWER TRAIN',
        count: 3,
        title: 'Rear subframe cracking',
        detail: 'Mounting points tear out of the floor.',
      },
      {
        component: 'ENGINE AND ENGINE COOLING',
        count: 2,
        title: 'Rod bearing failures',
        detail: 'S54 bearing shells wear early.',
      },
      { component: 'AIR BAGS', count: 1, title: 'AIR BAGS', detail: '' },
    ]);
  });

  test('model themes for components not in the data are dropped', async () => {
    const caller = fixtureCaller({
      themes: [{ component: 'FLUX CAPACITOR', title: 'Invented', detail: 'hallucinated' }],
    });
    const r = await themeComplaints('BMW M3', COMPLAINTS.slice(0, 3), caller);
    expect(r.themes).toEqual([
      { component: 'POWER TRAIN', count: 3, title: 'POWER TRAIN', detail: '' },
    ]);
  });

  test('a throwing caller degrades to raw component counts', async () => {
    const caller: ThemeCaller = vi.fn(async () => {
      throw new Error('api down');
    });
    const r = await themeComplaints('BMW M3', COMPLAINTS, caller);
    expect(r.status.ok).toBe(false);
    // The caller is the Anthropic SDK in production; its message is a log
    // line, not a stage note (SPEC 24).
    expect(r.status.detail).toBe(userFacingReason('unknown'));
    expect(r.status.detail).not.toContain('api down');
    expect(r.themes.map((t) => [t.component, t.count])).toEqual([
      ['POWER TRAIN', 3],
      ['ENGINE AND ENGINE COOLING', 2],
      ['AIR BAGS', 1],
    ]);
  });

  test('malformed model output degrades the same way', async () => {
    const caller = fixtureCaller({ themes: [{ component: 7 }] });
    const r = await themeComplaints('BMW M3', COMPLAINTS, caller);
    expect(r.status.ok).toBe(false);
    expect(r.themes).toHaveLength(3);
    expect(r.themes[0]).toMatchObject({ component: 'POWER TRAIN', count: 3 });
  });

  test('the caller receives per-component sample narratives, capped', async () => {
    const caller = fixtureCaller({ themes: [] });
    await themeComplaints('BMW M3', COMPLAINTS, caller);
    const input = vi.mocked(caller).mock.calls[0][0];
    expect(input.vehicleLabel).toBe('BMW M3');
    const powertrain = input.groups.find((g) => g.component === 'POWER TRAIN');
    expect(powertrain?.count).toBe(3);
    expect(powertrain?.samples.length).toBeLessThanOrEqual(3);
    expect(powertrain?.samples[0]).toContain('subframe');
  });
});
