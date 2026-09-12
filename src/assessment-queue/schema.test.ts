/** Cross-process locking on the shared local file: the busy timeout must ride every connection (docs/database.md §6.4). */
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createClient, type Client, type Transaction } from '@libsql/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  BUSY_TIMEOUT_MS,
  openWriteTransaction,
  prepareSharedDatabase,
  withBusyRetry,
  writeTransaction,
} from './schema';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function file() {
  const dir = mkdtempSync(join(tmpdir(), 'paddock-busy-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return `file:${join(dir, 'assessments.db')}`;
}
function open(url: string) {
  const db = createClient({ url });
  cleanups.unshift(() => db.close());
  return db;
}
const timeoutOf = async (tx: Transaction) =>
  Number((await tx.execute('PRAGMA busy_timeout')).rows[0].timeout);

it('carries the busy timeout into every transaction, including the connections the client rotates in', async () => {
  const db = open(file());
  await prepareSharedDatabase(db);
  await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  const seen: number[] = [];
  // The first transaction inherits the prepared connection; `transaction()`
  // then drops it, so every later one opens a connection of its own.
  for (let i = 0; i < 3; i++) seen.push(await writeTransaction(db, async (tx) => timeoutOf(tx)));
  expect(seen).toEqual([BUSY_TIMEOUT_MS, BUSY_TIMEOUT_MS, BUSY_TIMEOUT_MS]);
});

// The driver's statements are synchronous, so the lock has to be held off this
// thread for the wait to be observable — which is how the app meets it, from
// the agent process rather than from its own event loop.
const HOLDER = `
const { workerData, parentPort } = require('node:worker_threads');
const { createClient } = require('@libsql/client');
async function hold() {
  const db = createClient({ url: workerData.url });
  const tx = await db.transaction('write');
  await tx.execute("INSERT INTO t VALUES (2,'held')");
  parentPort.postMessage('held');
  await new Promise((resolve) => setTimeout(resolve, workerData.holdMs));
  await tx.commit();
  tx.close();
  db.close();
}
hold().catch((error) => parentPort.postMessage(error.message));
`;

// A worker loads the driver's native binding before it can take the lock, and
// the write under test then blocks this thread, so these two cases get room
// beyond the default per-test budget.
const CONTENDED = { timeout: 20_000 };

it(
  'waits out another process holding the write lock instead of failing the commit',
  CONTENDED,
  async () => {
    const url = file();
    const writer = open(url);
    await prepareSharedDatabase(writer);
    await writer.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    // Spend the prepared connection: the client opens a fresh one for the next
    // transaction, which is where a missing timeout is felt.
    await writeTransaction(writer, (tx) => tx.execute("INSERT INTO t VALUES (1,'first')"));
    const holder = new Worker(HOLDER, { eval: true, workerData: { url, holdMs: 150 } });
    cleanups.unshift(() => void holder.terminate());
    expect(await once(holder, 'message')).toEqual(['held']);
    const started = Date.now();
    await writeTransaction(writer, (tx) => tx.execute("INSERT INTO t VALUES (3,'waited')"));
    // Without the wait the write would return long before the holder releases,
    // which is the vacuous pass this guards against.
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    const rows = await writer.execute('SELECT id FROM t ORDER BY id');
    expect(rows.rows.map((row) => Number(row.id))).toEqual([1, 2, 3]);
  },
);

it('leaves no batch-refused connection behind, recovered or spent', CONTENDED, async () => {
  const url = file();
  const setup = open(url);
  await prepareSharedDatabase(setup);
  await setup.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  // No `timeout` and no pragma: these clients' statements are refused on the
  // spot, which is what leaves one live on the connection that issued it.
  const [direct, retried] = [open(url), open(url)];
  const holder = new Worker(HOLDER, { eval: true, workerData: { url, holdMs: 150 } });
  cleanups.unshift(() => void holder.terminate());
  expect(await once(holder, 'message')).toEqual(['held']);
  await expect(direct.batch(["INSERT INTO t VALUES (3,'refused')"], 'write')).rejects.toThrow(
    /database is locked/,
  );
  await expect(
    withBusyRetry(retried, () => retried.batch(["INSERT INTO t VALUES (4,'refused')"], 'write')),
  ).rejects.toThrow(/database is locked/);
  expect(await once(holder, 'exit')).toEqual([0]);
  // The lock is gone; the connection that met it alone still cannot commit.
  await expect(direct.batch(["INSERT INTO t VALUES (5,'poisoned')"], 'write')).rejects.toThrow(
    /SQL statements in progress/,
  );
  await withBusyRetry(direct, () => direct.batch(["INSERT INTO t VALUES (6,'rotated')"], 'write'));
  // The call that spent every attempt handed on no such connection.
  await retried.batch(["INSERT INTO t VALUES (7,'clean')"], 'write');
  const rows = await setup.execute('SELECT id FROM t ORDER BY id');
  expect(rows.rows.map((row) => Number(row.id))).toEqual([2, 6, 7]);
});

const refusal = (message: string) =>
  Object.assign(new Error(`SQLITE_BUSY: ${message}`), { code: 'SQLITE_BUSY' });
const stubClient = (transaction: Client['transaction'], reconnect: Client['reconnect']) =>
  ({ protocol: 'file', transaction, reconnect, execute: vi.fn() }) as unknown as Client;

it('replaces a connection whose write transaction was refused, the last attempt included', async () => {
  const opened = vi
    .fn()
    .mockRejectedValueOnce(refusal('database is locked'))
    .mockResolvedValue({} as Transaction);
  const reconnect = vi.fn();
  await openWriteTransaction(stubClient(opened, reconnect));
  expect([opened.mock.calls.length, reconnect.mock.calls.length]).toEqual([2, 1]);
  const refused = vi.fn().mockRejectedValue(refusal('database is locked'));
  const replaced = vi.fn();
  // Three attempts bound the stall at three busy timeouts, and the connection
  // the last one refused is replaced rather than left for the next caller.
  await expect(openWriteTransaction(stubClient(refused, replaced))).rejects.toThrow(
    'database is locked',
  );
  expect([refused.mock.calls.length, replaced.mock.calls.length]).toEqual([3, 3]);
});

it('does not retry a commit its own connection can never accept', async () => {
  const commit = vi
    .fn()
    .mockRejectedValue(refusal('cannot commit transaction - SQL statements in progress'));
  const rollback = vi.fn();
  const tx = { execute: vi.fn(), commit, rollback, close: vi.fn() } as unknown as Transaction;
  const db = stubClient(vi.fn().mockResolvedValue(tx), vi.fn());
  await expect(writeTransaction(db, async () => 'work')).rejects.toThrow(
    'SQL statements in progress',
  );
  expect([commit.mock.calls.length, rollback.mock.calls.length]).toEqual([1, 1]);
});
