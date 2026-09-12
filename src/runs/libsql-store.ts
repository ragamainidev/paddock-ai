/**
 * libSQL-backed run storage on the vehicle database (Turso in production,
 * the file DB in dev). Exists so hosted deployments have durable,
 * cross-instance runs with no extra infrastructure: Postgres is preferred
 * when reachable, this store when the vehicle DB is, memory last (SPEC 31).
 * Same contract and contract tests as the other stores; JSON columns are
 * text. The schema is created lazily and idempotently.
 */

import type { Client } from '@libsql/client';
import type { CreateRun, FinishRun, RunStore } from './store';
import type { RunKind, RunRecord, RunSummary, StoredEvent } from './types';

const SCHEMA = [
  `create table if not exists runs (
    id text primary key,
    kind text not null,
    status text not null,
    title text not null,
    vehicle text not null,
    input text not null,
    report text,
    verdict text,
    error text,
    created_at text not null,
    finished_at text
  )`,
  `create index if not exists runs_created_idx on runs (created_at desc)`,
  `create table if not exists run_events (
    run_id text not null,
    seq integer not null,
    at text not null,
    event text not null,
    primary key (run_id, seq)
  )`,
];

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

function json<T>(v: unknown): T | undefined {
  if (v === null || v === undefined) return undefined;
  return JSON.parse(str(v)) as T;
}

function toSummary(row: Row): RunSummary {
  return {
    id: str(row.id),
    kind: str(row.kind) as RunKind,
    status: str(row.status) as RunRecord['status'],
    title: str(row.title),
    vehicle: json<RunRecord['vehicle']>(row.vehicle) as RunRecord['vehicle'],
    verdict: row.verdict == null ? undefined : str(row.verdict),
    error: row.error == null ? undefined : str(row.error),
    createdAt: str(row.created_at),
    finishedAt: row.finished_at == null ? undefined : str(row.finished_at),
  };
}

export class LibsqlRunStore implements RunStore {
  readonly persistent = true;
  private ready: Promise<void> | null = null;

  constructor(private readonly db: Client) {}

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      for (const sql of SCHEMA) await this.db.execute(sql);
    })();
    return this.ready;
  }

  async createRun(run: CreateRun): Promise<void> {
    await this.ensureSchema();
    await this.db.execute({
      sql: `insert into runs (id, kind, status, title, vehicle, input, created_at)
            values (?, ?, 'running', ?, ?, ?, ?)`,
      args: [
        run.id,
        run.kind,
        run.title,
        JSON.stringify(run.vehicle),
        JSON.stringify(run.input ?? null),
        run.createdAt,
      ],
    });
  }

  async appendEvent(runId: string, event: StoredEvent): Promise<void> {
    await this.ensureSchema();
    await this.db.execute({
      sql: `insert into run_events (run_id, seq, at, event) values (?, ?, ?, ?)`,
      args: [runId, event.seq, event.at, JSON.stringify(event.event ?? null)],
    });
  }

  async finishRun(runId: string, outcome: FinishRun): Promise<void> {
    await this.ensureSchema();
    await this.db.execute({
      sql: `update runs set status = ?, report = ?, verdict = ?, error = ?, finished_at = ?
            where id = ?`,
      args: [
        outcome.status,
        outcome.report === undefined ? null : JSON.stringify(outcome.report),
        outcome.verdict ?? null,
        outcome.error ?? null,
        outcome.finishedAt,
        runId,
      ],
    });
  }

  async getRun(id: string): Promise<RunRecord | null> {
    await this.ensureSchema();
    const res = await this.db.execute({ sql: `select * from runs where id = ?`, args: [id] });
    const row = res.rows[0] as Row | undefined;
    if (!row) return null;
    return {
      ...toSummary(row),
      input: json(row.input),
      report: json(row.report),
    };
  }

  async getEvents(runId: string, fromSeq = 1): Promise<StoredEvent[]> {
    await this.ensureSchema();
    const res = await this.db.execute({
      sql: `select seq, at, event from run_events where run_id = ? and seq >= ? order by seq`,
      args: [runId, fromSeq],
    });
    return (res.rows as Row[]).map((r) => ({
      seq: Number(r.seq),
      at: str(r.at),
      event: json(r.event),
    }));
  }

  async listRuns(opts?: { kind?: RunKind; limit?: number }): Promise<RunSummary[]> {
    await this.ensureSchema();
    const limit = opts?.limit ?? 20;
    const cols = 'id, kind, status, title, vehicle, verdict, error, created_at, finished_at';
    const res = opts?.kind
      ? await this.db.execute({
          sql: `select ${cols} from runs where kind = ? order by created_at desc limit ?`,
          args: [opts.kind, limit],
        })
      : await this.db.execute({
          sql: `select ${cols} from runs order by created_at desc limit ?`,
          args: [limit],
        });
    return (res.rows as Row[]).map(toSummary);
  }
}
