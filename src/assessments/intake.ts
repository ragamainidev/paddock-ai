/**
 * Intake: the lot a user brought, parsed and never fetched (SPEC 61).
 *
 * There is no licensed lot feed and the server never dereferences an auction
 * or broker page, so a lot arrives as three things the user can copy: the
 * listing's text block, the VIN, and the public photo addresses. This module
 * owns the reading of those three and nothing else.
 *
 * The order is the invariant. A deterministic pass reads the listing text
 * first and its values are final (SPEC 5 spirit); an injected model caller
 * then proposes only for fields still absent and can never overwrite one;
 * the federal decode fills identity the user never stated and blocks a lot
 * whose stated identity the VIN contradicts. Every value any of them
 * produced is an assumption the user sees and may correct before the
 * assessment exists (SPEC 2). Nothing is guessed: a field no rule matched
 * stays absent.
 *
 * Photo addresses are screened through the request-forgery boundary the
 * inspector already owns (`docs/patterns.md §6.4`, SPEC 29); only the
 * addresses are stored, never bytes.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AssessmentError } from './types';
import type { PhotoProbe } from '@/inspector/photos';
import {
  checkDigitValid,
  decodeVinVpic,
  isWellFormedVin,
  normalizeVin,
  type VpicDecoded,
  type VpicFetcher,
} from '@/inspector/vin';
import type { SalvageLot } from '@/salvage/types';
import { USER_LOT_SOURCE } from './lot-source';

// -- The typed reading ----------------------------------------------------------

/** Everything intake can learn about a lot before an assessment exists. */
export type IntakeFields = {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  lotNumber?: string;
  saleDate?: string;
  odometer?: number;
  odometerNote?: string;
  primaryDamage?: string;
  secondaryDamage?: string;
  titleBrand?: string;
  location?: string;
  currentBid?: number;
  estRetailValue?: number;
  engine?: string;
};
export type IntakeField = keyof IntakeFields;

/**
 * Who read a field and why, in the assumption grammar of SPEC 2 with the
 * field it filled named: `intake` is the deterministic pass over the pasted
 * text, `llm` a model proposal, `vpic` the federal decode, `user` a
 * correction the buyer typed. A chip reads `source · field = meaning` with
 * the reason beside it.
 */
export type Assumption = {
  source: 'intake' | 'llm' | 'vpic' | 'user';
  field: IntakeField;
  input: string; // the text it was read from, verbatim
  meaning: string; // the typed value it became
  reason: string; // why this reading is right
};

export const INTAKE_FIELDS: readonly IntakeField[] = [
  'vin',
  'year',
  'make',
  'model',
  'lotNumber',
  'saleDate',
  'odometer',
  'odometerNote',
  'primaryDamage',
  'secondaryDamage',
  'titleBrand',
  'location',
  'currentBid',
  'estRetailValue',
  'engine',
] as const;

const NUMERIC_FIELDS: readonly IntakeField[] = [
  'year',
  'odometer',
  'currentBid',
  'estRetailValue',
] as const;

/**
 * How long a value may be before it stops being a value. A listing block is
 * pasted text, so a greedy capture can carry a paragraph into `model` or
 * `titleBrand`, and those are interpolated into research topics, triage
 * prompts and comps queries. An over-long capture is refused rather than
 * truncated: a five-hundred-character model is a paste fragment, not a model,
 * and the field is better absent and correctable.
 */
const FIELD_MAX_CHARS: Partial<Record<IntakeField, number>> = {
  make: 60,
  model: 120,
  lotNumber: 40,
  saleDate: 40,
  odometerNote: 80,
  primaryDamage: 80,
  secondaryDamage: 80,
  titleBrand: 120,
  location: 120,
  engine: 160,
};
const DEFAULT_MAX_CHARS = 200;

// A lot the user brought states its own provenance wherever it is read. The
// constant lives in a leaf module so a client bundle can compare against it
// without importing this one; its readers still find it here.
export { USER_LOT_SOURCE } from './lot-source';
export const INTAKE_MAX_TEXT = 20_000;
export const INTAKE_MAX_PHOTOS = 12;
export const INTAKE_MIN_PHOTOS = 1;
/** Stated wherever a field nobody could read still has to be a string. */
export const NOT_STATED = 'not stated';

// -- R1: the deterministic pass -------------------------------------------------

// A VIN is seventeen characters and never contains I, O or Q. The scan reads
// candidates out of the whole block because auction layouts label the field
// inconsistently ("VIN:", "VIN", "Vehicle Identification Number").
const VIN_CANDIDATE = /\b[A-Za-z0-9]{17}\b/g;
const LOT_NUMBER = /\bLot\s*#?\s*:?\s*(\d{6,9})\b/i;
const ODOMETER = /(\d[\d,]*)\s*(?:mi\b|miles\b)/i;
const ODOMETER_NOTE = /\b(NOT ACTUAL|ACTUAL|EXEMPT)\b/i;
const PRIMARY_DAMAGE = /Primary Damage:?\s*([A-Z /]+)/;
const SECONDARY_DAMAGE = /Secondary Damage:?\s*([A-Z /]+)/;
// The colon is required and every label variant is named, or `Title Status:`
// reads its own label as the brand.
const TITLE_BRAND = /\bTitle(?: Type| Code| Status| History)?:\s*([A-Za-z0-9 ()-]+)/i;
const YARD_STATE = /\bLocation:?\s*([A-Z]{2})\b/;
const MONEY = /\$\s?([\d,]+)/;
const IDENTITY_LINE = /^((?:19|20)\d{2})\s+(\S+)(?:\s+(.+))?$/;
// A value stating that there is nothing to state is not a value.
const EMPTY_VALUES = new Set(['none', 'n/a', 'na', 'unknown']);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The date formats auction blocks actually print, normalized to ISO. */
function parseListingDate(line: string): string | undefined {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(line);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(line);
  if (slash) return `${slash[3]}-${pad(slash[1])}-${pad(slash[2])}`;
  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(line);
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (month >= 0) return `${named[3]}-${pad(String(month + 1))}-${pad(named[2])}`;
  }
  return undefined;
}
const pad = (value: string) => value.padStart(2, '0');
const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');
const stated = (value: string) => !EMPTY_VALUES.has(value.trim().toLowerCase());

/**
 * Reads the pasted block with regexes alone. Every value it finds is an
 * assumption quoting the text it was read from; a field no rule matched is
 * left absent rather than guessed, which is what leaves the model something
 * to propose and the user something to correct.
 */
export function parseListingText(text: string): {
  fields: IntakeFields;
  assumptions: Assumption[];
} {
  const fields: IntakeFields = {};
  const assumptions: Assumption[] = [];
  const lines = text.split(/\r?\n/);
  // Every pass states a value the same way, so the type, the range and the
  // length a field accepts are one rule rather than four.
  const add = (field: IntakeField, raw: string | number, input: string, reason: string) => {
    const value = coerceField(field, raw);
    if (value === undefined) return;
    (fields as Record<string, unknown>)[field] = value;
    assumptions.push({
      source: 'intake',
      field,
      input: tidy(input),
      meaning: String(value),
      reason,
    });
  };

  const vin = readVin(text);
  if (vin)
    add(
      'vin',
      vin.value,
      vin.value,
      vin.checkDigit
        ? 'Seventeen characters with no I, O or Q, and the check digit verifies'
        : 'Seventeen characters with no I, O or Q; the check digit does not verify, which is normal outside North America',
    );

  // The vehicle line is rarely the first line: auction blocks print a banner
  // or a stock number above it, so the first line that reads as an identity
  // wins rather than line one alone.
  for (const line of lines) {
    const identity = IDENTITY_LINE.exec(tidy(line));
    if (!identity) continue;
    add('year', Number(identity[1]), line, 'Model year at the head of the vehicle line');
    add('make', identity[2], line, 'Make at the head of the vehicle line');
    if (identity[3]) add('model', tidy(identity[3]), line, 'Model as the vehicle line states it');
    break;
  }

  const lot = LOT_NUMBER.exec(text);
  if (lot) add('lotNumber', lot[1], lot[0], 'Lot number as the listing prints it');

  const dateLine = lines.find((line) => /\b(sale|auction)\s*date\b/i.test(line));
  const saleDate = dateLine && parseListingDate(dateLine);
  if (saleDate) add('saleDate', saleDate, dateLine, 'Sale date read from the listing');

  const odometerLine = lines.find((line) => ODOMETER.test(line));
  if (odometerLine) {
    const reading = ODOMETER.exec(odometerLine)!;
    add(
      'odometer',
      Number(reading[1].replace(/,/g, '')),
      odometerLine,
      'Odometer reading in miles as the listing states it',
    );
    const note = ODOMETER_NOTE.exec(odometerLine);
    if (note)
      add(
        'odometerNote',
        `listed as ${note[1].toUpperCase()}`,
        odometerLine,
        'The listing qualifies the reading itself',
      );
  }

  for (const [field, pattern, reason] of [
    ['primaryDamage', PRIMARY_DAMAGE, 'Primary damage code as the listing states it'],
    ['secondaryDamage', SECONDARY_DAMAGE, 'Secondary damage code as the listing states it'],
    ['titleBrand', TITLE_BRAND, 'Title line as the listing states it'],
  ] as const) {
    const match = pattern.exec(text);
    if (match && stated(match[1])) add(field, tidy(match[1]), match[0], reason);
  }

  const state = YARD_STATE.exec(text);
  if (state) add('location', state[1], state[0], 'Two-letter state on the yard location line');

  // Money is only read where the listing says what the money is: a dollar
  // figure with no word beside it could be a fee, a deposit or a comparable.
  for (const [field, anchor, reason] of [
    ['currentBid', /\bbid\b/i, 'Dollar figure on the line naming the bid'],
    ['estRetailValue', /retail/i, 'Dollar figure on the line naming retail value'],
  ] as const) {
    const line = lines.find((candidate) => anchor.test(candidate) && MONEY.test(candidate));
    if (!line) continue;
    add(field, Number(MONEY.exec(line)![1].replace(/,/g, '')), line, reason);
  }
  return { fields, assumptions };
}

/**
 * The VIN the block carries. A candidate whose check digit verifies wins over
 * one that merely has the right shape; a block with neither yields nothing.
 */
function readVin(text: string): { value: string; checkDigit: boolean } | undefined {
  const candidates = [...text.matchAll(VIN_CANDIDATE)]
    .map((match) => normalizeVin(match[0]))
    .filter(isWellFormedVin);
  const verified = candidates.find(checkDigitValid);
  if (verified) return { value: verified, checkDigit: true };
  return candidates[0] ? { value: candidates[0], checkDigit: false } : undefined;
}

// -- R2: the model completion ---------------------------------------------------

/**
 * Proposals for the fields the deterministic pass left absent. Injected, so
 * every merge path runs offline; the default reports `skipped` rather than
 * failing when no key is configured.
 */
export type IntakeCaller = (input: { text: string; missing: IntakeField[] }) => Promise<unknown>;

const ProposalSchema = z.object({
  field: z.enum(INTAKE_FIELDS as unknown as [IntakeField, ...IntakeField[]]),
  value: z.union([z.string().min(1).max(200), z.number()]),
  quote: z.string().min(1).max(400),
  reason: z.string().min(1).max(300),
});
const IntakeOutputSchema = z.object({ fields: z.array(ProposalSchema).max(20) });
const SkippedSchema = z.object({ skipped: z.string().min(1).max(200) });

export type IntakeCompletion = {
  fields: IntakeFields;
  assumptions: Assumption[];
  status: { called: boolean; ok: boolean; detail?: string };
};

/**
 * Merges model proposals into the deterministic reading. A proposal for a
 * field already filled is discarded rather than applied, so the model can
 * never overwrite what the text plainly said (SPEC 5 spirit), and a proposal
 * whose quote is absent from the pasted text is discarded too: intake reads
 * what the user brought and invents nothing.
 */
export async function completeIntake(
  fields: IntakeFields,
  text: string,
  caller: IntakeCaller | null,
): Promise<IntakeCompletion> {
  const missing = INTAKE_FIELDS.filter((field) => fields[field] === undefined);
  const merged: IntakeFields = { ...fields };
  // Neither branch is a degradation, so neither states a note: a deployment
  // that configures no caller, and a block that left nothing to propose, are
  // both the step working as intended.
  if (!caller || missing.length === 0)
    return { fields: merged, assumptions: [], status: { called: false, ok: true } };
  let raw: unknown;
  try {
    raw = await caller({ text, missing: [...missing] });
  } catch (error) {
    console.error('assessment intake: model completion failed:', error);
    return {
      fields: merged,
      assumptions: [],
      status: { called: true, ok: false, detail: 'the model completion step was unavailable' },
    };
  }
  const skipped = SkippedSchema.safeParse(raw);
  if (skipped.success)
    return {
      fields: merged,
      assumptions: [],
      status: {
        called: false,
        ok: true,
        detail: `model completion skipped: ${skipped.data.skipped}`,
      },
    };
  const parsed = IntakeOutputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      fields: merged,
      assumptions: [],
      status: { called: true, ok: false, detail: 'model output failed validation' },
    };
  const haystack = tidy(text).toLowerCase();
  const assumptions: Assumption[] = [];
  for (const proposal of parsed.data.fields) {
    if (merged[proposal.field] !== undefined) continue;
    if (!haystack.includes(tidy(proposal.quote).toLowerCase())) continue;
    const value = coerceField(proposal.field, proposal.value);
    if (value === undefined) continue;
    (merged as Record<string, unknown>)[proposal.field] = value;
    assumptions.push({
      source: 'llm',
      field: proposal.field,
      input: tidy(proposal.quote),
      meaning: String(value),
      reason: proposal.reason,
    });
  }
  return { fields: merged, assumptions, status: { called: true, ok: true } };
}

/**
 * A value typed into a field, in that field's own type. Money and mileage
 * arrive with separators; a number that is not a number is no value at all.
 */
export function coerceField(
  field: IntakeField,
  value: string | number,
): string | number | undefined {
  // A VIN is the one field whose shape is checkable, and every pass that can
  // fill it goes through here, so a malformed one is refused wherever it came
  // from: the model, an edited chip, or the VIN field itself.
  if (field === 'vin') {
    const clean = normalizeVin(String(value));
    return isWellFormedVin(clean) ? clean : undefined;
  }
  if (!NUMERIC_FIELDS.includes(field)) {
    const text = tidy(String(value));
    if (!text || !stated(text)) return undefined;
    return text.length <= (FIELD_MAX_CHARS[field] ?? DEFAULT_MAX_CHARS) ? text : undefined;
  }
  const numeric = Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  if (field === 'year')
    return Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2100 ? numeric : undefined;
  return Math.round(numeric);
}

// -- R3: the federal decode -----------------------------------------------------

export type IntakeDecode = {
  fields: IntakeFields;
  assumptions: Assumption[];
  blocked?: string;
  /** The decode could not be reached; the identity stands as it was stated. */
  unavailable?: boolean;
};

export const VPIC_UNAVAILABLE = 'vPIC unavailable';

/**
 * vPIC fills identity the user never stated and contradicts identity they
 * did. A decode that disagrees with the listing blocks the lot: two
 * identities for one car is an ambiguity, and ambiguity is never silently
 * resolved (SPEC 1). An unreachable decode is not a failure — the identity
 * stays as typed and says so.
 */
export async function decodeIntakeVin(
  fields: IntakeFields,
  fetcher: VpicFetcher | null,
): Promise<IntakeDecode> {
  const merged: IntakeFields = { ...fields };
  if (!merged.vin || !fetcher) return { fields: merged, assumptions: [] };
  let decoded: VpicDecoded;
  try {
    decoded = await decodeVinVpic(merged.vin, fetcher);
  } catch (error) {
    console.error('assessment intake: vPIC decode failed:', error);
    // The VIN already carries a chip from whichever pass read it, and a field
    // carries one chip (DESIGN.md), so the unavailability rides that chip's
    // reason rather than opening a second one.
    return { fields: merged, assumptions: [], unavailable: true };
  }
  if (contradicts(merged, decoded))
    return {
      fields: merged,
      assumptions: [],
      blocked: `VIN decodes to ${identityText({ year: decoded.year, make: decoded.make })}; the listing says ${identityText(merged)}`,
    };
  const assumptions: Assumption[] = [];
  for (const field of ['year', 'make', 'model', 'engine'] as const) {
    const value = decoded[field];
    if (merged[field] !== undefined || value === undefined) continue;
    (merged as Record<string, unknown>)[field] = value;
    assumptions.push({
      source: 'vpic',
      field,
      input: merged.vin,
      meaning: String(value),
      reason: 'NHTSA vPIC decoded this field from the VIN',
    });
  }
  return { fields: merged, assumptions };
}

/** Identity as a sentence fragment, stating an absence rather than reading through it. */
function identityText(identity: { year?: number; make?: string }): string {
  return [identity.year ?? 'an unstated year', identity.make ?? 'an unstated make'].join(' ');
}

/**
 * Whether the decode and the listing name different cars. Makes are compared
 * loosely in both directions, because vPIC prints `Mercedes-Benz` where a
 * listing prints `MERCEDES` and neither is wrong.
 */
function contradicts(fields: IntakeFields, decoded: VpicDecoded): boolean {
  if (fields.year !== undefined && decoded.year !== undefined && fields.year !== decoded.year)
    return true;
  if (fields.make === undefined || decoded.make === undefined) return false;
  const listed = fields.make.toLowerCase().trim();
  const federal = decoded.make.toLowerCase().trim();
  return !listed.includes(federal) && !federal.includes(listed);
}

// -- R4: the photo screen -------------------------------------------------------

/**
 * Every address the user pasted, through the request-forgery boundary the
 * inspector owns (`docs/patterns.md §6.4`, SPEC 29). A refused address stops
 * creation rather than degrading: the lot is the user's own input, so a link
 * it cannot keep is a correction to make, not a photo to drop.
 */
export async function screenIntakePhotos(
  photoUrls: string[],
  probe: PhotoProbe | null,
): Promise<{ blocked?: string }> {
  if (!probe) return {};
  const screened = await Promise.all(photoUrls.map((url) => probe(url).catch(() => false)));
  const refused = screened.indexOf(false);
  return refused === -1
    ? {}
    : { blocked: `photo link ${refused + 1} is not a public https address` };
}

// -- R5: the lot ----------------------------------------------------------------

/**
 * The lot a user-supplied reading becomes. Its source names the user rather
 * than a broker, its URL is provenance the server never fetches and may be
 * absent entirely, and its notes state which pass filled which field so the
 * report can read the lot's provenance off the record (SPEC 61).
 */
export function buildUserLot(
  fields: IntakeFields,
  photos: string[],
  now: string,
  options: { assumptions?: Assumption[]; listingUrl?: string; id?: string } = {},
): SalvageLot {
  if (fields.year === undefined || !fields.make || !fields.model)
    throw new AssessmentError('invalid_input', MISSING_IDENTITY);
  return {
    id: options.id ?? randomUUID(),
    title: `${fields.year} ${fields.make} ${fields.model}`,
    make: fields.make,
    model: fields.model,
    year: fields.year,
    vin: fields.vin ?? '',
    lotNumber: fields.lotNumber ?? NOT_STATED,
    source: USER_LOT_SOURCE,
    ...(options.listingUrl ? { url: options.listingUrl } : {}),
    collectedOn: now,
    damage: {
      primary: fields.primaryDamage ?? NOT_STATED,
      ...(fields.secondaryDamage ? { secondary: fields.secondaryDamage } : {}),
    },
    titleBrand: fields.titleBrand ?? NOT_STATED,
    ...(fields.odometer !== undefined ? { odometer: fields.odometer } : {}),
    ...(fields.odometerNote ? { odometerNote: fields.odometerNote } : {}),
    location: fields.location ?? NOT_STATED,
    ...(fields.saleDate ? { saleDate: fields.saleDate } : {}),
    ...(fields.currentBid !== undefined ? { currentBid: fields.currentBid } : {}),
    ...(fields.estRetailValue !== undefined ? { estRetailValue: fields.estRetailValue } : {}),
    engine: fields.engine ?? NOT_STATED,
    photos: [...photos],
    notes: provenanceNote(options.assumptions ?? []),
  };
}

export const MISSING_IDENTITY =
  'The listing does not state the vehicle year, make and model, and the VIN decode did not supply them';

/** A reading the lot schema refuses, stated without echoing a validator. */
export const UNUSABLE_LOT =
  'The reading does not produce a usable lot; correct the chips and try again';

const SOURCE_LABELS: Record<Assumption['source'], string> = {
  intake: 'read from the pasted listing',
  llm: 'proposed by the model',
  vpic: 'decoded from the VIN by NHTSA vPIC',
  user: 'typed by you',
};

/** Which pass filled which field, in one sentence per pass that filled any. */
function provenanceNote(assumptions: Assumption[]): string {
  const sentences = (Object.keys(SOURCE_LABELS) as Assumption['source'][])
    .map((source) => {
      const fields = [
        ...new Set(assumptions.filter((a) => a.source === source).map((a) => a.field)),
      ];
      return fields.length ? `${SOURCE_LABELS[source]}: ${fields.join(', ')}` : '';
    })
    .filter(Boolean);
  return [`Lot brought by the user; no auction or broker page was fetched.`, ...sentences].join(
    ' ',
  );
}

// -- The intake pass ------------------------------------------------------------

/** What the user brought: the block, the VIN field, and any chip they corrected. */
export type IntakeInput = {
  text: string;
  vin?: string;
  edits?: Partial<Record<IntakeField, string>>;
};

/** Everything R1–R3 needs from outside itself, so the whole pass runs offline. */
export type IntakeDeps = { caller: IntakeCaller | null; vpicFetcher: VpicFetcher | null };

export type IntakeReading = {
  fields: IntakeFields;
  assumptions: Assumption[];
  blocked?: string;
  note?: string;
};

export const MALFORMED_VIN = 'The VIN you typed is not seventeen characters without I, O or Q';

/**
 * The deterministic pass, the user's own corrections, the model completion and
 * the federal decode, in that order. What the user typed beats what the text
 * said; what the text said beats what the model proposed; the decode fills
 * only what nobody stated and blocks what it contradicts. The result is the
 * fields and the chips behind every one of them, and it creates nothing.
 */
export async function runIntake(input: IntakeInput, deps: IntakeDeps): Promise<IntakeReading> {
  const parsed = parseListingText(input.text);
  const fields = parsed.fields;
  const assumptions = [...parsed.assumptions];
  const typed = (field: IntakeField, raw: string, reason: string): string | undefined => {
    const value = coerceField(field, raw);
    if (value === undefined) return `The value you typed for ${field} is not usable`;
    // A field the user states is theirs, so the pass that read it before no
    // longer speaks for it.
    for (let i = assumptions.length - 1; i >= 0; i--)
      if (assumptions[i].field === field) assumptions.splice(i, 1);
    (fields as Record<string, unknown>)[field] = value;
    assumptions.push({
      source: 'user',
      field,
      input: tidy(raw),
      meaning: String(value),
      reason,
    });
    return undefined;
  };

  if (input.vin?.trim()) {
    const clean = normalizeVin(input.vin);
    if (!isWellFormedVin(clean)) return { fields, assumptions, blocked: MALFORMED_VIN };
    typed('vin', clean, 'VIN as you typed it');
  }
  for (const [field, value] of Object.entries(input.edits ?? {})) {
    if (!INTAKE_FIELDS.includes(field as IntakeField) || !String(value ?? '').trim()) continue;
    const refusal = typed(
      field as IntakeField,
      String(value),
      'Corrected by you before creating this assessment',
    );
    if (refusal) return { fields, assumptions, blocked: refusal };
  }

  const completed = await completeIntake(fields, input.text, deps.caller);
  assumptions.push(...completed.assumptions);
  const decoded = await decodeIntakeVin(completed.fields, deps.vpicFetcher);
  assumptions.push(...decoded.assumptions);
  if (decoded.unavailable) {
    const vin = assumptions.find((a) => a.field === 'vin');
    if (vin) vin.reason = `${vin.reason}; ${VPIC_UNAVAILABLE}`;
  }
  const blocked =
    decoded.blocked ??
    (decoded.fields.year === undefined || !decoded.fields.make || !decoded.fields.model
      ? MISSING_IDENTITY
      : undefined);
  const note = [
    completed.status.detail,
    decoded.unavailable ? `${VPIC_UNAVAILABLE}; the identity stands as stated` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    fields: decoded.fields,
    assumptions,
    ...(blocked ? { blocked } : {}),
    ...(note ? { note } : {}),
  };
}
