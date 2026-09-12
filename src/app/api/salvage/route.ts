import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assessSalvageStream } from '@/salvage/assess';
import { getSalvageLot, SALVAGE_LOTS } from '@/salvage/seed-lots';
import type { SalvageEvent, SalvageReport } from '@/salvage/types';
import { findActiveRun, runCompletion, startRun } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';

// Start a salvage-rebuild assessment on a seeded real lot. Same run
// machinery as inspections: 202 with the run id, then the client tails
// /api/runs/:id/stream.

// Same bound as the inspector: the assessment runs detached (after()).
export const maxDuration = 300;

const inputSchema = z.object({ lotId: z.string().min(1).max(60) });

export function finalizeSalvage(events: unknown[]): {
  report?: SalvageReport;
  verdict?: string;
  error?: string;
} {
  let report: SalvageReport | undefined;
  let fatal: string | undefined;
  for (const raw of events) {
    const event = raw as SalvageEvent;
    if (event.type === 'report') report = event.report;
    if (event.type === 'fatal') fatal = event.message;
  }
  if (fatal) return { error: fatal };
  if (report) return { report, verdict: report.assessment.verdict };
  return { error: 'assessment ended without a report' };
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
    return NextResponse.json({ error: 'provide a lotId' }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 503 },
    );
  }
  const lot = getSalvageLot(parsed.data.lotId);
  if (!lot) {
    return NextResponse.json({ error: `unknown lot "${parsed.data.lotId}"` }, { status: 404 });
  }

  // This lot already has a run in flight: attach to it instead of paying
  // for a second one. The client lands on the live console either way.
  const inFlight = findActiveRun(
    (r) => r.kind === 'salvage' && (r.input as { lotId?: string })?.lotId === lot.id,
  );
  if (inFlight) {
    return NextResponse.json({ id: inFlight, existing: true }, { status: 200 });
  }

  const store = await resolveRunStore();
  const id = startRun({
    kind: 'salvage',
    title: lot.title,
    vehicle: { make: lot.make, model: lot.model, year: lot.year },
    input: {
      lotId: lot.id,
      listing: { url: lot.url, source: lot.source },
      photos: lot.photos.map((url) => ({ kind: 'url' as const, url })),
    },
    gen: assessSalvageStream(lot),
    store,
    finalize: finalizeSalvage,
  });

  // Keep this serverless instance alive until the detached run finalizes;
  // the response itself returns now. Bounded by maxDuration.
  after(() => runCompletion(id));
  return NextResponse.json({ id, persisted: store.persistent }, { status: 202 });
}

export async function GET() {
  return NextResponse.json({
    status: process.env.ANTHROPIC_API_KEY ? 'ready' : 'degraded',
    lots: SALVAGE_LOTS.length,
  });
}
