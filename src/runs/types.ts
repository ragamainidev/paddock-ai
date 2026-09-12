// A run is one inspection or salvage assessment: a row of metadata, a typed
// event stream (the source of truth, replayable), and the finished report.
// Runs execute detached from any HTTP response — a client that refreshes
// mid-run re-attaches by id and loses nothing.

export type RunKind = 'inspect' | 'salvage';
export type RunStatus = 'running' | 'done' | 'error';

export type RunVehicle = { make: string; model: string; year: number };

export type RunSummary = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  title: string;
  vehicle: RunVehicle;
  verdict?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

export type RunRecord = RunSummary & {
  input: unknown;
  report?: unknown;
};

// Events are stored and streamed in an envelope: seq is assigned by the run
// manager (1-based, gapless per run), `at` is the server clock. The payload
// stays opaque here — inspect and salvage each define their own unions.
export type StoredEvent = { seq: number; at: string; event: unknown };

// Emitted first on every run so the UI can say, visibly, whether this run
// will survive a server restart (SPEC: degradation is visible, never silent).
export type RunMetaEvent = {
  type: 'run-meta';
  runId: string;
  kind: RunKind;
  persisted: boolean;
};

// What the manager needs to close out a run from its own event log.
export type RunOutcome = { report?: unknown; verdict?: string; error?: string };
export type FinalizeRun = (events: unknown[]) => RunOutcome;
