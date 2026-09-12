import type { Client, Transaction } from '@libsql/client';
import type { Assessment } from '../assessments/types';
import { externalChange, pendingDeadline, runnable } from './policy';

export const queueSchema = [
  `CREATE TABLE IF NOT EXISTS assessment_dispatch (assessment_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, epoch INTEGER NOT NULL, revision INTEGER NOT NULL, generation INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT, session_id TEXT, last_error TEXT, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS assessment_dispatch_due ON assessment_dispatch(status,available_at,lease_until)`,
  `CREATE TABLE IF NOT EXISTS assessment_delivery (dispatch_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, assessment_id TEXT NOT NULL, epoch INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT, started_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS assessment_watches (assessment_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, policy TEXT NOT NULL, status TEXT NOT NULL, refreshes INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT, last_error TEXT, reserved_revision INTEGER, reserved_kinds TEXT)`,
  // When the desk last asked what happened to a lot whose sale is over. One row
  // per assessment is all the cadence needs: the prompt itself is an activity
  // event, and this says only when to ask again (SPEC 62).
  `CREATE TABLE IF NOT EXISTS assessment_outcome_prompts (assessment_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, prompted_at TEXT NOT NULL)`,
];
/**
 * How long a statement waits for another process's lock before it fails.
 * Unlike the journal mode it is a property of the connection, not of the file,
 * and the client opens a new connection around every `transaction()`, so it is
 * declared on each client and re-applied per transaction (docs/database.md §6.4).
 */
export const BUSY_TIMEOUT_MS = 5000;
const busy = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_BUSY';
/**
 * A write statement refused for a lock stays live on its connection, and
 * SQLite then answers every commit on that connection with this message.
 * Waiting cannot clear it; only a different connection can.
 */
const poisonedConnection = (error: unknown) =>
  busy(error) && error instanceof Error && error.message.includes('SQL statements in progress');
/**
 * How many times a statement refused for a lock is attempted. Each attempt now
 * waits out `BUSY_TIMEOUT_MS` rather than failing at once, so the count is the
 * worst-case stall: three attempts hold the process for up to 15 s of
 * contention on a local file (docs/database.md §6.4).
 */
const MAX_BUSY_ATTEMPTS = 3;
const backoff = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.min(100, 5 * 2 ** attempt)));

/**
 * The app, the worker and the agent share one local assessments file, so a
 * statement can meet another process's lock. Bounded backoff keeps that
 * contention from surfacing as a failed delivery or a lost runtime event. Any
 * refusal leaves its statement live on the connection that issued it, so the
 * connection is replaced every time — between attempts and on the way out, so
 * the next caller never inherits one that can no longer commit. A connection
 * already in that state is the one case waiting cannot help, so it skips
 * straight to the replacement.
 */
export async function withBusyRetry<T>(db: Client, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!busy(error)) throw error;
      await discardConnection(db);
      if (attempt >= MAX_BUSY_ATTEMPTS - 1) throw error;
      if (!poisonedConnection(error)) await backoff(attempt);
    }
  }
}

let writes: Promise<unknown> = Promise.resolve();
export async function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation, operation);
  writes = next.catch(() => undefined);
  return next;
}
// A remote libSQL server owns its own locking, has no local connection to
// settle, and would charge a round trip for the attempt.
const localFile = (db: Client) => db.protocol === 'file';
/** One connection's busy timeout. */
async function applyBusyTimeout(db: Client): Promise<void> {
  if (!localFile(db)) return;
  try {
    await db.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  } catch {
    return;
  }
}
/** Replaces the client's connection with one that can still commit. */
async function discardConnection(db: Client): Promise<void> {
  if (!localFile(db)) return;
  try {
    await db.reconnect();
  } catch {
    return;
  }
}
/**
 * The app, the worker and the agent open the same local assessments file. WAL
 * keeps a reader from blocking the writer, and a busy timeout waits for a lock
 * instead of failing on it. A remote libSQL server owns its own locking and
 * rejects the pragmas, which is why the failure is ignored.
 */
export async function prepareSharedDatabase(db: Client): Promise<void> {
  try {
    await db.execute('PRAGMA journal_mode = WAL');
  } catch {
    return;
  }
  await applyBusyTimeout(db);
}
export async function ensureQueueSchema(db: Client) {
  await prepareSharedDatabase(db);
  await serializeWrite(() => withBusyRetry(db, () => db.batch(queueSchema, 'write')));
}
/**
 * A transaction owns its connection, so a commit refused for a statement left
 * live on it can never be accepted there — only a lock is worth waiting out.
 */
async function commitTransaction(tx: Transaction): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.commit();
    } catch (error) {
      if (attempt >= MAX_BUSY_ATTEMPTS - 1 || !busy(error) || poisonedConnection(error))
        throw error;
      await backoff(attempt);
    }
  }
}
export async function writeTransaction<T>(
  db: Client,
  operation: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return serializeWrite(async () => {
    const tx = await openWriteTransaction(db);
    try {
      const result = await operation(tx);
      // SQLite keeps the transaction open when COMMIT reports a lock, so the
      // commit alone is retried rather than the work that produced it.
      await commitTransaction(tx);
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  });
}
export async function openWriteTransaction(db: Client): Promise<Transaction> {
  for (let attempt = 0; ; attempt++) {
    // The pragma lands on the connection `transaction()` is about to take, so
    // its BEGIN IMMEDIATE waits for the other process rather than being
    // refused. The client hands that connection to the transaction and opens a
    // fresh one for itself, which is why this repeats (docs/database.md §6.4).
    // The four clients that open this database declare `timeout` as well and
    // do not need it; this is what makes a client built elsewhere — a test, a
    // script, a future call site — wait too.
    await applyBusyTimeout(db);
    try {
      return await db.transaction('write');
    } catch (error) {
      if (!busy(error)) throw error;
      // A refused BEGIN stays live on this connection, which could then open a
      // transaction it is never allowed to commit. It is handed on to nobody:
      // not to the next attempt, and not to the next caller after the last.
      await discardConnection(db);
      if (attempt >= MAX_BUSY_ATTEMPTS - 1) throw error;
      await backoff(attempt);
    }
  }
}

/** Must run in the same write transaction as the assessment document. */
export async function synchronizeDispatch(tx: Transaction, a: Assessment, old?: Assessment) {
  const found = await tx.execute({
    sql: 'SELECT * FROM assessment_dispatch WHERE assessment_id=? AND owner_id=?',
    args: [a.id, a.ownerId],
  });
  const row = found.rows[0];
  if (a.status === 'stopped') {
    const ownerStopped = !('stopKind' in a) || a.stopKind === 'owner';
    if (row)
      await tx.execute({
        sql: 'UPDATE assessment_dispatch SET status=?,epoch=?,revision=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE assessment_id=? AND owner_id=?',
        args: [
          ownerStopped ? 'cancelled' : 'completed',
          a.epoch,
          a.revision,
          a.updatedAt,
          a.id,
          a.ownerId,
        ],
      });
    if (ownerStopped)
      await tx.execute({
        sql: "UPDATE assessment_watches SET status='disabled',lease_token=NULL,lease_until=NULL WHERE assessment_id=? AND owner_id=?",
        args: [a.id, a.ownerId],
      });
    return;
  }
  const changed = externalChange(a, old);
  if (runnable(a) && changed) {
    await tx.execute({
      sql: `INSERT INTO assessment_dispatch(assessment_id,owner_id,epoch,revision,generation,status,attempts,available_at,updated_at) VALUES(?,?,?,?,1,'pending',0,?,?) ON CONFLICT(assessment_id) DO UPDATE SET epoch=excluded.epoch,revision=excluded.revision,generation=assessment_dispatch.generation+1,status='pending',attempts=0,available_at=excluded.available_at,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=excluded.updated_at`,
      args: [a.id, a.ownerId, a.epoch, a.revision, a.updatedAt, a.updatedAt],
    });
  } else if (row) {
    await tx.execute({
      sql: 'UPDATE assessment_dispatch SET revision=?,updated_at=? WHERE assessment_id=? AND owner_id=? AND epoch=?',
      args: [a.revision, a.updatedAt, a.id, a.ownerId, a.epoch],
    });
  } else if (pendingDeadline(a)) {
    await tx.execute({
      sql: `INSERT INTO assessment_dispatch(assessment_id,owner_id,epoch,revision,generation,status,attempts,available_at,lease_until,updated_at) VALUES(?,?,?,?,1,'running',0,?,?,?)`,
      args: [
        a.id,
        a.ownerId,
        a.epoch,
        a.revision,
        pendingDeadline(a)!,
        pendingDeadline(a)!,
        a.updatedAt,
      ],
    });
  }
}
