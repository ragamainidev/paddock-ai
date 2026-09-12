import { z } from 'zod';
import { statedFailure } from '@/lib/failure';
import type { PhotoAnalysis, PhotoSource } from './types';

// Vision analysis over the actual photos. Structured output via a forced
// tool call — no text parsing — validated with zod, photo anchors clamped to
// indices that exist. The caller is injected (same contract as ThemeCaller /
// ModelCaller) so every validation path tests offline.

export type VisionContext = {
  make: string;
  model: string;
  year: number;
  // The seller's own framing, when the car came from a live listing — the
  // model checks the photos against what the listing claims.
  listing?: { title: string; condition?: string; description?: string };
};

export type VisionCaller = (input: {
  photos: PhotoSource[];
  context: VisionContext;
}) => Promise<unknown>;

const TOOL_NAME = 'report_inspection';

// Sonnet, not Haiku: multi-image condition assessment is the one stage where
// judgment quality is the product.
const VISION_MODEL = 'claude-sonnet-5';
// Vision is the one fatal inspection stage, and it runs first: its bound
// plus the stages after it has to fit the route's maxDuration
// (docs/operations.md §8). The timeout bounds ONE attempt, so the stage
// costs the timeout times the attempts; SDK retries stay off, because a
// second attempt spends wall clock the ceiling has not budgeted
// (docs/llm-patterns.md §6).
export const VISION_TIMEOUT_MS = 100_000;
export const VISION_ATTEMPTS = 1;

const ISSUE_TYPES = [
  'body_damage',
  'rust',
  'paint_issue',
  'fluid_leak',
  'tire_wear',
  'glass_damage',
  'lighting_issue',
  'undercarriage_issue',
  'interior_wear',
  'frame_damage',
] as const;

const MOD_TYPES = [
  'exhaust',
  'suspension',
  'wheels',
  'body_kit',
  'engine_mods',
  'brakes',
  'intake',
  'ecu_tune',
  'interior_mods',
] as const;

const REPORT_INSPECTION_TOOL = {
  name: TOOL_NAME,
  description: 'Report the structured inspection of the vehicle photos.',
  // Constrained decoding: the API guarantees the input matches the schema,
  // so enum drift can't produce off-taxonomy findings in the first place.
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      observations: {
        type: 'array',
        description:
          'One short observation per photo, in photo order: what the photo shows and anything notable. Reference photos by their zero-based index.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            photo: { type: 'integer', description: 'zero-based photo index' },
            note: { type: 'string', description: 'one sentence, specific to this photo' },
          },
          required: ['photo', 'note'],
        },
      },
      overallCondition: { type: 'string', enum: ['excellent', 'good', 'fair', 'poor'] },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: [...ISSUE_TYPES] },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            description: { type: 'string' },
            location: { type: 'string', description: 'where on the vehicle' },
            photos: {
              type: 'array',
              items: { type: 'integer' },
              description: 'indices of photos showing this issue',
            },
          },
          required: ['type', 'severity', 'description', 'photos'],
        },
      },
      modifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: [...MOD_TYPES] },
            description: { type: 'string' },
            quality: {
              type: 'string',
              enum: ['oem', 'quality_aftermarket', 'budget_aftermarket', 'unknown'],
            },
            photos: { type: 'array', items: { type: 'integer' } },
          },
          required: ['type', 'description', 'quality', 'photos'],
        },
      },
      wear: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            component: { type: 'string' },
            level: { type: 'string', enum: ['minimal', 'moderate', 'significant'] },
            description: { type: 'string' },
          },
          required: ['component', 'level', 'description'],
        },
      },
      confidence: {
        type: 'number',
        description: '0-1; lower it when photos are few, low-resolution, or staged',
      },
    },
    required: ['observations', 'overallCondition', 'issues', 'modifications', 'wear', 'confidence'],
  },
};

const SYSTEM_PROMPT = `You are a pre-purchase inspector examining photos of a used vehicle a buyer is considering. Report only what is visible in the photos — never infer problems you cannot see, and never soften ones you can.
Rules:
- Anchor every issue and modification to the photo indices that show it.
- Severity: critical = safety or structural, high = expensive repair, medium = noticeable defect, low = minor cosmetic.
- Modification quality: judge parts and workmanship visible in the photo (brand hardware and clean installs vs. universal parts, zip ties, rattle-can work).
- Watch for seller staging: tight crops avoiding panels, wet paint, photos that skip the underside or engine bay. Fewer angles means lower confidence.
- Uneven tire wear, mismatched panel gaps, overspray, and fresh undercoating are evidence, not trivia — call them out.`;

const observationSchema = z.object({ photo: z.number().int(), note: z.string().min(1) });

const outputSchema = z.object({
  observations: z.array(observationSchema).default([]),
  overallCondition: z.enum(['excellent', 'good', 'fair', 'poor']),
  issues: z
    .array(
      z.object({
        type: z.enum(ISSUE_TYPES),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        description: z.string().min(1),
        location: z.string().optional(),
        photos: z.array(z.number().int()).default([]),
      }),
    )
    .default([]),
  modifications: z
    .array(
      z.object({
        type: z.enum(MOD_TYPES),
        description: z.string().min(1),
        quality: z.enum(['oem', 'quality_aftermarket', 'budget_aftermarket', 'unknown']),
        photos: z.array(z.number().int()).default([]),
      }),
    )
    .default([]),
  wear: z
    .array(
      z.object({
        component: z.string().min(1),
        level: z.enum(['minimal', 'moderate', 'significant']),
        description: z.string().min(1),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
});

// The seller's claims ride along so the model inspects THIS listing, not the
// model range in general — "adult owned, garage kept" against photos showing
// curbed wheels is exactly the discrepancy a PPI exists to catch.
export function visionUserText(photoCount: number, context: VisionContext): string {
  const lines = [
    `Vehicle as listed: ${context.year} ${context.make} ${context.model}. ${photoCount} photo(s).`,
  ];
  if (context.listing) {
    lines.push(`Listing title: "${context.listing.title}"`);
    if (context.listing.condition) lines.push(`Seller's condition: ${context.listing.condition}`);
    if (context.listing.description) {
      lines.push(`Seller's description: ${context.listing.description.slice(0, 600)}`);
    }
    lines.push('Note any claim the photos contradict.');
  }
  lines.push('Inspect and report.');
  return lines.join('\n');
}

// Anthropic image content blocks for both photo kinds.
export function photoContentBlocks(photos: PhotoSource[]): unknown[] {
  return photos.flatMap((photo, i) => [
    { type: 'text', text: `Photo ${i}:` },
    photo.kind === 'url'
      ? { type: 'image', source: { type: 'url', url: photo.url } }
      : {
          type: 'image',
          source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
        },
  ]);
}

export const defaultVisionCaller: VisionCaller = async ({ photos, context }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // Reads ANTHROPIC_API_KEY server-side; the timeout turns a wedged
  // connection into a thrown error the orchestrator already handles.
  const client = new Anthropic({ timeout: VISION_TIMEOUT_MS, maxRetries: VISION_ATTEMPTS - 1 });
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [REPORT_INSPECTION_TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
    messages: [
      {
        role: 'user',
        content: [
          ...photoContentBlocks(photos),
          { type: 'text', text: visionUserText(photos.length, context) },
        ],
        // The SDK's param type is wide; blocks above match the wire format.
      },
    ] as never,
  });
  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw statedFailure('vision model returned no tool_use block');
  return toolUse.input;
};

// One finding with a type outside the taxonomy must not kill the analysis:
// drop that entry before strict parsing, keep everything else. (The tool is
// declared strict, so this is the second line of defense.)
function dropUnknownTypes(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  const keep = (list: unknown, allowed: readonly string[]) =>
    Array.isArray(list)
      ? list.filter(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            allowed.includes((entry as { type?: string }).type ?? ''),
        )
      : list;
  return {
    ...r,
    issues: keep(r.issues, ISSUE_TYPES),
    modifications: keep(r.modifications, MOD_TYPES),
  };
}

// Validate raw model output into a PhotoAnalysis. Photo anchors that don't
// exist are dropped (SPEC: findings only cite photos that exist); a finding
// that loses all its anchors survives with none rather than being invented
// an anchor.
export function parseVisionOutput(raw: unknown, photoCount: number): PhotoAnalysis {
  const parsed = outputSchema.safeParse(dropUnknownTypes(raw));
  if (!parsed.success) {
    throw statedFailure(
      `vision output failed validation: ${parsed.error.issues[0]?.message ?? '?'}`,
    );
  }
  const valid = (indices: number[]) => indices.filter((i) => i >= 0 && i < photoCount);
  const d = parsed.data;
  return {
    overallCondition: d.overallCondition,
    observations: d.observations.filter((o) => o.photo >= 0 && o.photo < photoCount),
    issues: d.issues.map((issue) => ({ ...issue, photos: valid(issue.photos) })),
    modifications: d.modifications.map((mod) => ({ ...mod, photos: valid(mod.photos) })),
    wear: d.wear,
    confidence: d.confidence,
  };
}

export async function analyzePhotos(
  photos: PhotoSource[],
  context: VisionContext,
  caller: VisionCaller = defaultVisionCaller,
): Promise<PhotoAnalysis> {
  if (photos.length === 0) throw statedFailure('no photos to analyze');
  const raw = await caller({ photos, context });
  return parseVisionOutput(raw, photos.length);
}
