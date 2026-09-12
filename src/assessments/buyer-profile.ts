/**
 * Explicit planning assumptions, editable per buyer; none is an industry
 * average. Three presets stand for the three cost structures a salvage lot is
 * bid into — hobbyist, independent shop, franchise dealer — and every value a
 * buyer has not changed is stated as an assumption rather than a fact
 * (`docs/salvage-economics.md` §11, SPEC 50). `custom` is what an edit
 * produces; it is a label, never an input to the ledger.
 */
import type { BuyerPreset, BuyerProfile } from './types';
export const US_JURISDICTIONS = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'AS',
  'GU',
  'MP',
  'PR',
  'VI',
].map((code) => `US-${code}`);

export const BUYER_PRESETS: Record<Exclude<BuyerPreset, 'custom'>, BuyerProfile> = {
  hobbyist: {
    preset: 'hobbyist',
    jurisdiction: 'US-unspecified',
    access: 'broker',
    exit: 'private_party',
    discipline: 0.75,
    capabilities: {
      tools: true,
      workspace: true,
      lift: false,
      diagnostics: false,
      specialistAccess: true,
      structural: false,
      paint: false,
      alignment: false,
      hv: false,
    },
    laborRatePerHour: 25,
    availableDiyHours: 200,
    holdingDays: 90,
    holdingCostPerDay: 10,
    maxAllIn: 40000,
    minSurplus: 5000,
  },
  shop: {
    preset: 'shop',
    jurisdiction: 'US-unspecified',
    access: 'direct',
    exit: 'wholesale',
    discipline: 0.75,
    capabilities: {
      tools: true,
      workspace: true,
      lift: true,
      diagnostics: true,
      specialistAccess: true,
      structural: true,
      paint: true,
      alignment: true,
      hv: false,
    },
    laborRatePerHour: 75,
    availableDiyHours: 300,
    holdingDays: 45,
    holdingCostPerDay: 25,
    maxAllIn: 150000,
    minSurplus: 15000,
  },
  dealer: {
    preset: 'dealer',
    jurisdiction: 'US-unspecified',
    access: 'direct',
    exit: 'retail',
    discipline: 0.75,
    capabilities: {
      tools: false,
      workspace: false,
      lift: false,
      diagnostics: false,
      specialistAccess: true,
      structural: false,
      paint: false,
      alignment: false,
      hv: false,
    },
    laborRatePerHour: 0,
    availableDiyHours: 0,
    holdingDays: 30,
    holdingCostPerDay: 40,
    maxAllIn: 250000,
    minSurplus: 20000,
  },
};

// The enthusiast hobbyist is the wedge, so their assumptions are what an
// unstated profile means.
export const DEFAULT_BUYER_PROFILE: BuyerProfile = BUYER_PRESETS.hobbyist;

/**
 * The bidder the room's price is set by: the marginal professional rebuilder
 * of `docs/salvage-economics.md` §8 — shop equipment, a direct licensed
 * account, a retail exit and the kernel's own discipline. The room is made by
 * capitalized shops, so no cash arm binds this profile: `maxAllIn` is the
 * schema's maximum rather than a stated budget, and the required surplus stays
 * the shop's. It is a reference point for the edge, never a preset a buyer
 * selects, so `presetFor` never returns it (SPEC 60).
 */
export const MARKET_PERSONA: BuyerProfile = {
  ...BUYER_PRESETS.shop,
  preset: 'custom',
  jurisdiction: 'US-unspecified',
  access: 'direct',
  exit: 'retail',
  discipline: 0.75,
  maxAllIn: 100_000_000,
};

/** A stored profile that predates a field carries neither it nor a preset name. */
export type PartialBuyerProfile = Partial<Omit<BuyerProfile, 'capabilities'>> & {
  capabilities?: Partial<BuyerProfile['capabilities']>;
};

/** Fills what a record does not state from the hobbyist preset, and names what it then is. */
export function normalizeBuyerProfile(partial: PartialBuyerProfile): BuyerProfile {
  const filled: BuyerProfile = {
    ...DEFAULT_BUYER_PROFILE,
    ...partial,
    capabilities: { ...DEFAULT_BUYER_PROFILE.capabilities, ...partial.capabilities },
  };
  // The values decide the name, never a stored label: a document claiming a
  // preset it does not hold would put a false assumption on the form.
  return { ...filled, preset: presetFor(filled) };
}

/** Names the preset a profile's inputs describe; any divergence is `custom`. */
export function presetFor(profile: BuyerProfile): BuyerPreset {
  const wanted = signature(profile);
  return PRESET_NAMES.find((name) => signature(BUYER_PRESETS[name]) === wanted) ?? 'custom';
}

/**
 * The preset a profile most resembles — the one matching the most inputs, and
 * the hobbyist wedge on a tie. A `custom` profile is still mostly some
 * preset's assumptions, and this says whose, so the form can state the values
 * the buyer has not replaced instead of falling silent (SPEC 2).
 */
export function nearestPreset(profile: BuyerProfile): Exclude<BuyerPreset, 'custom'> {
  let nearest: Exclude<BuyerPreset, 'custom'> = 'hobbyist';
  let best = matchingInputs(profile, BUYER_PRESETS.hobbyist);
  for (const name of PRESET_NAMES) {
    const matches = matchingInputs(profile, BUYER_PRESETS[name]);
    if (matches > best) {
      nearest = name;
      best = matches;
    }
  }
  return nearest;
}

const PRESET_NAMES = Object.keys(BUYER_PRESETS) as Exclude<BuyerPreset, 'custom'>[];

// Every ledger input a profile carries, keyed and ordered independently of how
// a stored document happened to write them. `preset` is the answer rather than
// an input, so it never reaches a comparison, and neither does `jurisdiction`:
// a preset describes resources and an exit, not where the buyer registers, so
// a hobbyist who states a state is still a hobbyist.
function inputs(profile: BuyerProfile): Map<string, unknown> {
  const entries: [string, unknown][] = Object.entries(profile).filter(
    ([key]) => key !== 'preset' && key !== 'capabilities' && key !== 'jurisdiction',
  );
  for (const [key, value] of Object.entries(profile.capabilities))
    entries.push([`capabilities.${key}`, value]);
  return new Map(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function signature(profile: BuyerProfile): string {
  return JSON.stringify([...inputs(profile)]);
}

function matchingInputs(profile: BuyerProfile, preset: BuyerProfile): number {
  const held = inputs(preset);
  let matches = 0;
  for (const [key, value] of inputs(profile)) if (held.get(key) === value) matches += 1;
  return matches;
}
