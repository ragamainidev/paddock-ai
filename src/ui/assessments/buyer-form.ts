/**
 * The buyer form's pure half, in the payload-builder grammar of `payloads.ts`:
 * `FormData` to a `BuyerProfile`, the labels every field and chip is read by,
 * and the assumption chips that state which values are still a preset's rather
 * than the buyer's (SPEC 2, SPEC 50). The server schema stays authoritative;
 * nothing here decides what is allowed.
 */
import {
  BUYER_PRESETS,
  DEFAULT_BUYER_PROFILE,
  nearestPreset,
  presetFor,
} from '@/assessments/buyer-profile';
import type { BuyerProfile } from '@/assessments/types';
import { usd } from '@/lib/money';

/** Every input the form collects, addressed by the field name it submits. */
export type BuyerFieldName =
  keyof Omit<BuyerProfile, 'preset' | 'capabilities'> | keyof BuyerProfile['capabilities'];

const ACCESS: BuyerProfile['access'][] = ['broker', 'direct'];
const EXIT: BuyerProfile['exit'][] = ['private_party', 'wholesale', 'retail', 'keep'];

export const ACCESS_LABELS: Record<BuyerProfile['access'], string> = {
  broker: 'Through a broker (3–6% fee)',
  direct: 'Direct account (business or dealer license)',
};
export const EXIT_LABELS: Record<BuyerProfile['exit'], string> = {
  private_party: 'Private party',
  wholesale: 'Wholesale to a dealer',
  retail: 'Retail on my lot',
  keep: 'Keep the car',
};

/**
 * One label per field, read by both the field and its chip so the two can never
 * disagree, in the order the form lays them out — which is the order the chip
 * row states them in.
 */
export const BUYER_FIELD_LABELS: Record<BuyerFieldName, string> = {
  access: 'Auction access',
  exit: 'How you expect to exit',
  jurisdiction: 'Registration state (US)',
  maxAllIn: 'Maximum cash commitment ($)',
  minSurplus: 'Minimum economic surplus ($)',
  availableDiyHours: 'DIY hours available',
  laborRatePerHour: 'Value of your time ($/hour)',
  holdingDays: 'Expected holding days',
  holdingCostPerDay: 'Holding cost ($/day)',
  discipline: 'Discipline (share of low exit)',
  tools: 'Mechanic tools',
  workspace: 'Suitable workspace',
  lift: 'Lift access',
  diagnostics: 'Diagnostic equipment',
  specialistAccess: 'Qualified specialists available',
  structural: 'Frame rack',
  paint: 'Paint booth',
  alignment: 'Alignment rack',
  hv: 'HV tooling and training',
};
const FIELD_ORDER = Object.keys(BUYER_FIELD_LABELS) as BuyerFieldName[];
/** The capability checkboxes, in the order the form renders them. */
export const CAPABILITY_FIELDS = FIELD_ORDER.filter(
  (field) => field in DEFAULT_BUYER_PROFILE.capabilities,
) as (keyof BuyerProfile['capabilities'])[];
const MONEY_FIELDS: BuyerFieldName[] = [
  'maxAllIn',
  'minSurplus',
  'laborRatePerHour',
  'holdingCostPerDay',
];

/** A typed two-letter state, or the absence the registration gate refuses to pass. */
export function jurisdictionFrom(state: string): string {
  const code = state.trim().toUpperCase();
  return code ? `US-${code}` : 'US-unspecified';
}

export function buyerFromForm(values: FormData): BuyerProfile {
  const n = (key: string) => Number(values.get(key));
  const one = <T extends string>(key: string, allowed: T[], fallback: T): T => {
    const value = String(values.get(key) ?? '') as T;
    return allowed.includes(value) ? value : fallback;
  };
  const profile: BuyerProfile = {
    // The values name the preset; a diverged field makes it `custom` whatever
    // the selector last showed.
    preset: 'custom',
    jurisdiction: jurisdictionFrom(String(values.get('jurisdiction') ?? '')),
    access: one('access', ACCESS, DEFAULT_BUYER_PROFILE.access),
    exit: one('exit', EXIT, DEFAULT_BUYER_PROFILE.exit),
    discipline: n('discipline'),
    capabilities: {
      tools: values.has('tools'),
      workspace: values.has('workspace'),
      lift: values.has('lift'),
      diagnostics: values.has('diagnostics'),
      specialistAccess: values.has('specialistAccess'),
      structural: values.has('structural'),
      paint: values.has('paint'),
      alignment: values.has('alignment'),
      hv: values.has('hv'),
    },
    laborRatePerHour: n('laborRatePerHour'),
    availableDiyHours: n('availableDiyHours'),
    holdingDays: n('holdingDays'),
    holdingCostPerDay: n('holdingCostPerDay'),
    maxAllIn: n('maxAllIn'),
    minSurplus: n('minSurplus'),
  };
  return { ...profile, preset: presetFor(profile) };
}

/**
 * Whether the selector should read `Custom` rather than a preset's name: the
 * profile's own values already diverge, or the buyer has edited a field the
 * preset states. A typed jurisdiction is neither — a preset names resources
 * and an exit, never where the buyer registers the car, so `presetFor` and
 * `nearestPreset` leave it out of their comparison and this leaves it out of
 * the divergence (SPEC 50). The per-field chips still drop the one the buyer
 * typed.
 */
export function divergedFromPreset(
  profile: BuyerProfile,
  edited: ReadonlySet<BuyerFieldName>,
): boolean {
  return profile.preset === 'custom' || [...edited].some((field) => field !== 'jurisdiction');
}

/**
 * A chip per value that is still the profile's nearest preset's and that the
 * buyer has not edited in this session, in the chip grammar
 * `assumed: <label> = <value>` (DESIGN.md assumption chip). The judgment is per
 * field: one replaced value does not turn the rest into the buyer's own.
 */
export function assumptionChips(
  profile: BuyerProfile,
  edited: ReadonlySet<BuyerFieldName>,
): { field: BuyerFieldName; text: string }[] {
  const preset = BUYER_PRESETS[nearestPreset(profile)];
  return FIELD_ORDER.filter(
    (field) => !edited.has(field) && valueOf(profile, field) === valueOf(preset, field),
  ).map((field) => ({
    field,
    text: `assumed: ${BUYER_FIELD_LABELS[field]} = ${chipValue(profile, field)}`,
  }));
}

function valueOf(profile: BuyerProfile, field: BuyerFieldName): string | number | boolean {
  return field in profile.capabilities
    ? profile.capabilities[field as keyof BuyerProfile['capabilities']]
    : profile[field as keyof Omit<BuyerProfile, 'preset' | 'capabilities'>];
}

function chipValue(profile: BuyerProfile, field: BuyerFieldName): string {
  const value = valueOf(profile, field);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (field === 'jurisdiction')
    return profile.jurisdiction === 'US-unspecified'
      ? 'unspecified'
      : profile.jurisdiction.replace('US-', '');
  if (field === 'access') return profile.access === 'broker' ? 'broker' : 'direct account';
  if (field === 'exit') return EXIT_LABELS[profile.exit].toLowerCase();
  return MONEY_FIELDS.includes(field) ? usd(Number(value)) : String(value);
}
