import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRun } from '@/runs/manager';
import { MemoryRunStore, type RunStore } from '@/runs/store';
import type { StoredEvent } from '@/runs/types';
import { GET } from './route';

/**
 * The live tail (SPEC 30): one StoredEvent envelope per NDJSON line so a
 * client can resume from any cursor, blank-line heartbeats so an idle tail
 * survives proxies, and a client that disconnects costs the run nothing.
 */

const hoisted = vi.hoisted(() => ({
  resolveRunStore: vi.fn<() => Promise<RunStore>>(),
}));

vi.mock('@/runs/resolve-store', () => ({ resolveRunStore: hoisted.resolveRunStore }));

// A run id per group: a live run stays in the manager's memory for the rest
// of the file, so sharing one id would make these tests each other's setup.
const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IDLE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afb7';
const DETACHED_ID = '3fa85f64-5717-4562-b3fc-2c963f66afc8';

const get = (id: string, query = '') =>
  GET(new NextRequest(`https://paddock.test/api/runs/${id}/stream${query}`), {
    params: Promise.resolve({ id }),
  });

const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 12, 0, s)).toISOString();

async function seededStore(status: 'running' | 'done', events = 3): Promise<MemoryRunStore> {
  const store = new MemoryRunStore();
  await store.createRun({
    id: ID,
    kind: 'inspect',
    title: '2004 BMW M3',
    vehicle: { make: 'BMW', model: 'M3', year: 2004 },
    input: { seedId: 'e46-m3-original-owner' },
    createdAt: at(0),
  });
  for (let seq = 1; seq <= events; seq++) {
    await store.appendEvent(ID, { seq, at: at(seq), event: { type: 'thought', text: `n${seq}` } });
  }
  if (status === 'done') {
    await store.finishRun(ID, { status: 'done', verdict: 'pass', finishedAt: at(events + 1) });
  }
  return store;
}

const parseLines = (body: string): StoredEvent[] =>
  body
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StoredEvent);

describe('GET /api/runs/[id]/stream', () => {
  beforeEach(() => {
    hoisted.resolveRunStore.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('frames one envelope per line as NDJSON that never buffers', async () => {
    hoisted.resolveRunStore.mockResolvedValue(await seededStore('done'));
    const response = await get(ID);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.text();
    expect(body.endsWith('\n')).toBe(true);
    const events = parseLines(body);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['at', 'event', 'seq']);
      expect(Date.parse(event.at)).not.toBeNaN();
    }
    expect(events[0].event).toEqual({ type: 'thought', text: 'n1' });
  });

  it('?from= resumes at a cursor instead of replaying the whole run', async () => {
    hoisted.resolveRunStore.mockResolvedValue(await seededStore('done'));
    const events = parseLines(await (await get(ID, '?from=3')).text());
    expect(events.map((e) => e.seq)).toEqual([3]);
  });

  it('a cursor that is not a positive integer replays from the start', async () => {
    for (const query of ['?from=0', '?from=-2', '?from=abc', '?from=1.5', '?from=']) {
      hoisted.resolveRunStore.mockResolvedValue(await seededStore('done'));
      const events = parseLines(await (await get(ID, query)).text());
      expect(
        events.map((e) => e.seq),
        query,
      ).toEqual([1, 2, 3]);
    }
  });

  it('an id that is not a uuid is a 400 before storage is touched', async () => {
    const response = await get('not-a-uuid');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'malformed run id' });
    expect(hoisted.resolveRunStore).not.toHaveBeenCalled();
  });

  it('an unknown run is a 404', async () => {
    hoisted.resolveRunStore.mockResolvedValue(new MemoryRunStore());
    const response = await get(ID);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'run not found' });
  });

  it('a storage failure while attaching is a 503, not a broken stream', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hoisted.resolveRunStore.mockRejectedValue(new Error('ECONNREFUSED 5433'));
    const response = await get(ID);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'run storage is unavailable right now',
    });
    expect(error).toHaveBeenCalled();
  });
});

describe('an idle tail', () => {
  beforeEach(() => {
    hoisted.resolveRunStore.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a blank line rather than letting a proxy cut it', async () => {
    // A live run that is thinking: nothing to say for a while, so the
    // heartbeat is the only thing on the wire.
    const store = new MemoryRunStore();
    hoisted.resolveRunStore.mockResolvedValue(store);
    startRun({
      id: IDLE_ID,
      kind: 'inspect',
      title: '2004 BMW M3',
      vehicle: { make: 'BMW', model: 'M3', year: 2004 },
      input: { seedId: 'e46-m3-original-owner' },
      gen: (async function* () {
        await new Promise<void>(() => {});
        yield { type: 'thought', text: 'unreachable' };
      })(),
      store,
      finalize: () => ({ verdict: 'pass' }),
    });
    await vi.advanceTimersByTimeAsync(0);

    const response = await get(IDLE_ID);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const meta = parseLines(new TextDecoder().decode((await reader.read()).value));
    expect(meta[0].event).toMatchObject({ type: 'run-meta' });

    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    const chunk = await pending;
    expect(new TextDecoder().decode(chunk.value)).toBe('\n');
    await reader.cancel();
  });
});

describe('a client that disconnects', () => {
  beforeEach(() => {
    hoisted.resolveRunStore.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves the detached run running and persisting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new MemoryRunStore();
    hoisted.resolveRunStore.mockResolvedValue(store);

    // A generator this test drives, so the run is genuinely live while the
    // client reads and genuinely continues after it leaves.
    let release: (() => void) | null = null;
    const queue: unknown[] = [];
    let ended = false;
    const wake = () => {
      const resume = release;
      release = null;
      resume?.();
    };
    const push = (event: unknown) => {
      queue.push(event);
      wake();
    };
    async function* gen(): AsyncGenerator<unknown> {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    }

    push({ type: 'thought', text: 'first' });
    startRun({
      id: DETACHED_ID,
      kind: 'inspect',
      title: '2004 BMW M3',
      vehicle: { make: 'BMW', model: 'M3', year: 2004 },
      input: { seedId: 'e46-m3-original-owner' },
      gen: gen(),
      store,
      finalize: () => ({ verdict: 'pass' }),
    });

    const reader = ((await get(DETACHED_ID)).body as ReadableStream<Uint8Array>).getReader();
    const first = parseLines(new TextDecoder().decode((await reader.read()).value));
    expect(first[0].event).toMatchObject({ type: 'run-meta' });

    await reader.cancel();

    // The run keeps going without its reader and finishes on its own terms.
    push({ type: 'thought', text: 'after the client left' });
    ended = true;
    wake();
    await vi.waitFor(async () => {
      const record = await store.getRun(DETACHED_ID);
      expect(record?.status).toBe('done');
    });

    const events = await store.getEvents(DETACHED_ID);
    expect(events.map((e) => (e.event as { type: string }).type)).toEqual([
      'run-meta',
      'thought',
      'thought',
    ]);
    expect(error).not.toHaveBeenCalled();

    // A second client attaching after the first left replays everything.
    const replay = parseLines(await (await get(DETACHED_ID)).text());
    expect(replay.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});
