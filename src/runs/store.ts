import type { RunKind, RunRecord, RunStatus, RunSummary, RunVehicle, StoredEvent } from './types';

// Storage behind the run manager. Two implementations share this contract
// (and the same tests): Postgres for real persistence, memory as the visible
// degraded mode when Postgres is unreachable.

export type CreateRun = {
  id: string;
  kind: RunKind;
  title: string;
  vehicle: RunVehicle;
  input: unknown;
  createdAt: string;
};

export type FinishRun = {
  status: Extract<RunStatus, 'done' | 'error'>;
  report?: unknown;
  verdict?: string;
  error?: string;
  finishedAt: string;
};

export interface RunStore {
  readonly persistent: boolean;
  createRun(run: CreateRun): Promise<void>;
  appendEvent(runId: string, event: StoredEvent): Promise<void>;
  finishRun(runId: string, outcome: FinishRun): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  getEvents(runId: string, fromSeq?: number): Promise<StoredEvent[]>;
  listRuns(opts?: { kind?: RunKind; limit?: number }): Promise<RunSummary[]>;
}

type MemoryRun = { record: RunRecord; events: StoredEvent[] };

export class MemoryRunStore implements RunStore {
  readonly persistent = false;
  private runs = new Map<string, MemoryRun>();

  async createRun(run: CreateRun): Promise<void> {
    this.runs.set(run.id, {
      record: {
        id: run.id,
        kind: run.kind,
        status: 'running',
        title: run.title,
        vehicle: run.vehicle,
        input: run.input,
        createdAt: run.createdAt,
      },
      events: [],
    });
  }

  async appendEvent(runId: string, event: StoredEvent): Promise<void> {
    const run = this.mustGet(runId);
    run.events.push(event);
  }

  async finishRun(runId: string, outcome: FinishRun): Promise<void> {
    const run = this.mustGet(runId);
    run.record.status = outcome.status;
    run.record.report = outcome.report;
    run.record.verdict = outcome.verdict;
    run.record.error = outcome.error;
    run.record.finishedAt = outcome.finishedAt;
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const run = this.runs.get(id);
    return run ? structuredClone(run.record) : null;
  }

  async getEvents(runId: string, fromSeq = 1): Promise<StoredEvent[]> {
    const run = this.runs.get(runId);
    if (!run) return [];
    return run.events.filter((e) => e.seq >= fromSeq).map((e) => structuredClone(e));
  }

  async listRuns(opts?: { kind?: RunKind; limit?: number }): Promise<RunSummary[]> {
    const limit = opts?.limit ?? 20;
    return [...this.runs.values()]
      .map((r) => r.record)
      .filter((r) => (opts?.kind ? r.kind === opts.kind : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((r) => {
        const summary: RunSummary = {
          id: r.id,
          kind: r.kind,
          status: r.status,
          title: r.title,
          vehicle: r.vehicle,
          verdict: r.verdict,
          error: r.error,
          createdAt: r.createdAt,
          finishedAt: r.finishedAt,
        };
        return summary;
      });
  }

  private mustGet(runId: string): MemoryRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }
}
