import { Pool } from 'pg';

// Server-side Postgres access (SPEC 17: no NEXT_PUBLIC_ secrets). The pool is
// lazy and survives Next.js dev hot reloads via globalThis. Postgres being
// down is a supported state: `pgAvailable` is a fast cached probe, and
// callers fall back to in-memory behavior with a visible degradation note —
// never a 500.

// Distinct from DATABASE_URL, which this project already uses for the
// libsql/Turso vehicle database. The 'panelgap' credentials predate the
// rename to paddock and stay put — changing them would orphan the existing
// docker volume and the run history inside it.
const DEFAULT_URL = 'postgres://panelgap:panelgap@localhost:5433/panelgap';

export function postgresUrl(): string {
  return process.env.POSTGRES_URL || DEFAULT_URL;
}

type PgGlobal = {
  pool?: Pool;
  probe?: { at: number; ok: boolean };
};

const store = globalThis as typeof globalThis & { __paddockPg?: PgGlobal };

function state(): PgGlobal {
  store.__paddockPg ??= {};
  return store.__paddockPg;
}

export function getPool(): Pool {
  const s = state();
  if (!s.pool) {
    s.pool = new Pool({
      connectionString: postgresUrl(),
      max: 10,
      connectionTimeoutMillis: 1500,
    });
    // Idle clients can error (e.g. the container restarts); without a
    // listener that would crash the process.
    s.pool.on('error', () => {
      s.probe = { at: Date.now(), ok: false };
    });
  }
  return s.pool;
}

const PROBE_OK_TTL_MS = 60_000;
const PROBE_FAIL_TTL_MS = 5_000;

// Is Postgres reachable right now? Cached so hot paths don't pay a probe per
// request; failures re-probe sooner than successes so recovery is noticed.
export async function pgAvailable(): Promise<boolean> {
  const s = state();
  const ttl = s.probe?.ok ? PROBE_OK_TTL_MS : PROBE_FAIL_TTL_MS;
  if (s.probe && Date.now() - s.probe.at < ttl) return s.probe.ok;
  try {
    await getPool().query('select 1');
    s.probe = { at: Date.now(), ok: true };
  } catch {
    s.probe = { at: Date.now(), ok: false };
  }
  return s.probe.ok;
}
