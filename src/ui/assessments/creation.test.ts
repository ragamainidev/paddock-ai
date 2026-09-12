import { expect, it } from 'vitest';
import { SALVAGE_LOTS } from '@/salvage/seed-lots';
import { retainCreationIntent } from './creation';

it('retries a lost response with the original operation key, lot ID and capture date', () => {
  const input = {
    mode: 'live' as const,
    lot: { ...SALVAGE_LOTS[0], id: 'first', collectedOn: '2026-09-06' },
  };
  const intent = retainCreationIntent(null, input);
  const retry = retainCreationIntent(intent, {
    ...input,
    lot: { ...input.lot, id: 'second', collectedOn: '2026-09-07' },
  });
  expect(retry).toBe(intent);
  expect(retry.input.lot?.id).toBe('first');
  expect(retry.input.idempotencyKey).toBe(intent.input.idempotencyKey);
});

it('creates a new intent when the requested budget changes or a previous save was acknowledged', () => {
  const input = { seedLotId: 'sf90-front-il' };
  const first = retainCreationIntent(null, input);
  expect(
    retainCreationIntent(first, { ...input, budget: { maxCostCents: 300 } }).input.idempotencyKey,
  ).not.toBe(first.input.idempotencyKey);
  expect(retainCreationIntent(null, input).input.idempotencyKey).not.toBe(
    first.input.idempotencyKey,
  );
});
