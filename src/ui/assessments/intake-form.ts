/**
 * The intake form's pure half: `FormData` to the two payloads the workspace
 * posts, and the chip grammar the reading is read back in. The server schemas
 * stay authoritative; what happens here is the rejection a reader is owed
 * before a request is spent, and the grouping DESIGN.md specifies.
 */
import {
  INTAKE_FIELDS,
  INTAKE_MAX_PHOTOS,
  INTAKE_MAX_TEXT,
  type Assumption,
  type IntakeField,
} from '@/assessments/intake';
import type { BuyerProfile } from '@/assessments/types';
import { buyerFromForm } from './buyer-form';
import type { PayloadResult } from './payloads';

export type IntakePreviewRequest = {
  text: string;
  vin?: string;
  edits?: Partial<Record<IntakeField, string>>;
};
export type IntakeCreateRequest = {
  intake: {
    text: string;
    vin?: string;
    edits?: Partial<Record<IntakeField, string>>;
    photoUrls: string[];
    listingUrl?: string;
  };
  buyer: BuyerProfile;
  mode: 'live';
  budget: { maxInvestigations: number; maxCostCents: number };
};

/** What the VIN field accepts; a longer capture is a paste, not a VIN. */
export const VIN_FIELD_MAX = 20;

/** Assumption sources in the order the chip rows are read, top to bottom. */
export const CHIP_SOURCES: Assumption['source'][] = ['intake', 'llm', 'vpic', 'user'];
export const CHIP_SOURCE_LABELS: Record<Assumption['source'], string> = {
  intake: 'read from your listing text',
  llm: 'proposed by the model',
  vpic: 'decoded from the VIN',
  user: 'corrected by you',
};

/** DESIGN.md assumption chip, with the field the value filled named. */
export function chipText(assumption: Assumption): string {
  return `${assumption.source} · ${assumption.field} = ${assumption.meaning}`;
}

/** One group per source that filled anything, in reading order. */
export function groupAssumptions(
  assumptions: Assumption[],
): { source: Assumption['source']; assumptions: Assumption[] }[] {
  return CHIP_SOURCES.map((source) => ({
    source,
    assumptions: assumptions.filter((a) => a.source === source),
  })).filter((group) => group.assumptions.length > 0);
}

/**
 * Every field the reading left absent, in the order `INTAKE_FIELDS` states
 * them. A field no pass filled carries no chip, and a chip is the only thing
 * the reading offers to correct, so without this list a value nobody read
 * could be stated by nobody — while `runIntake` applies an edit for any field
 * it knows (SPEC 61).
 */
export function unreadFields(assumptions: Assumption[]): IntakeField[] {
  const read = new Set(assumptions.map((assumption) => assumption.field));
  return INTAKE_FIELDS.filter((field) => !read.has(field));
}

/** One photo address per line; blank lines are spacing, not links. */
export function photoLines(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listingText(values: FormData): PayloadResult<string> {
  const text = String(values.get('listingText') ?? '').trim();
  if (!text) return { ok: false, error: 'Paste the listing text before parsing it.' };
  if (text.length > INTAKE_MAX_TEXT)
    return { ok: false, error: `Listing text is limited to ${INTAKE_MAX_TEXT} characters.` };
  return { ok: true, payload: text };
}

/**
 * The VIN a showroom action carried into intake (`/assessments?vin=…`). The
 * field takes it as its initial value and nothing else is prefilled, so a lot
 * of your own is still a lot you stated. A parameter that is repeated or
 * longer than the field accepts carries no choice and fills nothing.
 */
export function prefilledVin(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const vin = value.trim().toUpperCase();
  return vin && vin.length <= VIN_FIELD_MAX ? vin : undefined;
}

/**
 * What a reading was read from: the block, the VIN and the photo addresses,
 * and nothing else the form collects. The research allowance and the buyer
 * constraints price a lot rather than describe one, so moving them leaves the
 * reading standing.
 */
export function intakeFingerprint(values: FormData): string {
  return JSON.stringify([
    String(values.get('listingText') ?? '').trim(),
    String(values.get('vin') ?? '')
      .trim()
      .toUpperCase(),
    photoLines(String(values.get('photos') ?? '')),
  ]);
}

/** The reading the buyer has in front of them, beside the form as it stands. */
export type CreateGate = {
  reading?: { blocked?: string };
  /** `intakeFingerprint` as it was when that reading was requested. */
  readFrom?: string;
  /** `intakeFingerprint` as it is now. */
  current: string;
};

/**
 * Why creation is not open yet, or the empty string when it is. Creation
 * follows a reading of this listing as it stands: a lot saved without one was
 * never argued with, and a reading of text that has since changed is a
 * reading of another lot (SPEC 2, 61).
 */
export function createGateNote(gate: CreateGate): string {
  if (!gate.reading) return 'read the listing first';
  if (gate.readFrom !== gate.current) return 'read the listing again';
  if (gate.reading.blocked) return 'correct the reading first';
  return '';
}

function typedVin(values: FormData): string | undefined {
  const vin = String(values.get('vin') ?? '')
    .trim()
    .toUpperCase();
  return vin || undefined;
}

/** Corrections the reader has typed, minus the ones they cleared again. */
function statedEdits(
  edits: Partial<Record<IntakeField, string>>,
): Partial<Record<IntakeField, string>> {
  return Object.fromEntries(
    Object.entries(edits).filter(([, value]) => String(value ?? '').trim()),
  ) as Partial<Record<IntakeField, string>>;
}

/**
 * The reading request: the block, the VIN and any correction already made, and
 * nothing that could be saved. Corrections ride along so a reader whose
 * identity line was hijacked by a banner can fix it and read again, with the
 * same precedence the creation request gives them.
 */
export function intakePreviewPayload(
  values: FormData,
  edits: Partial<Record<IntakeField, string>> = {},
): PayloadResult<IntakePreviewRequest> {
  const text = listingText(values);
  if (!text.ok) return text;
  const vin = typedVin(values);
  const stated = statedEdits(edits);
  return {
    ok: true,
    payload: {
      text: text.payload,
      ...(vin ? { vin } : {}),
      ...(Object.keys(stated).length ? { edits: stated } : {}),
    },
  };
}

/**
 * The creation request. The photo addresses are the one input the server will
 * dereference, so the count and the scheme are checked here too; the listing
 * URL is provenance and is never fetched (SPEC 61).
 */
export function intakeCreatePayload(
  values: FormData,
  edits: Partial<Record<IntakeField, string>> = {},
): PayloadResult<IntakeCreateRequest> {
  const text = listingText(values);
  if (!text.ok) return text;
  const photoUrls = photoLines(String(values.get('photos') ?? ''));
  if (photoUrls.length === 0)
    return { ok: false, error: 'Paste at least one photo link, one per line.' };
  if (photoUrls.length > INTAKE_MAX_PHOTOS)
    return { ok: false, error: `Paste at most ${INTAKE_MAX_PHOTOS} photo links.` };
  const insecure = photoUrls.findIndex((url) => !url.startsWith('https://'));
  if (insecure !== -1)
    return { ok: false, error: `Photo link ${insecure + 1} is not an https address.` };
  const listingUrl = String(values.get('listingUrl') ?? '').trim();
  if (listingUrl && !listingUrl.startsWith('https://'))
    return { ok: false, error: 'The listing link is not an https address.' };
  const vin = typedVin(values);
  const stated = statedEdits(edits);
  return {
    ok: true,
    payload: {
      intake: {
        text: text.payload,
        ...(vin ? { vin } : {}),
        ...(Object.keys(stated).length ? { edits: stated } : {}),
        photoUrls,
        ...(listingUrl ? { listingUrl } : {}),
      },
      buyer: buyerFromForm(values),
      mode: 'live',
      budget: {
        maxInvestigations: 6,
        maxCostCents: Math.round(Number(values.get('researchAllowance') || 0) * 100),
      },
    },
  };
}
