import { describe, expect, it } from 'vitest';
import { userFacingReason } from '@/lib/failure';
import { getRun, reconcileInterrupted, runCompletion, startRun, streamRun } from './manager';
import { MemoryRunStore, type RunStore } from './store';
import type { RunMetaEvent, StoredEvent } from './types';

// The manager drives generators detached from HTTP: events fan out live,
// late subscribers replay, the store is mirrored best-effort, and a hung
// generator is declared dead instead of running forever.

const vehicle = { make: 'Mazda', model: 'MX-5', year: 2006 };

async function* threeEvents() {
  yield { type: 'thought', text: 'one' };
  yield { type: 'thought', text: 'two' };
  yield { type: 'report', report: { assessment: { verdict: 'pass' } } };
}

// Extracts outcome the way the inspect API will.
const finalize = (events: unknown[]) => {
  const report = events.find(
    (e): e is { type: 'report'; report: { assessment: { verdict: string } } } =>
      (e as { type?: string }).type === 'report',
  );
  return report
    ? { report: report.report, verdict: report.report.assessment.verdict }
    : { error: 'no report' };
};

function start(store: RunStore, gen: AsyncGenerator<unknown>, timeoutMs?: number) {
  return startRun({
    kind: 'inspect',
    title: '2006 Mazda MX-5',
    vehicle,
    input: { seedId: 'nc' },
    gen,
    store,
    finalize,
    eventTimeoutMs: timeoutMs,
  });
}

async function collect(gen: AsyncGenerator<StoredEvent>): Promise<StoredEvent[]> {
  const events: StoredEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

const until = async (predicate: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition never became true');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('run manager', () => {
  it('streams run-meta first, then every generator event, live', async () => {
    const store = new MemoryRunStore();
    const id = start(store, threeEvents());
    const events = await collect(streamRun(id, store));

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const meta = events[0].event as RunMetaEvent;
    expect(meta).toMatchObject({ type: 'run-meta', runId: id, persisted: false });
    expect(events.at(-1)?.event).toMatchObject({ type: 'report' });
  });

  it('finishes the run with the finalized report and verdict', async () => {
    const store = new MemoryRunStore();
    const id = start(store, threeEvents());
    await collect(streamRun(id, store));
    await until(() => false, 50).catch(() => {}); // let finishRun settle
    const run = await getRun(id, store);
    expect(run).toMatchObject({ status: 'done', verdict: 'pass' });
  });

  it('replays everything for a late subscriber (the refresh case)', async () => {
    const store = new MemoryRunStore();
    const id = start(store, threeEvents());
    await collect(streamRun(id, store)); // first client watches to the end
    const replay = await collect(streamRun(id, store)); // "refresh"
    expect(replay.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('resumes from a cursor: fromSeq replays only the tail', async () => {
    const store = new MemoryRunStore();
    const id = start(store, threeEvents());
    await collect(streamRun(id, store));
    const tail = await collect(streamRun(id, store, 3));
    expect(tail.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('marks the run error when the generator throws, keeping earlier events', async () => {
    async function* explodes() {
      yield { type: 'thought', text: 'starting' };
      throw new Error('vision blew up');
    }
    const store = new MemoryRunStore();
    const id = start(store, explodes());
    const events = await collect(streamRun(id, store));
    expect(events).toHaveLength(2); // meta + thought
    await until(() => true);
    const run = await getRun(id, store);
    expect(run?.status).toBe('error');
    expect(run?.error).toBe(userFacingReason('unknown'));
    expect(run?.error).not.toContain('vision blew up');
  });

  it('a finalize crash still settles the run: error status, streams close', async () => {
    const store = new MemoryRunStore();
    const id = startRun({
      kind: 'inspect',
      title: '2006 Mazda MX-5',
      vehicle,
      input: { seedId: 'nc' },
      gen: threeEvents(),
      store,
      finalize: () => {
        throw new Error('reducer bug');
      },
    });
    // The subscriber's stream must END despite finalize throwing.
    const events = await collect(streamRun(id, store));
    expect(events.length).toBeGreaterThan(0);
    await until(() => true);
    const run = await getRun(id, store);
    expect(run?.status).toBe('error');
    expect(run?.error).toBe(`finalize failed: ${userFacingReason('unknown')}`);
  });

  it('declares a silent generator dead after the event timeout', async () => {
    async function* hangs(): AsyncGenerator<unknown> {
      yield { type: 'thought', text: 'about to hang' };
      await new Promise(() => {}); // forever
    }
    const store = new MemoryRunStore();
    const id = start(store, hangs(), 30);
    const events = await collect(streamRun(id, store));
    expect(events).toHaveLength(2);
    const run = await getRun(id, store);
    expect(run?.status).toBe('error');
    expect(run?.error).toMatch(/no events/);
  });

  it('keeps the run alive when the store fails mid-run (degraded persistence)', async () => {
    class FailingStore extends MemoryRunStore {
      appended = 0;
      override async appendEvent(runId: string, event: StoredEvent): Promise<void> {
        this.appended += 1;
        if (this.appended > 1) throw new Error('disk on fire');
        return super.appendEvent(runId, event);
      }
    }
    const store = new FailingStore();
    const id = start(store, threeEvents());
    const events = await collect(streamRun(id, store));
    // Subscribers still get the full stream even though persistence died.
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const run = await getRun(id, store);
    expect(run?.status).toBe('done');
  });

  it('runCompletion settles once the run is finalized, and immediately for unknown ids', async () => {
    const store = new MemoryRunStore();
    const id = start(store, threeEvents());
    await runCompletion(id);
    const run = await getRun(id, store);
    expect(run?.status).toBe('done');
    expect(run?.verdict).toBe('pass');
    await expect(runCompletion('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });

  it('two concurrent subscribers both receive the full ordered stream', async () => {
    async function* slow() {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 5));
        yield { type: 'thought', text: `t${i}` };
      }
      yield { type: 'report', report: { assessment: { verdict: 'pass' } } };
    }
    const store = new MemoryRunStore();
    const id = start(store, slow());
    const [a, b] = await Promise.all([
      collect(streamRun(id, store)),
      (async () => {
        await new Promise((r) => setTimeout(r, 12)); // join mid-run
        return collect(streamRun(id, store));
      })(),
    ]);
    expect(a.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(b.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('runs owned by another instance (serverless)', () => {
  const stored = async (store: RunStore, createdAt: string) => {
    const id = crypto.randomUUID();
    await store.createRun({ id, kind: 'inspect', title: 't', vehicle, input: {}, createdAt });
    return id;
  };

  it('does not reconcile a young running run it does not hold when multi-instance', async () => {
    const store = new MemoryRunStore();
    const now = Date.parse('2026-08-15T12:00:00Z');
    const id = await stored(store, new Date(now - 60_000).toISOString());
    const record = (await store.getRun(id))!;
    const out = await reconcileInterrupted(record, store, { multiInstance: true, now: () => now });
    expect(out.status).toBe('running');
    expect((await store.getRun(id))?.status).toBe('running');
  });

  it('reconciles a running run older than the stale window even when multi-instance', async () => {
    const store = new MemoryRunStore();
    const now = Date.parse('2026-08-15T12:00:00Z');
    const id = await stored(store, new Date(now - 20 * 60_000).toISOString());
    const record = (await store.getRun(id))!;
    const out = await reconcileInterrupted(record, store, { multiInstance: true, now: () => now });
    expect(out.status).toBe('error');
  });

  it('streamRun tails the store for a run held elsewhere until it finishes', async () => {
    const store = new MemoryRunStore();
    const id = await stored(store, new Date().toISOString());
    await store.appendEvent(id, { seq: 1, at: 'a', event: { type: 'thought', text: 'one' } });
    const seen: number[] = [];
    const tail = (async () => {
      for await (const e of streamRun(id, store, 1, { pollMs: 5, deadlineMs: 5_000 })) {
        seen.push(e.seq);
      }
    })();
    await new Promise((r) => setTimeout(r, 20));
    await store.appendEvent(id, { seq: 2, at: 'b', event: { type: 'thought', text: 'two' } });
    await new Promise((r) => setTimeout(r, 20));
    await store.finishRun(id, { status: 'done', finishedAt: 'c' });
    await tail;
    expect(seen).toEqual([1, 2]);
  });

  it('streamRun on a run held elsewhere gives up at its deadline while the run still runs', async () => {
    const store = new MemoryRunStore();
    const id = await stored(store, new Date().toISOString());
    const seen: number[] = [];
    for await (const e of streamRun(id, store, 1, { pollMs: 5, deadlineMs: 30 })) seen.push(e.seq);
    expect(seen).toEqual([]);
    expect((await store.getRun(id))?.status).toBe('running');
  });
});

describe('orphaned runs (server restart)', () => {
  it('a stored running run with no live generator reconciles to error on read', async () => {
    const store = new MemoryRunStore();
    const id = crypto.randomUUID();
    await store.createRun({
      id,
      kind: 'inspect',
      title: 'ghost',
      vehicle,
      input: {},
      createdAt: new Date().toISOString(),
    });
    const run = await getRun(id, store);
    expect(run?.status).toBe('error');
    expect(run?.error).toMatch(/server restart/);
    // The reconciliation persisted, not just the returned view.
    expect((await store.getRun(id))?.status).toBe('error');
  });

  it('an actually-active run is never reconciled', async () => {
    const store = new MemoryRunStore();
    async function* slow() {
      await new Promise((r) => setTimeout(r, 30));
      yield { type: 'report', report: { assessment: { verdict: 'pass' } } };
    }
    const id = start(store, slow());
    const run = await getRun(id, store);
    expect(run?.status).toBe('running');
    await collect(streamRun(id, store));
  });
});
