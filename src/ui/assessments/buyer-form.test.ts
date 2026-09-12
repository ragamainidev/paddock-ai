import { expect, it } from 'vitest';
import { BUYER_PRESETS } from '@/assessments/buyer-profile';
import { buyerProfileSchema } from '@/assessments/validation';
import {
  assumptionChips,
  buyerFromForm,
  divergedFromPreset,
  type BuyerFieldName,
} from './buyer-form';

function form(fields: [string, string][]): FormData {
  const values = new FormData();
  for (const [name, value] of fields) values.append(name, value);
  return values;
}

// A checkbox submits nothing when it is clear, so the shop preset's own boxes
// are the only ones present here.
const shopFields: [string, string][] = [
  ['preset', 'shop'],
  ['jurisdiction', 'ca'],
  ['access', 'direct'],
  ['exit', 'wholesale'],
  ['discipline', '0.75'],
  ['tools', 'on'],
  ['workspace', 'on'],
  ['lift', 'on'],
  ['diagnostics', 'on'],
  ['specialistAccess', 'on'],
  ['structural', 'on'],
  ['paint', 'on'],
  ['alignment', 'on'],
  ['laborRatePerHour', '75'],
  ['availableDiyHours', '300'],
  ['holdingDays', '45'],
  ['holdingCostPerDay', '25'],
  ['maxAllIn', '150000'],
  ['minSurplus', '15000'],
];
const replacing = (fields: [string, string][], name: string, value: string) =>
  fields.filter(([field]) => field !== name).concat([[name, value]]);

it('reads access, exit, discipline and the equipment the form collects', () => {
  const buyer = buyerFromForm(form(shopFields));
  // A typed state does not rename the preset: the selector stays on the
  // resources the buyer accepted, and the residence is its own field.
  expect(buyer).toEqual({
    ...BUYER_PRESETS.shop,
    preset: 'shop',
    jurisdiction: 'US-CA',
  });
  expect(buyerProfileSchema.parse(buyer)).toEqual(buyer);
});

it('names the preset the fields describe and calls one changed field custom', () => {
  const unchanged = replacing(shopFields, 'jurisdiction', '');
  expect(buyerFromForm(form(unchanged)).preset).toBe('shop');
  expect(buyerFromForm(form(replacing(unchanged, 'exit', 'keep'))).preset).toBe('custom');
  expect(buyerFromForm(form(replacing(unchanged, 'hv', 'on'))).capabilities.hv).toBe(true);
  expect(buyerFromForm(form(replacing(unchanged, 'hv', 'on'))).preset).toBe('custom');
});

it('falls back to the hobbyist choice when a select submits nothing usable', () => {
  const buyer = buyerFromForm(form(replacing(shopFields, 'access', 'consignment')));
  expect(buyer.access).toBe('broker');
});

it('a typed state does not move the selector off the preset the values describe', () => {
  const none = new Set<BuyerFieldName>();
  const typedState = new Set<BuyerFieldName>(['jurisdiction']);
  expect(divergedFromPreset(BUYER_PRESETS.shop, none)).toBe(false);
  // Choosing a preset after typing a state keeps that state and the preset:
  // `buyerFromForm` reads the same fields and names the same preset, so the
  // selector cannot disagree with what a save would produce.
  const chosen = { ...BUYER_PRESETS.shop, jurisdiction: 'US-NY' };
  expect(divergedFromPreset(chosen, typedState)).toBe(false);
  expect(buyerFromForm(form(replacing(shopFields, 'jurisdiction', 'ny'))).preset).toBe('shop');
  // Any other edited field is a divergence, and so is a profile that already
  // carries values no preset states.
  expect(divergedFromPreset(chosen, new Set<BuyerFieldName>(['jurisdiction', 'maxAllIn']))).toBe(
    true,
  );
  expect(divergedFromPreset({ ...chosen, preset: 'custom' }, typedState)).toBe(true);
});

it('chips every preset value the buyer has not changed, and no others', () => {
  const edited = new Set<BuyerFieldName>(['maxAllIn', 'hv']);
  const chips = assumptionChips(BUYER_PRESETS.hobbyist, edited);
  expect(chips.map((chip) => chip.field)).not.toContain('maxAllIn');
  expect(chips.map((chip) => chip.field)).not.toContain('hv');
  // Field order, one label per field, money in the repo's money grammar.
  expect(chips.slice(0, 4)).toEqual([
    { field: 'access', text: 'assumed: Auction access = broker' },
    { field: 'exit', text: 'assumed: How you expect to exit = private party' },
    { field: 'jurisdiction', text: 'assumed: Registration state (US) = unspecified' },
    { field: 'minSurplus', text: 'assumed: Minimum economic surplus ($) = $5,000' },
  ]);
  expect(chips).toContainEqual({
    field: 'discipline',
    text: 'assumed: Discipline (share of low exit) = 0.75',
  });
  expect(chips).toContainEqual({ field: 'structural', text: 'assumed: Frame rack = no' });
});

it('keeps chipping a saved profile that diverges in one field', () => {
  // A saved profile is `custom` the moment one value is the buyer's own; the
  // rest of it is still the nearest preset's assumption and still says so.
  const profile = { ...BUYER_PRESETS.hobbyist, preset: 'custom' as const, jurisdiction: 'US-NY' };
  const chips = assumptionChips(profile, new Set());
  expect(chips.map((chip) => chip.field)).not.toContain('jurisdiction');
  expect(chips).toHaveLength(18);
  expect(chips).toContainEqual({
    field: 'maxAllIn',
    text: 'assumed: Maximum cash commitment ($) = $40,000',
  });
  // The nearest preset decides the comparison, so a shop's own numbers are not
  // read against the hobbyist's.
  const shop = { ...BUYER_PRESETS.shop, preset: 'custom' as const, maxAllIn: 175000 };
  expect(assumptionChips(shop, new Set())).toContainEqual({
    field: 'laborRatePerHour',
    text: 'assumed: Value of your time ($/hour) = $75',
  });
  expect(assumptionChips(shop, new Set()).map((chip) => chip.field)).not.toContain('maxAllIn');
});
