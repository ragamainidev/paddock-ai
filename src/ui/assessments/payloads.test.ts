import { expect, it } from 'vitest';
import { outcomePayload, watchPayload } from './payloads';

function form(fields: [string, string][]): FormData {
  const values = new FormData();
  for (const [name, value] of fields) values.append(name, value);
  return values;
}

const watchFields: [string, string][] = [
  ['actionKinds', 'market_comps'],
  ['actionKinds', 'repair_evidence'],
  ['intervalHours', '6'],
  ['until', '2026-09-20T09:00'],
  ['maxRefreshes', '2'],
];

const outcomeFields: [string, string][] = [
  ['kind', 'purchased'],
  ['note', 'Bought at the Illinois sale; body shell only.'],
  ['decisionRevision', '4'],
  ['observedAt', ''],
  ['hammer', '58000'],
  ['amount', ''],
  ['repairCost', ''],
  ['holdingCost', ''],
  ['saleProceeds', ''],
];

const without = (fields: [string, string][], name: string) =>
  fields.filter(([field]) => field !== name);
const replacing = (fields: [string, string][], name: string, value: string) =>
  without(fields, name).concat([[name, value]]);

it('builds a watch policy in the units the server expects', () => {
  const result = watchPayload(form(watchFields));
  expect(result).toEqual({
    ok: true,
    payload: {
      policy: {
        actionKinds: ['market_comps', 'repair_evidence'],
        intervalMs: 21_600_000,
        until: new Date('2026-09-20T09:00').toISOString(),
        maxRefreshes: 2,
      },
    },
  });
});

it('refuses a watch with nothing to watch', () => {
  expect(watchPayload(form(without(watchFields, 'actionKinds')))).toEqual({
    ok: false,
    error: 'Select at least one source to watch.',
  });
  expect(watchPayload(form(replacing(watchFields, 'actionKinds', 'listing_photos')))).toEqual({
    ok: false,
    error: 'Select at least one source to watch.',
  });
});

it('refuses a watch that has no end, and one whose bounds are not numbers', () => {
  expect(watchPayload(form(replacing(watchFields, 'until', 'soon'))).ok).toBe(false);
  expect(watchPayload(form(without(watchFields, 'until')))).toEqual({
    ok: false,
    error: 'Enter the date to stop watching.',
  });
  expect(watchPayload(form(replacing(watchFields, 'intervalHours', 'often'))).ok).toBe(false);
  expect(watchPayload(form(replacing(watchFields, 'maxRefreshes', '0'))).ok).toBe(false);
});

it('builds an outcome, dropping the money fields left blank', () => {
  const result = outcomePayload(form(outcomeFields));
  expect(result).toEqual({
    ok: true,
    payload: {
      kind: 'purchased',
      note: 'Bought at the Illinois sale; body shell only.',
      decisionRevision: 4,
      hammer: 58_000,
    },
  });
});

it('records the winning bid on a lot the owner did not buy', () => {
  const lost = replacing(replacing(outcomeFields, 'kind', 'lost_to_hammer'), 'hammer', '141000');
  expect(outcomePayload(form(lost))).toEqual({
    ok: true,
    payload: {
      kind: 'lost_to_hammer',
      note: 'Bought at the Illinois sale; body shell only.',
      decisionRevision: 4,
      hammer: 141_000,
    },
  });
});

it('refuses a lot that changed hands without the price it made', () => {
  const refusal = { ok: false, error: 'Enter the winning bid this lot sold for.' };
  expect(outcomePayload(form(without(outcomeFields, 'hammer')))).toEqual(refusal);
  expect(
    outcomePayload(form(without(replacing(outcomeFields, 'kind', 'lost_to_hammer'), 'hammer'))),
  ).toEqual(refusal);
  // A pass nobody outbid, and an observation, state no hammer at all.
  expect(
    outcomePayload(form(without(replacing(outcomeFields, 'kind', 'passed'), 'hammer'))).ok,
  ).toBe(true);
});

it('records the observation time when one is given', () => {
  const result = outcomePayload(form(replacing(outcomeFields, 'observedAt', '2026-09-05T14:30')));
  expect(result.ok && result.payload.observedAt).toBe(new Date('2026-09-05T14:30').toISOString());
  expect(outcomePayload(form(replacing(outcomeFields, 'observedAt', 'yesterday'))).ok).toBe(false);
});

it('refuses an outcome with no decision to compare it with', () => {
  expect(outcomePayload(form(without(outcomeFields, 'decisionRevision')))).toEqual({
    ok: false,
    error: 'Select the earlier decision this outcome is compared with.',
  });
  expect(outcomePayload(form(replacing(outcomeFields, 'decisionRevision', '0'))).ok).toBe(false);
  expect(outcomePayload(form(replacing(outcomeFields, 'decisionRevision', '2.5'))).ok).toBe(false);
});

it('refuses an outcome with no account of what happened, or an unreadable figure', () => {
  expect(outcomePayload(form(replacing(outcomeFields, 'note', '   ')))).toEqual({
    ok: false,
    error: 'Describe what happened and what the numbers include.',
  });
  expect(outcomePayload(form(replacing(outcomeFields, 'kind', 'crashed'))).ok).toBe(false);
  expect(outcomePayload(form(replacing(outcomeFields, 'repairCost', 'about 12k')))).toEqual({
    ok: false,
    error: 'Enter a number for the repair cash cost, or leave it blank.',
  });
});
