import { pgAvailable } from '@/db/pg';
import { getDb } from '@/lib/db';
import { LibsqlRunStore } from './libsql-store';
import { PgRunStore } from './pg-store';
import { MemoryRunStore, type RunStore } from './store';

// Pick the run store for a request (SPEC 31): Postgres when reachable, else
// the libSQL vehicle database when it answers (Turso in production, so
// hosted runs survive across serverless instances with no extra infra),
// else the in-memory singleton. The choice is surfaced to the user via the
// run-meta event (persisted: false renders as one visible degradation line).

type Stores = { memory?: MemoryRunStore; pg?: PgRunStore; libsql?: LibsqlRunStore };
type Probe = { at: number; ok: boolean };
const globalStores = globalThis as typeof globalThis & {
  __paddockStores?: Stores;
  __paddockLibsqlProbe?: Probe;
};

function stores(): Stores {
  globalStores.__paddockStores ??= {};
  return globalStores.__paddockStores;
}

export function memoryRunStore(): MemoryRunStore {
  const s = stores();
  s.memory ??= new MemoryRunStore();
  return s.memory;
}

const PROBE_OK_TTL_MS = 60_000;
const PROBE_FAIL_TTL_MS = 5_000;

// Same cached-probe shape as pgAvailable: a missing file DB or a dead Turso
// endpoint degrades to memory instead of failing every run read.
export async function libsqlAvailable(): Promise<boolean> {
  const probe = globalStores.__paddockLibsqlProbe;
  const ttl = probe?.ok ? PROBE_OK_TTL_MS : PROBE_FAIL_TTL_MS;
  if (probe && Date.now() - probe.at < ttl) return probe.ok;
  let ok = false;
  try {
    await getDb().execute('select 1');
    ok = true;
  } catch {
    ok = false;
  }
  globalStores.__paddockLibsqlProbe = { at: Date.now(), ok };
  return ok;
}

export async function resolveRunStore(): Promise<RunStore> {
  const s = stores();
  if (await pgAvailable()) {
    s.pg ??= new PgRunStore();
    return s.pg;
  }
  if (await libsqlAvailable()) {
    s.libsql ??= new LibsqlRunStore(getDb());
    return s.libsql;
  }
  return memoryRunStore();
}
