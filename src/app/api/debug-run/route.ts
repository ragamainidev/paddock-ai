import { after, NextResponse } from 'next/server';
import { runCompletion, startRun } from '@/runs/manager';
import { resolveRunStore } from '@/runs/resolve-store';

/**
 * Synthetic run for UI verification: emits staged events on a fixed
 * schedule with zero model calls, so live-console behavior (timers,
 * pacing, reconnects) can be observed without spending API credit.
 * Enabled only when PADDOCK_DEBUG=1; absent from any normal deployment.
 */

async function* syntheticRun() {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  yield { type: 'begin', stage: 'triage' };
  yield { type: 'thought', stage: 'triage', text: 'synthetic: examining nothing in particular' };
  await sleep(8_000);
  yield { type: 'stage', status: { stage: 'triage', ok: true, detail: 'synthetic triage done' } };
  yield { type: 'begin', stage: 'research' };
  for (let i = 1; i <= 4; i++) {
    yield {
      type: 'thought',
      stage: 'research',
      text: `[lane-${i}] searching: synthetic query ${i}`,
    };
    await sleep(12_000);
  }
  yield {
    type: 'stage',
    status: { stage: 'research', ok: true, detail: 'synthetic research done' },
  };
  yield { type: 'begin', stage: 'synthesis' };
  await sleep(5_000);
  yield {
    type: 'stage',
    status: { stage: 'synthesis', ok: false, detail: 'synthetic: no report' },
  };
  yield { type: 'fatal', message: 'synthetic run complete (this is the expected ending)' };
}

export async function POST() {
  if (process.env.PADDOCK_DEBUG !== '1') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const store = await resolveRunStore();
  const id = startRun({
    kind: 'salvage',
    title: 'DEBUG synthetic run',
    vehicle: { make: 'Debug', model: 'Synthetic', year: 2026 },
    input: { lotId: 'debug' },
    gen: syntheticRun(),
    store,
    finalize: () => ({ error: 'synthetic run, no report' }),
  });

  // Keep this serverless instance alive until the detached run finalizes;
  // the response itself returns now. Bounded by maxDuration.
  after(() => runCompletion(id));
  return NextResponse.json({ id }, { status: 202 });
}
