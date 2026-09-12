import type { Pool } from 'pg';
import { getPool } from '@/db/pg';
import type { CreateRun, FinishRun, RunStore } from './store';
import type { RunKind, RunRecord, RunSummary, StoredEvent } from './types';

// Postgres-backed run storage (schema: db/migrations/0001_runs.sql). Thin on
// purpose: SQL in, typed rows out; the manager owns sequencing and fan-out.

type RunRow = {
  id: string;
  kind: RunKind;
  status: RunRecord['status'];
  title: string;
  vehicle: RunRecord['vehicle'];
  input: unknown;
  report: unknown;
  verdict: string | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
};

const SUMMARY_COLUMNS = 'id, kind, status, title, vehicle, verdict, error, created_at, finished_at';

function toSummary(row: Omit<RunRow, 'input' | 'report'>): RunSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    vehicle: row.vehicle,
    verdict: row.verdict ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
  };
}

export class PgRunStore implements RunStore {
  readonly persistent = true;
  constructor(private pool: Pool = getPool()) {}

  async createRun(run: CreateRun): Promise<void> {
    await this.pool.query(
      `insert into runs (id, kind, status, title, vehicle, input, created_at)
       values ($1, $2, 'running', $3, $4, $5, $6)`,
      [
        run.id,
        run.kind,
        run.title,
        JSON.stringify(run.vehicle),
        JSON.stringify(run.input),
        run.createdAt,
      ],
    );
  }

  async appendEvent(runId: string, event: StoredEvent): Promise<void> {
    await this.pool.query(
      `insert into run_events (run_id, seq, at, event) values ($1, $2, $3, $4)`,
      [runId, event.seq, event.at, JSON.stringify(event.event)],
    );
  }

  async finishRun(runId: string, outcome: FinishRun): Promise<void> {
    await this.pool.query(
      `update runs
       set status = $2, report = $3, verdict = $4, error = $5, finished_at = $6
       where id = $1`,
      [
        runId,
        outcome.status,
        outcome.report === undefined ? null : JSON.stringify(outcome.report),
        outcome.verdict ?? null,
        outcome.error ?? null,
        outcome.finishedAt,
      ],
    );
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const { rows } = await this.pool.query<RunRow>(`select * from runs where id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    return {
      ...toSummary(row),
      input: row.input,
      report: row.report ?? undefined,
    };
  }

  async getEvents(runId: string, fromSeq = 1): Promise<StoredEvent[]> {
    const { rows } = await this.pool.query<{ seq: number; at: Date; event: unknown }>(
      `select seq, at, event from run_events where run_id = $1 and seq >= $2 order by seq`,
      [runId, fromSeq],
    );
    return rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), event: r.event }));
  }

  async listRuns(opts?: { kind?: RunKind; limit?: number }): Promise<RunSummary[]> {
    const limit = opts?.limit ?? 20;
    const { rows } = opts?.kind
      ? await this.pool.query<Omit<RunRow, 'input' | 'report'>>(
          `select ${SUMMARY_COLUMNS} from runs where kind = $1 order by created_at desc limit $2`,
          [opts.kind, limit],
        )
      : await this.pool.query<Omit<RunRow, 'input' | 'report'>>(
          `select ${SUMMARY_COLUMNS} from runs order by created_at desc limit $1`,
          [limit],
        );
    return rows.map(toSummary);
  }
}
