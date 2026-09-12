import { z } from 'zod';
import { statedFailure } from '@/lib/failure';
import type { PhotoSource } from '@/inspector/types';
import type { DamageTriage, SalvageLot } from './types';

// Damage triage over the lot's actual auction photos. Same discipline as the
// inspector's vision stage: forced tool call, zod validation, photo anchors
// clamped to indices that exist. The salvage question is different though —
// not "should you buy this car" but "what is broken, how badly, and is the
// structure involved".

export type TriageCaller = (input: {
  photos: PhotoSource[];
  lot: Pick<SalvageLot, 'make' | 'model' | 'year' | 'damage' | 'titleBrand' | 'engine' | 'notes'>;
}) => Promise<unknown>;

const TOOL_NAME = 'report_damage_triage';
const TRIAGE_MODEL = 'claude-sonnet-5';
// Triage runs before the research workers; the two together have to fit the
// route's maxDuration (docs/operations.md §8). The timeout bounds ONE
// attempt, so the stage costs the timeout times the attempts; SDK retries
// stay off, because a second attempt spends wall clock the ceiling has not
// budgeted (docs/llm-patterns.md §6).
export const TRIAGE_TIMEOUT_MS = 120_000;
export const TRIAGE_ATTEMPTS = 1;

const KINDS = ['structural', 'cosmetic', 'mechanical', 'electrical'] as const;

const TRIAGE_TOOL = {
  name: TOOL_NAME,
  description: 'Report the structured damage triage of the salvage lot photos.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      observations: {
        type: 'array',
        description: 'One note per photo, in order, zero-based indices.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            photo: { type: 'integer' },
            note: { type: 'string' },
          },
          required: ['photo', 'note'],
        },
      },
      overall: {
        type: 'string',
        enum: ['rebuildable', 'borderline', 'parts_car'],
        description: 'Judged from damage extent only — title brand is handled elsewhere.',
      },
      areas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            area: {
              type: 'string',
              description: 'e.g. "front clip", "left rocker", "rear subframe"',
            },
            kind: { type: 'string', enum: [...KINDS] },
            severity: { type: 'string', enum: ['light', 'moderate', 'heavy'] },
            description: { type: 'string' },
            photos: { type: 'array', items: { type: 'integer' } },
          },
          required: ['area', 'kind', 'severity', 'description', 'photos'],
        },
      },
      airbagsDeployed: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      floodEvidence: { type: 'boolean' },
      fireEvidence: { type: 'boolean' },
      drivetrainRisk: {
        type: 'string',
        description: 'What the photos suggest about engine/gearbox exposure, one or two sentences.',
      },
      confidence: { type: 'number', description: '0-1; auction photos hide a lot — say so' },
    },
    required: [
      'observations',
      'overall',
      'areas',
      'airbagsDeployed',
      'floodEvidence',
      'fireEvidence',
      'drivetrainRisk',
      'confidence',
    ],
  },
};

const SYSTEM = `You triage crash damage on salvage-auction exotics for a rebuilder deciding whether to bid. Judge only what the photos show.
Rules:
- Separate structural (rails, tub, firewall, subframes, crash structures) from cosmetic (panels, lamps, glass, trim), mechanical (suspension, cooling, drivetrain), and electrical.
- Anchor every area to the photo indices that show it.
- Look for the tells: airbag covers, coolant/oil on the ground, wheel angles that mean bent suspension or worse, tarps hiding sections, missing drivetrain parts, yard-forklift damage.
- Auction photos flatter cars less than dealers do, but they still hide undersides — keep confidence honest.
Severity is a rubric, not an impression:
- light: surface damage only (scratches, scuffs, chips, small dents); the panel keeps its shape.
- moderate: a panel, lamp, or glass piece is deformed, cracked, or needs replacement, but the structure behind it looks intact.
- heavy: crushed or torn sections, missing panels, or exposed/deformed structure behind the skin.
Call an area structural ONLY when a load-bearing member (frame rail, strut tower, pillar, subframe, floor, firewall, carbon tub) is visibly deformed, cracked, or torn in a photo. Suspicion of hidden structural damage belongs in the area description or drivetrainRisk, never in the kind.
Report each damaged zone ONCE, using these zone names where they fit: front clip, front structure, left front corner, right front corner, hood, windshield/glass, left side, right side, roof, rear clip, rear structure, interior, underbody, wheels/suspension. Merge overlapping damage into one entry per zone.`;

const triageSchema = z.object({
  observations: z.array(z.object({ photo: z.number().int(), note: z.string().min(1) })).default([]),
  overall: z.enum(['rebuildable', 'borderline', 'parts_car']),
  areas: z
    .array(
      z.object({
        area: z.string().min(1),
        kind: z.enum(KINDS),
        severity: z.enum(['light', 'moderate', 'heavy']),
        description: z.string().min(1),
        photos: z.array(z.number().int()).default([]),
      }),
    )
    .default([]),
  airbagsDeployed: z.enum(['yes', 'no', 'unknown']),
  floodEvidence: z.boolean(),
  fireEvidence: z.boolean(),
  drivetrainRisk: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const defaultTriageCaller: TriageCaller = async ({ photos, lot }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // A wedged stream must throw, not hang the run.
  const client = new Anthropic({ timeout: TRIAGE_TIMEOUT_MS, maxRetries: TRIAGE_ATTEMPTS - 1 });
  const blocks = photos.flatMap((photo, i) => [
    { type: 'text', text: `Photo ${i}:` },
    photo.kind === 'url'
      ? { type: 'image', source: { type: 'url', url: photo.url } }
      : {
          type: 'image',
          source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
        },
  ]);
  const context = [
    `Lot as listed: ${lot.year} ${lot.make} ${lot.model}, ${lot.engine}.`,
    `Listed damage: ${lot.damage.primary}${lot.damage.secondary ? ` + ${lot.damage.secondary}` : ''}. Title: ${lot.titleBrand}.`,
    lot.notes ? `Context: ${lot.notes}` : '',
    'Triage the damage.',
  ]
    .filter(Boolean)
    .join('\n');
  const response = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text: context }] }] as never,
  });
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw statedFailure('triage model returned no tool_use block');
  return toolUse.input;
};

export function parseTriageOutput(raw: unknown, photoCount: number): DamageTriage {
  const parsed = triageSchema.safeParse(raw);
  if (!parsed.success) {
    throw statedFailure(
      `triage output failed validation: ${parsed.error.issues[0]?.message ?? '?'}`,
    );
  }
  const valid = (indices: number[]) => indices.filter((i) => i >= 0 && i < photoCount);
  const d = parsed.data;
  // Merge duplicate zone entries the rubric asks the model not to produce:
  // same zone + kind collapses to one area at the worst severity, photos
  // unioned. Duplicate areas double repair tasks and swing the money math.
  const rank = { light: 0, moderate: 1, heavy: 2 } as const;
  const merged = new Map<string, (typeof d.areas)[number]>();
  for (const area of d.areas) {
    const key = `${area.area.trim().toLowerCase()}|${area.kind}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...area });
    } else {
      merged.set(key, {
        ...existing,
        severity: rank[area.severity] > rank[existing.severity] ? area.severity : existing.severity,
        photos: [...new Set([...existing.photos, ...area.photos])],
      });
    }
  }
  return {
    overall: d.overall,
    areas: [...merged.values()].map((a) => ({ ...a, photos: valid(a.photos) })),
    airbagsDeployed: d.airbagsDeployed,
    floodEvidence: d.floodEvidence,
    fireEvidence: d.fireEvidence,
    drivetrainRisk: d.drivetrainRisk,
    observations: d.observations.filter((o) => o.photo >= 0 && o.photo < photoCount),
    confidence: d.confidence,
  };
}

export async function triagePhotos(
  lot: SalvageLot,
  caller: TriageCaller = defaultTriageCaller,
  maxPhotos = 12,
): Promise<DamageTriage> {
  const photos: PhotoSource[] = lot.photos.slice(0, maxPhotos).map((url) => ({ kind: 'url', url }));
  if (photos.length === 0) throw statedFailure('lot has no photos to triage');
  const raw = await caller({ photos, lot });
  return parseTriageOutput(raw, photos.length);
}
