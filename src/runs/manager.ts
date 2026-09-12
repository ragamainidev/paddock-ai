import { failureReason } from '@/lib/failure';
import type { RunStore } from './store';
import type {
  FinalizeRun,
  RunKind,
  RunMetaEvent,
  RunRecord,
  RunVehicle,
  StoredEvent,
} from './types';

/**
 * The run manager drives an inspection/salvage generator detached from any
 * HTTP response and fans events out to any number of subscribers. Active
 * runs are held in memory (hot-reload safe via globalThis) and mirrored to
 * the store best-effort: a database hiccup degrades persistence, never the
 * run. A client that disconnects or refreshes re-attaches by id — replay
 * from memory while the run is active, from the store after.
 */

type ActiveRun = {
  record: RunRecord;
  events: StoredEvent[];
  listeners: Set<(event: StoredEvent | null) => void>; // null = run finished
  done: boolean;
  persistFailed: boolean;
  // Settles when drive() has finalized the run. Route handlers hand this to
  // `after()` so a serverless instance stays alive for the detached work.
  completion: Promise<void>;
};

type ManagerState = { active: Map<string, ActiveRun> };

const store = globalThis as typeof globalThis & { __paddockRuns?: ManagerState };

function state(): ManagerState {
  store.__paddockRuns ??= { active: new Map() };
  return store.__paddockRuns;
}

// A run that emits nothing for this long is declared dead. Web research can
// legitimately think for a while, but the route's maxDuration is 300 s: a
// timeout above that never fires, so the run dies unnamed at the function
// wall instead of saying why (docs/operations.md §8).
export const EVENT_TIMEOUT_MS = 240_000;

export type StartRunOptions = {
  kind: RunKind;
  title: string;
  vehicle: RunVehicle;
  input: unknown;
  gen: AsyncGenerator<unknown>;
  store: RunStore;
  finalize: FinalizeRun;
  now?: () => Date;
  id?: string;
  eventTimeoutMs?: number;
};

export function startRun(opts: StartRunOptions): string {
  const id = opts.id ?? crypto.randomUUID();
  const now = opts.now ?? (() => new Date());
  const createdAt = now().toISOString();

  const active: ActiveRun = {
    record: {
      id,
      kind: opts.kind,
      status: 'running',
      title: opts.title,
      vehicle: opts.vehicle,
      input: opts.input,
      createdAt,
    },
    events: [],
    listeners: new Set(),
    done: false,
    persistFailed: false,
    completion: Promise.resolve(),
  };
  state().active.set(id, active);

  active.completion = drive(id, active, opts, now);
  return id;
}

// Resolves when the run has finalized (or immediately for a run that is
// not in memory). Never rejects: drive() settles every run itself.
export function runCompletion(id: string): Promise<void> {
  return state().active.get(id)?.completion ?? Promise.resolve();
}

async function drive(
  id: string,
  active: ActiveRun,
  opts: StartRunOptions,
  now: () => Date,
): Promise<void> {
  const persist = async (fn: () => Promise<void>) => {
    if (active.persistFailed) return;
    try {
      await fn();
    } catch (err) {
      active.persistFailed = true;
      console.error(`run ${id}: persistence degraded:`, err);
    }
  };

  await persist(() =>
    opts.store.createRun({
      id,
      kind: opts.kind,
      title: opts.title,
      vehicle: opts.vehicle,
      input: opts.input,
      createdAt: active.record.createdAt,
    }),
  );

  let seq = 0;
  const emit = async (event: unknown) => {
    const stored: StoredEvent = { seq: ++seq, at: now().toISOString(), event };
    active.events.push(stored);
    for (const listener of active.listeners) listener(stored);
    await persist(() => opts.store.appendEvent(id, stored));
  };

  // First event on every run: can this run survive a restart? The UI turns
  // persisted:false into one visible meta line.
  const meta: RunMetaEvent = {
    type: 'run-meta',
    runId: id,
    kind: opts.kind,
    persisted: opts.store.persistent && !active.persistFailed,
  };
  await emit(meta);

  let error: string | undefined;
  const timeoutMs = opts.eventTimeoutMs ?? EVENT_TIMEOUT_MS;
  try {
    for (;;) {
      const next = await nextWithTimeout(opts.gen, timeoutMs);
      if (next.timedOut) {
        error = `run produced no events for ${Math.round(timeoutMs / 60000)} minutes; marked dead`;
        break;
      }
      if (next.result.done) break;
      await emit(next.result.value);
    }
  } catch (err) {
    console.error(`run ${id}: run failed:`, err);
    error = failureReason(err);
  }

  // Whatever finalize or the store does, the run MUST settle: done flips and
  // every subscriber's stream closes. A crash here would otherwise leave
  // clients attached to a run that never ends.
  try {
    const outcome = opts.finalize(active.events.map((e) => e.event));
    const finalError = error ?? outcome.error;
    const finishedAt = now().toISOString();
    active.record.status = finalError ? 'error' : 'done';
    active.record.report = outcome.report;
    active.record.verdict = outcome.verdict;
    active.record.error = finalError;
    active.record.finishedAt = finishedAt;

    await persist(() =>
      opts.store.finishRun(id, {
        status: finalError ? 'error' : 'done',
        report: outcome.report,
        verdict: outcome.verdict,
        error: finalError,
        finishedAt,
      }),
    );
  } catch (err) {
    console.error(`run ${id}: finalize failed:`, err);
    active.record.status = 'error';
    active.record.error = error ?? `finalize failed: ${failureReason(err)}`;
    active.record.finishedAt = now().toISOString();
    await persist(() =>
      opts.store.finishRun(id, {
        status: 'error',
        error: active.record.error,
        finishedAt: active.record.finishedAt!,
      }),
    );
  } finally {
    active.done = true;
    for (const listener of active.listeners) listener(null);
    active.listeners.clear();
  }

  // Keep finished runs in memory briefly so a subscriber that raced the
  // finish still replays instantly; the store is authoritative afterwards.
  const RETAIN_MS = active.persistFailed || !opts.store.persistent ? 60 * 60 * 1000 : 30 * 1000;
  setTimeout(() => state().active.delete(id), RETAIN_MS).unref?.();
}

async function nextWithTimeout(
  gen: AsyncGenerator<unknown>,
  ms: number,
): Promise<{ timedOut: true } | { timedOut: false; result: IteratorResult<unknown> }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      gen.next().then((result) => ({ timedOut: false as const, result })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Replay everything from fromSeq, then tail live events until the run ends.
// Falls back to the store when the run is no longer in memory.
// How a stream follows a run this process does not hold: poll the store
// until the run leaves 'running' or the deadline passes (the route's
// maxDuration minus margin); the client re-attaches from its cursor.
const TAIL_POLL_MS = 1_000;
export const TAIL_DEADLINE_MS = 240_000;

export async function* streamRun(
  id: string,
  runStore: RunStore,
  fromSeq = 1,
  tail: { pollMs?: number; deadlineMs?: number } = {},
): AsyncGenerator<StoredEvent> {
  const active = state().active.get(id);
  if (!active) {
    const pollMs = tail.pollMs ?? TAIL_POLL_MS;
    const deadline = Date.now() + (tail.deadlineMs ?? TAIL_DEADLINE_MS);
    let cursor = fromSeq;
    for (;;) {
      for (const event of await runStore.getEvents(id, cursor)) {
        yield event;
        cursor = event.seq + 1;
      }
      const record = await runStore.getRun(id);
      if (!record || record.status !== 'running' || Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const buffer: (StoredEvent | null)[] = [];
  let wake: (() => void) | null = null;
  const listener = (event: StoredEvent | null) => {
    buffer.push(event);
    wake?.();
    wake = null;
  };
  active.listeners.add(listener);
  try {
    // Snapshot AFTER subscribing so nothing lands between replay and tail.
    let cursor = fromSeq;
    for (const event of active.events) {
      if (event.seq >= cursor) {
        yield event;
        cursor = event.seq + 1;
      }
    }
    if (active.done) return;
    for (;;) {
      if (buffer.length > 0) {
        const next = buffer.shift();
        if (next === null || next === undefined) return;
        if (next.seq >= cursor) {
          yield next;
          cursor = next.seq + 1;
        }
        continue;
      }
      if (active.done) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    active.listeners.delete(listener);
  }
}

export async function getRun(id: string, runStore: RunStore): Promise<RunRecord | null> {
  const active = state().active.get(id);
  if (active) return structuredClone(active.record);
  const record = await runStore.getRun(id);
  if (!record) return null;
  return reconcileInterrupted(record, runStore);
}

// A run marked running in the store but absent from this process's memory
// either died with a server restart or is alive on another serverless
// instance. Single-process deployments reconcile on sight; multi-instance
// ones (VERCEL_ENV set) only once the run is older than any run could
// legitimately be, so list views never call a live run dead.
const STALE_RUNNING_MS = 15 * 60 * 1000;

export async function reconcileInterrupted<
  T extends { id: string; status: string; createdAt?: string },
>(
  record: T,
  runStore: RunStore,
  opts: { multiInstance?: boolean; now?: () => number } = {},
): Promise<T & { status: 'error'; error: string; finishedAt: string }> {
  type Out = T & { status: 'error'; error: string; finishedAt: string };
  if (record.status !== 'running' || state().active.has(record.id)) return record as Out;
  const multiInstance = opts.multiInstance ?? Boolean(process.env.VERCEL_ENV);
  if (multiInstance) {
    const now = (opts.now ?? Date.now)();
    const created = record.createdAt ? Date.parse(record.createdAt) : NaN;
    if (Number.isNaN(created) || now - created < STALE_RUNNING_MS) return record as Out;
  }
  const error = 'interrupted before finishing (server restart or function timeout)';
  const finishedAt = new Date((opts.now ?? Date.now)()).toISOString();
  try {
    await runStore.finishRun(record.id, { status: 'error', error, finishedAt });
  } catch {
    // Reconciliation is best-effort; the corrected view still returns.
  }
  return { ...record, status: 'error', error, finishedAt };
}

export function isRunActive(id: string): boolean {
  const active = state().active.get(id);
  return Boolean(active && !active.done);
}

// The id of a live run matching a predicate over its record — start routes
// use this to attach a second request to the run already in flight instead
// of double-billing the same lot.
export function findActiveRun(
  predicate: (record: { kind: string; input: unknown }) => boolean,
): string | undefined {
  for (const [id, active] of state().active) {
    if (!active.done && predicate(active.record)) return id;
  }
  return undefined;
}
