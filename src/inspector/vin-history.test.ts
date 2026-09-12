import { describe, expect, test, vi } from 'vitest';
import { createVinHistoryProbe } from './vin-history';

/**
 * The probe's contract: a history link is surfaced only when it is
 * actually present on a live listing page for the exact VIN. No listing,
 * no link; a failed fetch degrades to none.
 */
describe('vin history probe', () => {
  const item = { itemId: '1', title: 'car', itemWebUrl: 'https://ebay.com/itm/1' };

  test('extracts a carfax link verified on the listing page', async () => {
    const client = {
      searchRaw: vi.fn(async () => [item] as never[]),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<a href="https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=X&amp;partner=DLR">Free CARFAX</a>',
    })) as unknown as typeof fetch;
    const links = await createVinHistoryProbe(client, fetchImpl)('WBS123');
    expect(links).toHaveLength(1);
    expect(links[0].label).toContain('CARFAX');
    expect(links[0].url).toContain('partner=DLR');
    expect(links[0].url).not.toContain('&amp;');
  });

  test('no listing for the VIN means no links, never a guessed URL', async () => {
    const client = { searchRaw: vi.fn(async () => [] as never[]) };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await createVinHistoryProbe(client, fetchImpl)('WBS123')).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a blocked or failed page fetch degrades to no links', async () => {
    const client = { searchRaw: vi.fn(async () => [item] as never[]) };
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      text: async () => '',
    })) as unknown as typeof fetch;
    expect(await createVinHistoryProbe(client, fetchImpl)('WBS123')).toEqual([]);
  });
});
