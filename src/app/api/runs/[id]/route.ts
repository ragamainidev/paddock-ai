import { NextRequest, NextResponse } from 'next/server';
import { getRun } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';

// One run's record: status, metadata, and the report once finished. Active
// runs come from the manager's memory; finished ones from the store.

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/runs/[id]'>) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'malformed run id' }, { status: 400 });
  }
  try {
    const store = await resolveRunStore();
    const run = await getRun(id, store);
    if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    console.error(`run ${id} read failed:`, err);
    return NextResponse.json({ error: 'run storage is unavailable right now' }, { status: 503 });
  }
}
