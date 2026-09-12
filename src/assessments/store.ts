/** Owner-scoped durable snapshots with atomic revision checks and creation replay (SPEC 46). */
import type { Client } from '@libsql/client';
import { AssessmentError, type Assessment, type AssessmentStore } from './types';
import { normalizeBuyerProfile } from './buyer-profile';
import {
  prepareSharedDatabase,
  serializeWrite,
  withBusyRetry,
  writeTransaction,
  queueSchema,
  synchronizeDispatch,
} from '../assessment-queue/schema';

/**
 * A stored document is whatever its writer's `BuyerProfile` looked like, so a
 * record saved before the profile gained access, exit, discipline or the
 * equipment flags reads back with their defaults filled in (SPEC 50). The
 * record itself is not rewritten until its next save, and an assessment that
 * states no buyer keeps stating none.
 */
function decodeAssessment(document: string): Assessment {
  const assessment = JSON.parse(document) as Assessment;
  return assessment.buyer
    ? { ...assessment, buyer: normalizeBuyerProfile(assessment.buyer) }
    : assessment;
}

export class MemoryAssessmentStore implements AssessmentStore {
  private rows = new Map<string, Assessment>();
  private keys = new Map<string, { id: string; fingerprint?: string }>();
  async create(a: Assessment, key?: string, fingerprint?: string) {
    const k = JSON.stringify([a.ownerId, key]);
    const old = key ? this.keys.get(k) : undefined;
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new AssessmentError('conflict', 'Idempotency key was used with different input');
      return structuredClone(this.rows.get(old.id)!);
    }
    if (this.rows.has(a.id)) throw new AssessmentError('conflict', 'Assessment already exists');
    this.rows.set(a.id, structuredClone(a));
    if (key) this.keys.set(k, { id: a.id, fingerprint });
    return structuredClone(a);
  }
  async get(ownerId: string, id: string) {
    const a = this.rows.get(id);
    return a?.ownerId === ownerId ? structuredClone(a) : null;
  }
  async list(ownerId: string) {
    return [...this.rows.values()]
      .filter((a) => a.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((a) => structuredClone(a));
  }
  async save(a: Assessment, expectedRevision: number) {
    const old = this.rows.get(a.id);
    if (!old || old.ownerId !== a.ownerId)
      throw new AssessmentError('not_found', 'Assessment not found');
    if (old.revision !== expectedRevision || a.revision !== expectedRevision + 1)
      throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
    this.rows.set(a.id, structuredClone(a));
  }
}
export class LibsqlAssessmentStore implements AssessmentStore {
  private ready?: Promise<void>;
  constructor(private readonly db: Client) {}
  private ensure() {
    this.ready ??= serializeWrite(async () => {
      // This connection often creates the file, so it sets the journal mode
      // and its own busy timeout rather than leaving the batch below to meet
      // another process's lock without one (docs/database.md §6.4).
      await prepareSharedDatabase(this.db);
      return withBusyRetry(this.db, () =>
        this.db.batch(
          [
            `create table if not exists assessments (id text primary key, owner_id text not null, revision integer not null, updated_at text not null, document text not null, create_key text, create_fingerprint text)`,
            `create unique index if not exists assessments_create_key on assessments(owner_id,create_key)`,
            `create index if not exists assessments_owner_updated on assessments(owner_id,updated_at desc)`,
            ...queueSchema,
          ],
          'write',
        ),
      );
    })
      .then(() => undefined)
      .catch((error) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }
  async create(a: Assessment, key?: string, fingerprint?: string): Promise<Assessment> {
    await this.ensure();
    return writeTransaction(this.db, async (tx) => {
      const result = await tx.execute({
        sql: 'insert into assessments (id,owner_id,revision,updated_at,document,create_key,create_fingerprint) values (?,?,?,?,?,?,?) on conflict(owner_id,create_key) do nothing',
        args: [
          a.id,
          a.ownerId,
          a.revision,
          a.updatedAt,
          JSON.stringify(a),
          key ?? null,
          fingerprint ?? null,
        ],
      });
      if (result.rowsAffected) {
        await synchronizeDispatch(tx, a);
        return structuredClone(a);
      }
      const replay = await tx.execute({
        sql: 'select document,create_fingerprint from assessments where owner_id = ? and create_key = ?',
        args: [a.ownerId, key ?? null],
      });
      if (replay.rows[0]?.create_fingerprint !== fingerprint)
        throw new AssessmentError('conflict', 'Idempotency key was used with different input');
      return decodeAssessment(String(replay.rows[0].document));
    });
  }
  async get(ownerId: string, id: string): Promise<Assessment | null> {
    await this.ensure();
    const result = await withBusyRetry(this.db, () =>
      this.db.execute({
        sql: 'select document from assessments where id = ? and owner_id = ?',
        args: [id, ownerId],
      }),
    );
    return result.rows[0] ? decodeAssessment(String(result.rows[0].document)) : null;
  }
  async list(ownerId: string): Promise<Assessment[]> {
    await this.ensure();
    const result = await withBusyRetry(this.db, () =>
      this.db.execute({
        sql: 'select document from assessments where owner_id = ? order by updated_at desc limit 100',
        args: [ownerId],
      }),
    );
    return result.rows.map((row) => decodeAssessment(String(row.document)));
  }
  async save(a: Assessment, expectedRevision: number) {
    await this.ensure();
    if (a.revision !== expectedRevision + 1)
      throw new AssessmentError('conflict', 'A write must advance exactly one revision');
    await writeTransaction(this.db, async (tx) => {
      const before = await tx.execute({
        sql: 'select document from assessments where id=? and owner_id=? and revision=?',
        args: [a.id, a.ownerId, expectedRevision],
      });
      if (!before.rows[0])
        throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
      const old = decodeAssessment(String(before.rows[0].document));
      const result = await tx.execute({
        sql: 'update assessments set document = ?, revision = ?, updated_at = ? where id = ? and owner_id = ? and revision = ?',
        args: [JSON.stringify(a), a.revision, a.updatedAt, a.id, a.ownerId, expectedRevision],
      });
      if (!result.rowsAffected)
        throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
      await synchronizeDispatch(tx, a, old);
    });
  }
}
