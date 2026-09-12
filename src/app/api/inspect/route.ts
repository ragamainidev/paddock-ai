import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { inspectCarStream } from '@/inspector/inspector';
import { getSeedListing, SEED_LISTINGS } from '@/inspector/seed-listings';
import type { InspectEvent, InspectorInput, InspectorReport } from '@/inspector/types';
import { runCompletion, startRun } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';

// POST starts an inspection run and returns its id immediately; the client
// follows /api/runs/:id/stream for the live NDJSON tail. The run executes
// detached from this response — a refresh (or a lost laptop lid) costs
// nothing, the run keeps going and the page re-attaches by id.

// Vision + parallel research workers legitimately run for minutes; the run
// is detached (after()) and this bounds how long the instance may hold it.
export const maxDuration = 300;

const MAX_PHOTOS = 8;
// ~5MB of image bytes per photo once base64 is decoded.
const MAX_UPLOAD_CHARS = 7_000_000;

// https only: the probe dereferences these URLs server-side, so the scheme
// is part of the request-forgery boundary in `src/inspector/photos.ts`.
const photoUrl = z
  .string()
  .url()
  .max(2000)
  .refine((raw) => {
    try {
      return new URL(raw).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'photo urls must be https');

const photoSchema = z.union([
  z.object({ kind: z.literal('url'), url: photoUrl }),
  z.object({
    kind: z.literal('upload'),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    data: z
      .string()
      .min(1)
      .max(MAX_UPLOAD_CHARS)
      .regex(/^[A-Za-z0-9+/]+=*$/, 'not base64'),
  }),
]);

const inputSchema = z
  .object({
    seedId: z.string().optional(),
    photos: z.array(photoSchema).max(MAX_PHOTOS).default([]),
    make: z.string().trim().min(1).max(40).optional(),
    model: z.string().trim().min(1).max(40).optional(),
    year: z.number().int().min(1930).max(2030).optional(),
    vin: z.string().trim().max(20).optional(),
    askingPrice: z.number().positive().max(10_000_000).optional(),
  })
  .refine((v) => v.seedId || (v.photos.length > 0 && v.make && v.model && v.year), {
    message: 'provide a seedId, or photos plus make/model/year',
  });

function buildInput(body: z.infer<typeof inputSchema>): InspectorInput | { error: string } {
  if (body.seedId) {
    const seed = getSeedListing(body.seedId);
    if (!seed) return { error: `unknown seed listing "${body.seedId}"` };
    return {
      photos: seed.photos.map((url) => ({ kind: 'url' as const, url })),
      make: seed.make,
      model: seed.model,
      year: seed.year,
      vin: seed.vin,
      askingPrice: seed.price,
      listing: {
        title: seed.title,
        url: seed.url,
        source: seed.source,
        description: seed.description,
      },
    };
  }
  return {
    photos: body.photos,
    make: body.make as string,
    model: body.model as string,
    year: body.year as number,
    vin: body.vin || undefined,
    askingPrice: body.askingPrice,
  };
}

// Close out the run from its own event log: the report event wins, a fatal
// is the error, and a stream that ends with neither is a bug worth naming.
export function finalizeInspect(events: unknown[]): {
  report?: InspectorReport;
  verdict?: string;
  error?: string;
} {
  let report: InspectorReport | undefined;
  let fatal: string | undefined;
  for (const raw of events) {
    const event = raw as InspectEvent;
    if (event.type === 'report') report = event.report;
    if (event.type === 'fatal') fatal = event.message;
  }
  if (fatal) return { error: fatal };
  if (report) return { report, verdict: report.assessment.verdict };
  return { error: 'inspection ended without a report' };
}

// The run store never sees photo bytes: uploads are megabytes of base64 the
// client already holds, and persisted inputs must stay light (SPEC 29).
function storableInput(input: InspectorInput, seedId?: string): unknown {
  return {
    seedId,
    make: input.make,
    model: input.model,
    year: input.year,
    vin: input.vin,
    askingPrice: input.askingPrice,
    listing: input.listing,
    photos: input.photos.map((p) =>
      p.kind === 'url' ? { kind: 'url', url: p.url } : { kind: 'upload' },
    ),
  };
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid input' },
      { status: 400 },
    );
  }

  // Same guard the other model stages have: no key means an honest refusal
  // before the run starts, never a mocked "inspection".
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 503 },
    );
  }

  const input = buildInput(parsed.data);
  if ('error' in input) {
    return NextResponse.json({ error: input.error }, { status: 404 });
  }

  const store = await resolveRunStore();
  const title = input.listing?.title ?? `${input.year} ${input.make} ${input.model}`;
  const id = startRun({
    kind: 'inspect',
    title,
    vehicle: { make: input.make, model: input.model, year: input.year },
    input: storableInput(input, parsed.data.seedId),
    gen: inspectCarStream(input),
    store,
    finalize: finalizeInspect,
  });

  // Keep this serverless instance alive until the detached run finalizes;
  // the response itself returns now. Bounded by maxDuration.
  after(() => runCompletion(id));
  return NextResponse.json({ id, persisted: store.persistent }, { status: 202 });
}

// Capability probe for the UI: which stages can run in this deployment.
export async function GET() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const store = await resolveRunStore();
  return NextResponse.json({
    status: hasKey ? 'ready' : 'degraded',
    capabilities: {
      vision: hasKey,
      webResearch: hasKey,
      nhtsa: true,
      vinDecode: true,
      marketComps: true,
      persistence: store.persistent,
    },
    seedListings: SEED_LISTINGS.length,
  });
}
