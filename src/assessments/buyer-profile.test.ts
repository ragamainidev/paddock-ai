/** The presets are inputs a buyer can accept or replace, never facts (SPEC 50). */
import { describe, expect, it } from 'vitest';
import {
  BUYER_PRESETS,
  DEFAULT_BUYER_PROFILE,
  MARKET_PERSONA,
  nearestPreset,
  normalizeBuyerProfile,
  presetFor,
  type PartialBuyerProfile,
} from './buyer-profile';
import { buyerProfileSchema } from './validation';

const presetNames = Object.keys(BUYER_PRESETS) as (keyof typeof BUYER_PRESETS)[];

// The shape a record saved before access, exit, discipline and the equipment
// flags existed still has on disk.
const legacyRecord = {
  jurisdiction: 'US-CA',
  capabilities: {
    tools: true,
    workspace: true,
    lift: false,
    diagnostics: true,
    specialistAccess: true,
  },
  laborRatePerHour: 25,
  availableDiyHours: 200,
  holdingDays: 90,
  holdingCostPerDay: 10,
  maxAllIn: 100000,
  minSurplus: 10000,
} as PartialBuyerProfile;

describe('buyer presets', () => {
  it('every preset is a profile the server accepts', () => {
    for (const name of presetNames)
      expect(buyerProfileSchema.parse(BUYER_PRESETS[name])).toEqual(BUYER_PRESETS[name]);
    expect(DEFAULT_BUYER_PROFILE).toBe(BUYER_PRESETS.hobbyist);
  });

  it('names the preset a profile matches and calls any change custom', () => {
    for (const name of presetNames) {
      expect(presetFor(BUYER_PRESETS[name])).toBe(name);
      // A preset describes resources and an exit, not where the buyer
      // registers, so a stated residence never renames it.
      expect(presetFor({ ...BUYER_PRESETS[name], jurisdiction: 'US-NY' })).toBe(name);
      // The name is a label the values decide, not an input to the comparison.
      expect(presetFor({ ...BUYER_PRESETS[name], preset: 'custom' })).toBe(name);
      expect(presetFor({ ...BUYER_PRESETS[name], maxAllIn: 12345 })).toBe('custom');
      expect(presetFor({ ...BUYER_PRESETS[name], exit: 'keep' })).toBe('custom');
      expect(
        presetFor({
          ...BUYER_PRESETS[name],
          capabilities: { ...BUYER_PRESETS[name].capabilities, hv: true },
        }),
      ).toBe('custom');
    }
  });

  it('fills a record saved before the profile learned who is bidding', () => {
    const filled = normalizeBuyerProfile(legacyRecord);
    expect(filled).toMatchObject({
      preset: 'custom',
      access: 'broker',
      exit: 'private_party',
      discipline: 0.75,
      jurisdiction: 'US-CA',
      maxAllIn: 100000,
    });
    expect(filled.capabilities).toEqual({
      tools: true,
      workspace: true,
      lift: false,
      diagnostics: true,
      specialistAccess: true,
      structural: false,
      paint: false,
      alignment: false,
      hv: false,
    });
    expect(buyerProfileSchema.parse(filled)).toEqual(filled);
  });

  it('leaves a stated field alone and recognizes a record that is already a preset', () => {
    expect(normalizeBuyerProfile({ ...legacyRecord, access: 'direct' }).access).toBe('direct');
    const { preset, ...unnamed } = BUYER_PRESETS.shop;
    expect(preset).toBe('shop');
    expect(normalizeBuyerProfile(unnamed)).toEqual(BUYER_PRESETS.shop);
  });

  it('names a record from its values, never from the label the record carries', () => {
    // A client could otherwise persist a preset it does not hold, and the form
    // would state that preset's assumptions over the buyer's own numbers.
    expect(normalizeBuyerProfile({ ...BUYER_PRESETS.hobbyist, preset: 'shop' }).preset).toBe(
      'hobbyist',
    );
    expect(normalizeBuyerProfile({ ...BUYER_PRESETS.shop, preset: 'hobbyist' }).preset).toBe(
      'shop',
    );
    expect(normalizeBuyerProfile({ ...legacyRecord, preset: 'dealer' }).preset).toBe('custom');
  });

  it('names the preset a custom profile is nearest to, and the wedge on a tie', () => {
    for (const name of presetNames) {
      expect(nearestPreset(BUYER_PRESETS[name])).toBe(name);
      expect(nearestPreset({ ...BUYER_PRESETS[name], jurisdiction: 'US-CA' })).toBe(name);
    }
    // Built to match the hobbyist and the shop on the same number of inputs:
    // the shared six, then alternating single wins. A tie goes to the wedge.
    expect(
      nearestPreset({
        preset: 'custom',
        jurisdiction: 'US-unspecified',
        access: 'broker',
        exit: 'keep',
        discipline: 0.75,
        capabilities: {
          tools: true,
          workspace: true,
          lift: true,
          diagnostics: false,
          specialistAccess: true,
          structural: true,
          paint: false,
          alignment: true,
          hv: false,
        },
        laborRatePerHour: 11,
        availableDiyHours: 11,
        holdingDays: 11,
        holdingCostPerDay: 11,
        maxAllIn: 11,
        minSurplus: 11,
      }),
    ).toBe('hobbyist');
  });

  it('the market persona is the shop preset selling retail with no cash arm, and is never a preset', () => {
    // The bidder the room's price is set by (SPEC 60): the shop's equipment and
    // rates, a direct account, a retail exit, and no cash limit to bind,
    // because the room is made by capitalized shops.
    expect(MARKET_PERSONA).toEqual({
      ...BUYER_PRESETS.shop,
      preset: 'custom',
      jurisdiction: 'US-unspecified',
      access: 'direct',
      exit: 'retail',
      discipline: 0.75,
      maxAllIn: 100_000_000,
    });
    expect(MARKET_PERSONA.minSurplus).toBe(BUYER_PRESETS.shop.minSurplus);
    expect(buyerProfileSchema.parse(MARKET_PERSONA)).toEqual(MARKET_PERSONA);
    // It is a reference point, not a choice a buyer can select.
    expect(presetFor(MARKET_PERSONA)).toBe('custom');
    expect(Object.values(BUYER_PRESETS)).not.toContain(MARKET_PERSONA);
  });
});

describe('buyer profile schema', () => {
  it('defaults a legacy payload and bounds discipline', () => {
    const parsed = buyerProfileSchema.parse(legacyRecord);
    expect(parsed).toMatchObject({
      preset: 'custom',
      access: 'broker',
      exit: 'private_party',
      discipline: 0.75,
    });
    expect(parsed.capabilities).toMatchObject({
      structural: false,
      paint: false,
      alignment: false,
      hv: false,
    });
    for (const discipline of [0.4, 0.95])
      expect(buyerProfileSchema.safeParse({ ...DEFAULT_BUYER_PROFILE, discipline }).success).toBe(
        false,
      );
    for (const discipline of [0.5, 0.9])
      expect(buyerProfileSchema.parse({ ...DEFAULT_BUYER_PROFILE, discipline }).discipline).toBe(
        discipline,
      );
  });
});
