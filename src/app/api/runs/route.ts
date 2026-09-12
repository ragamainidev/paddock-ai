import { NextRequest, NextResponse } from 'next/server';
import { isRunActive, reconcileInterrupted } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';
import type { RunKind } from '@/runs/types';

// Recent runs for the index pages. Summaries only — reports load per run.
// Runs orphaned by a server restart reconcile to error here rather than
// spinning forever in the list.

export async function GET(request: NextRequest) {
  try {
    const store = await resolveRunStore();
    const kindParam = request.nextUrl.searchParams.get('kind');
    const kind: RunKind | undefined =
      kindParam === 'inspect' || kindParam === 'salvage' ? kindParam : undefined;
    const limitParam = Number(request.nextUrl.searchParams.get('limit'));
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 12;
    const runs = await Promise.all(
      (await store.listRuns({ kind, limit })).map((run) =>
        run.status === 'running' && !isRunActive(run.id) ? reconcileInterrupted(run, store) : run,
      ),
    );
    return NextResponse.json({ runs, persisted: store.persistent });
  } catch (err) {
    console.error('run list unavailable:', err);
    return NextResponse.json({ error: 'run history is unavailable right now' }, { status: 503 });
  }
}
