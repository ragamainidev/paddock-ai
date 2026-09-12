/** Validate source authority and actual comparable identity, not merely citations (SPEC 47, 53). */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseTriageOutput } from '@/salvage/triage';
import {
  AssessmentError,
  OUTCOME_KINDS,
  type Assessment,
  type AssessmentEvidence,
  type EvidenceInput,
  type EvidenceSource,
} from './types';

import { screenPriceEvidence } from '@/salvage/knowledge';
import {
  INTAKE_FIELDS,
  INTAKE_MAX_PHOTOS,
  INTAKE_MAX_TEXT,
  INTAKE_MIN_PHOTOS,
  type IntakeField,
} from './intake';
import { verifySourceArtifact } from './source-artifacts';
import { DEFAULT_BUYER_PROFILE, US_JURISDICTIONS } from './buyer-profile';

const text = z.string().trim().min(1).max(2000);
const money = z.number().finite().nonnegative().max(100_000_000);
const url = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const privateHost =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      !host.includes('.') ||
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      (host.includes(':') && /^(::|fc|fd|fe80:)/.test(host));
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !privateHost;
  }, 'An HTTP(S) source URL without credentials is required');
const iso = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), 'A valid date is required');
export const salvageLotSchema = z
  .object({
    id: text,
    title: text,
    make: text,
    model: text,
    year: z.number().int().min(1900).max(2100),
    vin: z.string().trim().max(40),
    lotNumber: text,
    source: text,
    url: url.optional(),
    collectedOn: iso,
    damage: z.object({ primary: text, secondary: text.optional() }).strict(),
    titleBrand: text,
    odometer: z.number().int().nonnegative().max(10_000_000).optional(),
    odometerNote: text.optional(),
    location: text,
    saleDate: iso.optional(),
    currentBid: money.optional(),
    estRetailValue: money.optional(),
    engine: text,
    drive: text.optional(),
    fuel: text.optional(),
    color: text.optional(),
    photos: z.array(url).max(40),
    notes: text.optional(),
  })
  .strict();
export const buyerProfileSchema = z
  .object({
    // A record written before presets existed states none of the first four
    // fields; their defaults are the hobbyist wedge's (SPEC 50).
    preset: z.enum(['hobbyist', 'shop', 'dealer', 'custom']).default('custom'),
    jurisdiction: z
      .string()
      .refine(
        (value) => value === 'US-unspecified' || US_JURISDICTIONS.includes(value),
        'Select a supported US state or territory',
      ),
    access: z.enum(['broker', 'direct']).default('broker'),
    exit: z.enum(['private_party', 'wholesale', 'retail', 'keep']).default('private_party'),
    discipline: z.number().min(0.5).max(0.9).default(0.75),
    capabilities: z
      .object({
        tools: z.boolean(),
        workspace: z.boolean(),
        lift: z.boolean(),
        diagnostics: z.boolean(),
        specialistAccess: z.boolean(),
        structural: z.boolean().default(false),
        paint: z.boolean().default(false),
        alignment: z.boolean().default(false),
        hv: z.boolean().default(false),
      })
      .strict(),
    laborRatePerHour: money.max(1000),
    availableDiyHours: z.number().int().nonnegative().max(10000),
    holdingDays: z.number().int().nonnegative().max(3650),
    holdingCostPerDay: money.max(10000),
    maxAllIn: money.positive(),
    minSurplus: money,
  })
  .strict();
// Intake never fetches: a listing URL is provenance the user pasted, and a
// photo URL is an address the photo screen dereferences under the
// request-forgery boundary (SPEC 29, 61). Both are https only.
const httpsUrl = url.refine(
  (value) => new URL(value).protocol === 'https:',
  'Listing and photo links must be https',
);
// `z.record` over an enum is exhaustive in zod 4: every key would be required,
// so a buyer who corrects one chip could never create. Corrections are by
// definition partial.
const intakeEdits = z.partialRecord(
  z.enum(INTAKE_FIELDS as unknown as [IntakeField, ...IntakeField[]]),
  z.string().trim().max(200),
);
const intakeText = {
  text: z.string().trim().min(1).max(INTAKE_MAX_TEXT),
  vin: z.string().trim().max(40).optional(),
  edits: intakeEdits.optional(),
};
export const intakePreviewInputSchema = z.object(intakeText).strict();
export const intakeInputSchema = z
  .object({
    ...intakeText,
    photoUrls: z.array(httpsUrl).min(INTAKE_MIN_PHOTOS).max(INTAKE_MAX_PHOTOS),
    listingUrl: httpsUrl.optional(),
  })
  .strict();
export const createAssessmentInputSchema = z
  .object({
    seedLotId: text.optional(),
    lot: salvageLotSchema.optional(),
    intake: intakeInputSchema.optional(),
    mode: z.enum(['fixture', 'live']).default('fixture'),
    buyer: buyerProfileSchema.default(DEFAULT_BUYER_PROFILE),
    fixtureCaseId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .max(100)
      .optional(),
    budget: z
      .object({
        maxInvestigations: z.number().int().min(1).max(12).optional(),
        maxCostCents: z.number().int().min(0).max(2000).optional(),
      })
      .strict()
      .optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (value) => [value.seedLotId, value.lot, value.intake].filter(Boolean).length === 1,
    'Supply exactly one of seedLotId, lot or intake',
  );
const subject = z
  .object({
    vin: z.string().max(40).optional(),
    make: text,
    model: text,
    year: z.number().int().min(1900).max(2100),
  })
  .strict();
const source = z
  .object({
    url,
    label: text,
    capturedBy: z.enum(['recorded_fixture', 'synthetic_fixture', 'provider', 'user', 'model']),
    retrievedAt: iso,
    basis: z.enum(['source_observation', 'model_inference']).optional(),
    artifact: z
      .object({
        kind: z.enum(['provider_response', 'listing_item', 'image_manifest']),
        mediaType: z.literal('application/json'),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        content: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
    extraction: z
      .object({ method: z.enum(['deterministic', 'model']), version: text })
      .strict()
      .optional(),
    observation: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const comp = z
  .object({
    lane: z.enum(['clean', 'rebuilt', 'wreck']),
    outcome: z.enum(['sold', 'ask', 'bid_no_sale']),
    price: money.positive(),
    year: z.number().int().min(1900).max(2100).optional(),
    vehicle: z
      .object({ make: text, model: text, year: z.number().int().min(1900).max(2100) })
      .strict()
      .optional(),
    mileage: z.number().int().nonnegative().optional(),
    date: text.optional(),
    title: z.enum(['clean', 'rebuilt', 'salvage', 'unknown']).optional(),
    variant: text.optional(),
    damage: text.optional(),
    url,
    source: text,
    note: text.optional(),
  })
  .strict();
const price = z
  .object({
    line: text,
    item: text,
    kind: z.enum(['part_new', 'part_used', 'labor', 'job_quote']),
    low: money,
    high: money,
    url,
    source: text,
    note: text.optional(),
  })
  .strict()
  .refine((v) => v.low <= v.high, 'Price range is reversed');
const identity = z.object({
  vin: text,
  valid: z.boolean(),
  decoded: z
    .object({
      country: text.optional(),
      make: text.optional(),
      year: z.number().optional(),
      wmi: text,
      serial: text,
      model: text.optional(),
      trim: text.optional(),
      bodyClass: text.optional(),
      engine: text.optional(),
      plant: text.optional(),
    })
    .optional(),
  mismatches: z.array(text),
  note: text,
  links: z.array(z.object({ label: text, url })),
});
const triage = z.unknown().transform((value, ctx) => {
  try {
    return parseTriageOutput(value, 40);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Invalid damage triage' });
    return z.NEVER;
  }
});
const inspection = z
  .object({
    inspector: text,
    inspectedAt: iso,
    method: z.literal('physical'),
    repairScopeConfirmed: z.boolean(),
    systems: z
      .array(
        z
          .object({
            system: z.enum(['structure', 'srs', 'powertrain', 'hv', 'water_fire']),
            status: z.enum(['clear', 'repairable', 'unsafe', 'unknown', 'not_applicable']),
            finding: text,
          })
          .strict(),
      )
      .min(1)
      .max(5)
      .refine(
        (v) => new Set(v.map((x) => x.system)).size === v.length,
        'Each inspection system must be unique',
      ),
  })
  .strict();
export const evidenceInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('triage'), value: triage, subject, source }),
  z.object({ kind: z.literal('identity'), value: identity, subject, source }),
  z.object({ kind: z.literal('comp'), value: comp, subject, source }),
  z.object({ kind: z.literal('repair_price'), value: price, subject, source }),
  z.object({
    kind: z.literal('registration'),
    value: z
      .object({
        jurisdiction: z
          .string()
          .refine(
            (value) => US_JURISDICTIONS.includes(value),
            'Select a supported US state or territory',
          ),
        eligible: z.boolean(),
        requirements: z.array(text).max(30),
        expiresAt: iso.optional(),
      })
      .strict(),
    subject,
    source,
  }),
  z.object({ kind: z.literal('inspection'), value: inspection, subject, source }),
  z.object({
    kind: z.literal('title'),
    value: z.object({ titleBrand: text, listingDiscrepancyResolution: text.optional() }).strict(),
    subject,
    source,
  }),
]);
export const reviewEvidenceInputSchema = z
  .object({
    evidenceIds: z.array(text).min(1).max(100),
    rationale: text,
    expectedRevision: z.number().int().min(1),
    idempotencyKey: text,
  })
  .strict();
export const updateBuyerInputSchema = z
  .object({
    buyer: buyerProfileSchema,
    expectedRevision: z.number().int().min(1),
    idempotencyKey: text,
  })
  .strict();
/** Outcome kinds that state what the winning bid was, whoever won it (SPEC 62). */
export const HAMMER_OUTCOME_KINDS = ['purchased', 'lost_to_hammer'] as const;
export const HAMMER_REQUIRED =
  'A purchased or lost lot records the winning bid as the hammer price';
export const recordOutcomeInputSchema = z
  .object({
    kind: z.enum(OUTCOME_KINDS),
    note: text,
    amount: money.optional(),
    hammer: money.optional(),
    observedAt: iso.optional(),
    decisionRevision: z.number().int().min(1).optional(),
    repairCost: money.optional(),
    holdingCost: money.optional(),
    saleProceeds: money.optional(),
    expectedRevision: z.number().int().min(1),
    idempotencyKey: text,
  })
  .strict()
  // A sale the owner watched is worth recording only with the price it made,
  // so the market's answer is never saved as a note alone.
  .refine(
    (input) =>
      !(HAMMER_OUTCOME_KINDS as readonly string[]).includes(input.kind) ||
      input.hammer !== undefined,
    HAMMER_REQUIRED,
  );
export const recordEvidenceInputSchema = z
  .object({
    evidence: z.array(evidenceInputSchema).min(1).max(100),
    expectedRevision: z.number().int().min(1),
    idempotencyKey: text,
  })
  .strict();

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AssessmentError('invalid_input', result.error.issues[0]?.message ?? 'Invalid input');
  return result.data;
}
export function fingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return v;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function observationFreshnessIssue(
  input: Pick<EvidenceInput, 'kind' | 'source'> & Partial<Pick<EvidenceInput, 'value'>>,
  at: string,
): string | undefined {
  const value = input.value;
  if (value && typeof value === 'object') {
    if (
      input.kind === 'comp' &&
      'date' in value &&
      typeof value.date === 'string' &&
      (!Number.isFinite(Date.parse(value.date)) || Date.parse(value.date) > Date.parse(at) + 300000)
    )
      return 'Comparable outcome is invalid or not available as-of this assessment';
    if (
      input.kind === 'inspection' &&
      'inspectedAt' in value &&
      typeof value.inspectedAt === 'string' &&
      (Date.parse(value.inspectedAt) > Date.parse(at) + 300000 ||
        Date.parse(at) - Date.parse(value.inspectedAt) > 30 * 86400000)
    )
      return 'Physical inspection exceeds its 30-day freshness bound or is future dated';
    if (
      input.kind === 'registration' &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'string' &&
      Date.parse(value.expiresAt) < Date.parse(at)
    )
      return 'Registration eligibility observation has expired';
  }
  const days = {
    identity: 3650,
    triage: 30,
    comp: 30,
    repair_price: 90,
    title: 90,
    registration: 90,
    inspection: 30,
  }[input.kind];
  if (
    input.kind !== 'identity' &&
    Date.parse(at) - Date.parse(input.source.retrievedAt) > days * 86400000
  )
    return `Source observation exceeds the ${days}-day freshness bound and needs a new capture`;
  if (Date.parse(input.source.retrievedAt) > Date.parse(at) + 300000)
    return 'Source acquisition time is in the future';
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** The assessment subject says what this evidence addresses; it cannot supply a comp's identity. */
function comparableIdentityIssue(
  input: EvidenceInput,
  assessment: Assessment,
  reviewing = false,
): string | undefined {
  if (input.kind !== 'comp') return undefined;
  const actual = input.value.vehicle;
  if (!actual)
    return reviewing &&
      (input.source.capturedBy === 'user' ||
        (input.source.capturedBy === 'provider' &&
          (!('status' in input) || input.status !== 'accepted')))
      ? 'Record the actual comparable make, model and year before reviewing this observation'
      : undefined;
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    normalize(actual.make) !== normalize(assessment.lot.make) ||
    normalize(actual.model) !== normalize(assessment.lot.model)
  )
    return 'Actual comparable make or model does not match this assessment';
  if (Math.abs(actual.year - assessment.lot.year) > 2)
    return 'Actual comparable model year is outside the two-year applicability window';
  if (input.value.year !== actual.year)
    return 'Comparable year must match the actual vehicle year in the captured observation';
  return undefined;
}
// Only these provenances retain a structured observation; `user` is a typed
// claim and `model` is inference, neither of which is a capture (SPEC 56).
const CAPTURED_BY: EvidenceSource['capturedBy'][] = [
  'provider',
  'recorded_fixture',
  'synthetic_fixture',
];
function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
/** Review is a scoped human attestation, not an override of applicability or contradictory facts. */
export function reviewIssue(
  input: EvidenceInput,
  assessment: Assessment,
  at: string,
): string | undefined {
  const lot = assessment.lot;
  if (
    !same(input.subject.make, lot.make) ||
    !same(input.subject.model, lot.model) ||
    input.subject.year !== lot.year ||
    (input.subject.vin && !same(input.subject.vin, lot.vin))
  )
    return 'Evidence subject does not match this assessment';
  const comparableIssue = comparableIdentityIssue(input, assessment, true);
  if (comparableIssue) return comparableIssue;
  if (assessment.mode === 'live' && /fixture/.test(input.source.capturedBy))
    return 'Fixture evidence cannot become live evidence';
  if (input.source.artifact && !verifySourceArtifact(input.source.artifact))
    return 'Source artifact content does not match its retained hash';
  if (
    input.source.capturedBy === 'model' ||
    input.source.basis === 'model_inference' ||
    input.source.extraction?.method === 'model'
  )
    return 'Model inference cannot be promoted to a reviewed source fact';
  if (observationFreshnessIssue(input, at)) return observationFreshnessIssue(input, at);
  if (
    CAPTURED_BY.includes(input.source.capturedBy) &&
    (!input.source.observation ||
      fingerprint(input.source.observation) !== fingerprint(input.value))
  )
    return 'Review requires a retained structured observation matching the claimed fields';
  // A self-attested number never carries a capture, so its review binds the
  // owner's rationale to a reachable https source instead (SPEC 56).
  if (input.source.capturedBy === 'user' && !isHttps(input.source.url))
    return 'Review of a self-attested record requires an https source URL';
  if (input.kind === 'identity') {
    const d = input.value.decoded;
    if (
      !same(input.value.vin, lot.vin) ||
      !input.value.valid ||
      input.value.mismatches.length ||
      !d?.model ||
      !d.make ||
      d.year === undefined ||
      !same(d.make, lot.make) ||
      !same(d.model, lot.model) ||
      d.year !== lot.year
    )
      return 'Identity must validly corroborate this make, model, year and VIN without conflicts';
  }
  if (
    input.kind === 'registration' &&
    input.value.expiresAt &&
    Date.parse(input.value.expiresAt) < Date.parse(at)
  )
    return 'Registration eligibility observation has expired';
  if (
    input.kind === 'inspection' &&
    (Date.parse(input.value.inspectedAt) > Date.parse(at) + 300000 ||
      Date.parse(at) - Date.parse(input.value.inspectedAt) > 30 * 86400000)
  )
    return 'Physical inspection must be dated within the inspection freshness window';
  if (
    (input.kind === 'comp' || input.kind === 'repair_price') &&
    input.value.url !== input.source.url
  )
    return 'Claimed URL differs from the captured source';
  if (input.kind === 'comp' && input.value.date) {
    const date = Date.parse(input.value.date);
    if (!Number.isFinite(date) || date > Date.parse(at) + 300000)
      return 'Comparable sale or listing must have a valid as-of date, not a future outcome';
  }
  if (
    input.kind === 'repair_price' &&
    screenPriceEvidence([input.value], input.value.line, lot).kept.length !== 1
  )
    return 'Repair price is off-spec or irrelevant to this repair';
  if (
    input.kind === 'repair_price' &&
    !assessment.decision.report?.plan.lines.some((line) => line.id === input.value.line)
  )
    return 'Repair evidence does not address an active repair line';
  return undefined;
}
export function validateEvidence(
  raw: unknown,
  assessment: Assessment,
  id: string,
  at: string,
  trusted: boolean,
): AssessmentEvidence {
  const parsed = parseInput(evidenceInputSchema, raw);
  const value =
    parsed.kind === 'triage'
      ? parseTriageOutput(parsed.value, Math.min(assessment.lot.photos.length, 12))
      : parsed.value;
  // The discriminated parser checked the payload, and triage has its own existing schema.
  const input = { ...parsed, value } as EvidenceInput;
  const { lot } = assessment;
  const comparableIssue = comparableIdentityIssue(input, assessment);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  let status: AssessmentEvidence['status'] = 'accepted';
  let reason =
    'Structured source observation retained; provenance is visible and is not an independent factual guarantee';
  if (
    !same(input.subject.make, lot.make) ||
    !same(input.subject.model, lot.model) ||
    input.subject.year !== lot.year ||
    (input.subject.vin && !same(input.subject.vin, lot.vin))
  ) {
    status = 'rejected';
    reason = 'Evidence subject does not match this assessment';
  } else if (comparableIssue) {
    status = 'rejected';
    reason = comparableIssue;
  } else if (
    !trusted ||
    input.source.capturedBy === 'user' ||
    (input.source.capturedBy === 'model' &&
      !(trusted && input.kind === 'triage' && input.source.basis === 'model_inference')) ||
    !input.source.observation
  ) {
    status = 'unverified';
    reason = 'A citation or supplied claim alone does not establish the stated fact';
  } else if (assessment.mode === 'live' && /fixture/.test(input.source.capturedBy)) {
    status = 'rejected';
    reason = 'Fixture evidence cannot become live evidence';
  } else if (observationFreshnessIssue(input, at)) {
    status = 'unverified';
    reason = observationFreshnessIssue(input, at)!;
  } else if (input.source.artifact && !verifySourceArtifact(input.source.artifact)) {
    status = 'rejected';
    reason = 'Source artifact content does not match its retained hash';
  } else if (
    input.kind === 'comp' &&
    input.value.date &&
    (!Number.isFinite(Date.parse(input.value.date)) ||
      Date.parse(input.value.date) > Date.parse(at) + 300000)
  ) {
    status = 'unverified';
    reason = 'Future or undated sale outcomes cannot be used as-of this assessment';
  } else if (fingerprint(input.source.observation) !== fingerprint(input.value)) {
    status = 'unverified';
    reason = 'Structured source observation does not match the claimed fields';
  } else if (
    (input.kind === 'registration' || input.kind === 'inspection') &&
    !input.source.capturedBy.includes('fixture')
  ) {
    status = 'unverified';
    reason =
      'Title eligibility and physical inspection require explicit owner review of the scoped source';
  } else if (input.kind === 'identity' && !same(input.value.vin, lot.vin)) {
    status = 'rejected';
    reason = 'Decoded VIN does not match this assessment';
  } else if (
    input.kind === 'triage' &&
    input.value.areas.some((area) => area.photos.length === 0)
  ) {
    status = 'unverified';
    reason = 'Damage area lacks an available photo anchor';
  } else if (
    input.kind === 'repair_price' &&
    !assessment.decision.report?.plan.lines.some((line) => line.id === input.value.line)
  ) {
    status = 'rejected';
    reason = 'Repair evidence does not address an active repair line';
  } else if (
    (input.kind === 'comp' || input.kind === 'repair_price') &&
    input.value.url !== input.source.url
  ) {
    status = 'unverified';
    reason = 'Claimed URL differs from the captured source';
  }
  return {
    ...input,
    id,
    recordedAt: at,
    fingerprint: fingerprint({
      kind: input.kind,
      subject: input.subject,
      value: input.value,
      source: {
        url: input.source.url,
        retrievedAt: input.source.retrievedAt,
        capturedBy: input.source.capturedBy,
      },
    }),
    status,
    reason,
  };
}
