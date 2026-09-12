import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRun, streamRun } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';

// The live tail: replay persisted events from ?from= (default: everything),
// then stream new ones until the run finishes. One StoredEvent envelope per
// NDJSON line — {seq, at, event} — so the client can resume from any cursor.

// Web research + multi-image vision can legitimately take a few minutes.
export const maxDuration = 300;

export async function GET(request: NextRequest, ctx: RouteContext<'/api/runs/[id]/stream'>) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'malformed run id' }, { status: 400 });
  }
  let store;
  let run;
  try {
    store = await resolveRunStore();
    run = await getRun(id, store);
  } catch (err) {
    console.error(`run ${id} stream attach failed:`, err);
    return NextResponse.json({ error: 'run storage is unavailable right now' }, { status: 503 });
  }
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  const fromParam = Number(request.nextUrl.searchParams.get('from'));
  const from = Number.isInteger(fromParam) && fromParam > 0 ? fromParam : 1;

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Blank-line heartbeats keep an idle tail (a run held by another
      // instance, or a long model call) from being cut by proxies; the
      // client skips empty lines.
      const heartbeat = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode('\n'));
        } catch {
          // stream already closed
        }
      }, 15_000);
      try {
        for await (const stored of streamRun(id, store, from)) {
          if (cancelled) break;
          controller.enqueue(encoder.encode(`${JSON.stringify(stored)}\n`));
        }
      } catch (err) {
        if (!cancelled) {
          console.error(`run ${id} stream failed:`, err);
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by cancellation
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
