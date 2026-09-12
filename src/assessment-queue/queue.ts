import { randomUUID } from 'node:crypto';
import { createClient, type Client, type InStatement, type Transaction } from '@libsql/client';
import { resolveAssessmentsUrl } from '../assessments/database-url';
import { OUTCOME_PROMPT_INTERVAL_MS, saleIsOver } from '../assessments/outcome-prompt';
import { AssessmentError, type Assessment } from '../assessments/types';
import {
  BUSY_TIMEOUT_MS,
  ensureQueueSchema,
  withBusyRetry,
  writeTransaction,
  synchronizeDispatch,
} from './schema';
import { pendingDeadline, runnable, watchKindsDue, type WatchPolicy } from './policy';

const MAX_ATTEMPTS = 5;
export const RUN_LEASE_MS = 300_000;
/** How long a claimed intent stays leased while its delivery is attempted. */
const CLAIM_LEASE_MS = 30_000;
const backoff = (attempts: number) => Math.min(300_000, 1000 * 2 ** Math.min(attempts, 8));
export type DispatchIntent = {
  assessmentId: string;
  ownerId: string;
  epoch: number;
  revision: number;
  generation: number;
  status: string;
  attempts: number;
  availableAt: string;
  leaseToken?: string;
  leaseUntil?: string;
  sessionId?: string;
  lastError?: string;
  dispatchId: string;
};
function intent(row: Record<string, unknown>): DispatchIntent {
  const a = {
    assessmentId: String(row.assessment_id),
    ownerId: String(row.owner_id),
    epoch: Number(row.epoch),
    revision: Number(row.revision),
    generation: Number(row.generation),
    status: String(row.status),
    attempts: Number(row.attempts),
    availableAt: String(row.available_at),
    leaseToken: row.lease_token ? String(row.lease_token) : undefined,
    leaseUntil: row.lease_until ? String(row.lease_until) : undefined,
    sessionId: row.session_id ? String(row.session_id) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
  };
  return { ...a, dispatchId: `${a.assessmentId}:${a.epoch}:${a.generation}` };
}
export type WatchRecord = {
  policy: WatchPolicy;
  status: string;
  refreshes: number;
  nextAt: string;
  lastError?: string;
};
export type WatchClaim = WatchRecord & {
  assessmentId: string;
  ownerId: string;
  leaseToken: string;
  actionKinds: WatchPolicy['actionKinds'];
  expectedRevision: number;
};

export type OutcomePromptDue = { assessmentId: string; ownerId: string };
/**
 * How many candidate rows one selection reads, across all owners. The read is
 * bounded, not exhaustive: older rows beyond this window may remain unasked
 * until their assessment is updated. Prompting alone does not move them into
 * the window (docs/initiatives/2026-09-06-bidding-desk.md §8).
 */
const OUTCOME_PROMPT_SCAN = 500;
/**
 * The saved record's half of the rule: the sale is over by `saleIsOver`, the
 * decision reached something worth measuring — a ceiling to compare a hammer
 * with, or a walk the market can contradict — and nobody has recorded an
 * outcome yet.
 */
function askForOutcome(a: Assessment, now: Date): boolean {
  return (
    saleIsOver(a.lot.saleDate, now) &&
    (a.decision.readiness === 'ready' || a.decision.verdict === 'walk') &&
    a.outcomes.length === 0
  );
}

export class LibsqlAssessmentQueue {
  private ready?: Promise<void>;
  constructor(
    private readonly db: Client,
    private readonly clock = () => new Date(),
  ) {}
  private async ensure() {
    this.ready ??= ensureQueueSchema(this.db).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
  }
  private at() {
    return this.clock().toISOString();
  }
  private async execute(statement: InStatement) {
    return withBusyRetry(this.db, () => this.db.execute(statement));
  }
  private async transaction<T>(fn: (tx: Transaction) => Promise<T>) {
    await this.ensure();
    return writeTransaction(this.db, fn);
  }
  private async owned(
    tx: Pick<Transaction, 'execute'>,
    ownerId: string,
    id: string,
  ): Promise<Assessment> {
    const rows = await tx.execute({
      sql: 'SELECT document FROM assessments WHERE id=? AND owner_id=?',
      args: [id, ownerId],
    });
    if (!rows.rows[0]) throw new AssessmentError('not_found', 'Assessment not found');
    return JSON.parse(String(rows.rows[0].document)) as Assessment;
  }
  async status(ownerId: string, id: string): Promise<DispatchIntent | null> {
    await this.ensure();
    await this.owned(this.db, ownerId, id);
    const rows = await this.execute({
      sql: 'SELECT * FROM assessment_dispatch WHERE assessment_id=? AND owner_id=?',
      args: [id, ownerId],
    });
    return rows.rows[0] ? intent(rows.rows[0]) : null;
  }
  async requestRun(
    ownerId: string,
    id: string,
    expectedRevision?: number,
  ): Promise<DispatchIntent | null> {
    await this.transaction(async (tx) => {
      const a = await this.owned(tx, ownerId, id);
      if (expectedRevision !== undefined && a.revision !== expectedRevision)
        throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
      const rows = await tx.execute({
        sql: 'SELECT * FROM assessment_dispatch WHERE assessment_id=? AND owner_id=?',
        args: [id, ownerId],
      });
      const current = rows.rows[0];
      if (
        !runnable(a) ||
        (current &&
          Number(current.epoch) === a.epoch &&
          ['pending', 'leased', 'running'].includes(String(current.status)))
      )
        return;
      await synchronizeDispatch(tx, { ...a, updatedAt: this.at() });
    });
    return this.status(ownerId, id);
  }
  /**
   * Lease the next deliverable intent. A scope narrows the lease to one owned
   * assessment, which is how a run route starts its own assessment inline
   * without leasing anyone else's saved work (SPEC 57).
   */
  async claim(
    leaseMs = CLAIM_LEASE_MS,
    scope?: { ownerId: string; assessmentId: string },
  ): Promise<DispatchIntent | null> {
    return this.transaction(async (tx) => {
      const at = this.at();
      const only = scope ? ' AND assessment_id=? AND owner_id=?' : '';
      const owned = scope ? [scope.assessmentId, scope.ownerId] : [];
      await tx.execute({
        sql: `UPDATE assessment_dispatch SET status='blocked',last_error='Dispatch retry budget exhausted',lease_token=NULL WHERE attempts>=? AND (status='pending' OR ((status='leased' OR status='running') AND lease_until<=?))${only}`,
        args: [MAX_ATTEMPTS, at, ...owned],
      });
      const rows = await tx.execute({
        sql: `SELECT * FROM assessment_dispatch WHERE attempts<? AND ((status='pending' AND available_at<=?) OR (status IN ('leased','running') AND lease_until<=?))${only} ORDER BY available_at,assessment_id LIMIT 1`,
        args: [MAX_ATTEMPTS, at, at, ...owned],
      });
      const row = rows.rows[0];
      if (!row) return null;
      const a = await this.owned(tx, String(row.owner_id), String(row.assessment_id));
      if (a.epoch !== Number(row.epoch) || (!runnable(a) && !pendingDeadline(a))) {
        await tx.execute({
          sql: "UPDATE assessment_dispatch SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE assessment_id=?",
          args: [a.id],
        });
        return null;
      }
      // A receipt was accepted but no terminal hook arrived. A new generation
      // reconciles the durable session; an expired transport lease retries the
      // same delivery ID instead, so receipt loss cannot enqueue a second turn.
      const generation = Number(row.generation) + (row.status === 'running' ? 1 : 0);
      const token = randomUUID();
      await tx.execute({
        sql: "UPDATE assessment_dispatch SET status='leased',generation=?,revision=?,attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE assessment_id=?",
        args: [
          generation,
          a.revision,
          token,
          new Date(Date.parse(at) + leaseMs).toISOString(),
          at,
          a.id,
        ],
      });
      return intent({
        ...row,
        status: 'leased',
        generation,
        revision: a.revision,
        attempts: Number(row.attempts) + 1,
        lease_token: token,
        lease_until: new Date(Date.parse(at) + leaseMs).toISOString(),
      });
    });
  }
  async current(claim: DispatchIntent): Promise<boolean> {
    const value = await this.status(claim.ownerId, claim.assessmentId);
    return (
      value?.epoch === claim.epoch &&
      value.generation === claim.generation &&
      value.leaseToken === claim.leaseToken &&
      value.status === 'leased'
    );
  }
  async running(claim: DispatchIntent, sessionId: string) {
    await this.ensure();
    const at = this.at();
    await this.execute({
      sql: "UPDATE assessment_dispatch SET status='running',session_id=?,lease_until=?,updated_at=?,last_error=NULL WHERE assessment_id=? AND owner_id=? AND epoch=? AND generation=? AND lease_token=? AND status='leased'",
      args: [
        sessionId,
        new Date(Date.parse(at) + RUN_LEASE_MS).toISOString(),
        at,
        claim.assessmentId,
        claim.ownerId,
        claim.epoch,
        claim.generation,
        claim.leaseToken!,
      ],
    });
  }
  async retry(claim: DispatchIntent, error = 'Research runtime is unavailable') {
    await this.ensure();
    const at = this.at();
    await this.execute({
      sql: "UPDATE assessment_dispatch SET status=?,available_at=?,lease_token=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE assessment_id=? AND owner_id=? AND epoch=? AND generation=? AND lease_token=? AND status='leased'",
      args: [
        claim.attempts >= MAX_ATTEMPTS ? 'blocked' : 'pending',
        new Date(Date.parse(at) + backoff(claim.attempts)).toISOString(),
        error.slice(0, 400),
        at,
        claim.assessmentId,
        claim.ownerId,
        claim.epoch,
        claim.generation,
        claim.leaseToken!,
      ],
    });
  }
  async heartbeat(ownerId: string, id: string, epoch: number, dispatchId?: string) {
    await this.ensure();
    if (!dispatchId) return;
    await this.execute({
      sql: "UPDATE assessment_dispatch SET lease_until=? WHERE assessment_id=? AND owner_id=? AND epoch=? AND assessment_id || ':' || epoch || ':' || generation=? AND status IN ('leased','running')",
      args: [
        new Date(this.clock().getTime() + RUN_LEASE_MS).toISOString(),
        id,
        ownerId,
        epoch,
        dispatchId,
      ],
    });
  }
  async settled(
    ownerId: string,
    id: string,
    epoch: number,
    dispatchId: string | undefined,
    failed: boolean,
  ) {
    if (!dispatchId) return;
    await this.transaction(async (tx) => {
      const a = await this.owned(tx, ownerId, id);
      const rows = await tx.execute({
        sql: 'SELECT * FROM assessment_dispatch WHERE assessment_id=? AND owner_id=?',
        args: [id, ownerId],
      });
      const row = rows.rows[0];
      if (
        !row ||
        a.epoch !== epoch ||
        intent(row).dispatchId !== dispatchId ||
        !['leased', 'running'].includes(String(row.status))
      )
        return;
      const deadline = pendingDeadline(a);
      const continues = runnable(a) || Boolean(deadline);
      const status = continues
        ? Number(row.attempts) >= MAX_ATTEMPTS
          ? 'blocked'
          : deadline
            ? 'running'
            : 'pending'
        : 'completed';
      const next =
        deadline ?? new Date(this.clock().getTime() + backoff(Number(row.attempts))).toISOString();
      await tx.execute({
        sql: 'UPDATE assessment_dispatch SET status=?,generation=generation+?,available_at=?,lease_token=NULL,lease_until=?,last_error=?,updated_at=? WHERE assessment_id=? AND owner_id=?',
        args: [
          status,
          continues && !deadline ? 1 : 0,
          next,
          deadline ?? null,
          continues
            ? failed
              ? 'Coordinator failed; saved work will be reconciled'
              : 'Coordinator ended with useful work remaining'
            : null,
          this.at(),
          id,
          ownerId,
        ],
      });
    });
  }
  async beginDelivery(ownerId: string, id: string, epoch: number, dispatchId: string) {
    return this.transaction(async (tx) => {
      const a = await this.owned(tx, ownerId, id);
      if (a.epoch !== epoch) throw new AssessmentError('conflict', 'Dispatch epoch is stale');
      const queued = await tx.execute({
        sql: 'SELECT * FROM assessment_dispatch WHERE assessment_id=? AND owner_id=?',
        args: [id, ownerId],
      });
      if (!queued.rows[0] || intent(queued.rows[0]).dispatchId !== dispatchId)
        throw new AssessmentError('conflict', 'Dispatch generation is stale');
      const rows = await tx.execute({
        sql: 'SELECT * FROM assessment_delivery WHERE dispatch_id=?',
        args: [dispatchId],
      });
      const prior = rows.rows[0];
      if (prior) {
        if (
          prior.owner_id !== ownerId ||
          prior.assessment_id !== id ||
          Number(prior.epoch) !== epoch
        )
          throw new AssessmentError('conflict', 'Delivery scope differs');
        return {
          fresh: false,
          receipt: prior.receipt
            ? (JSON.parse(String(prior.receipt)) as Record<string, unknown>)
            : undefined,
          uncertain: !prior.receipt,
        };
      }
      if (!runnable(a)) throw new AssessmentError('conflict', 'No work is runnable');
      await tx.execute({
        sql: "INSERT INTO assessment_delivery(dispatch_id,owner_id,assessment_id,epoch,status,started_at) VALUES(?,?,?,?,'sending',?)",
        args: [dispatchId, ownerId, id, epoch, this.at()],
      });
      return { fresh: true, receipt: undefined, uncertain: false };
    });
  }
  /**
   * The durable session that already served this evidence epoch, read from the
   * accepted delivery receipts rather than the dispatch row, whose session ID
   * outlives the epoch it was recorded for.
   */
  async deliveredSession(ownerId: string, id: string, epoch: number): Promise<string | undefined> {
    await this.ensure();
    const rows = await this.execute({
      sql: "SELECT receipt FROM assessment_delivery WHERE owner_id=? AND assessment_id=? AND epoch=? AND status='accepted' AND receipt IS NOT NULL ORDER BY started_at DESC, rowid DESC LIMIT 1",
      args: [ownerId, id, epoch],
    });
    const raw = rows.rows[0]?.receipt;
    if (!raw) return undefined;
    const receipt: unknown = JSON.parse(String(raw));
    if (!receipt || typeof receipt !== 'object' || !('sessionId' in receipt)) return undefined;
    return typeof receipt.sessionId === 'string' ? receipt.sessionId : undefined;
  }
  async received(dispatchId: string, receipt: Record<string, unknown>) {
    await this.ensure();
    await this.execute({
      sql: "UPDATE assessment_delivery SET status='accepted',receipt=? WHERE dispatch_id=?",
      args: [JSON.stringify(receipt), dispatchId],
    });
  }
  /**
   * Drop a delivery whose request provably never reached the runtime, so the
   * next lease redelivers immediately instead of waiting out the undelivered
   * window that an uncertain delivery needs.
   */
  async releaseDelivery(dispatchId: string): Promise<void> {
    await this.ensure();
    await this.execute({
      sql: "DELETE FROM assessment_delivery WHERE dispatch_id=? AND status='sending' AND receipt IS NULL",
      args: [dispatchId],
    });
  }
  async retryUndelivered(dispatchId: string): Promise<boolean> {
    await this.ensure();
    const result = await this.execute({
      sql: "UPDATE assessment_delivery SET started_at=? WHERE dispatch_id=? AND status='sending' AND receipt IS NULL AND started_at<=?",
      args: [this.at(), dispatchId, new Date(this.clock().getTime() - 30_000).toISOString()],
    });
    return result.rowsAffected === 1;
  }
  async getWatch(ownerId: string, id: string): Promise<WatchRecord | null> {
    await this.ensure();
    await this.owned(this.db, ownerId, id);
    const rows = await this.execute({
      sql: 'SELECT * FROM assessment_watches WHERE assessment_id=? AND owner_id=?',
      args: [id, ownerId],
    });
    const row = rows.rows[0];
    return row
      ? {
          policy: JSON.parse(String(row.policy)) as WatchPolicy,
          status: String(row.status),
          refreshes: Number(row.refreshes),
          nextAt: String(row.next_at),
          lastError: row.last_error ? String(row.last_error) : undefined,
        }
      : null;
  }
  async setWatch(
    ownerId: string,
    id: string,
    policy: WatchPolicy | null,
    expectedRevision?: number,
  ) {
    await this.transaction(async (tx) => {
      const a = await this.owned(tx, ownerId, id);
      if (expectedRevision !== undefined && a.revision !== expectedRevision)
        throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
      if (!policy) {
        await tx.execute({
          sql: "UPDATE assessment_watches SET status='disabled',lease_token=NULL,lease_until=NULL WHERE assessment_id=? AND owner_id=?",
          args: [id, ownerId],
        });
        return;
      }
      const kinds = ['photo_triage', 'vin_identity', 'market_comps', 'repair_evidence'];
      if (
        !policy.actionKinds.length ||
        policy.actionKinds.some((k) => !kinds.includes(k)) ||
        new Set(policy.actionKinds).size !== policy.actionKinds.length ||
        !Number.isInteger(policy.intervalMs) ||
        policy.intervalMs < 60_000 ||
        policy.intervalMs > 30 * 86_400_000 ||
        !Number.isInteger(policy.maxRefreshes) ||
        policy.maxRefreshes < 1 ||
        policy.maxRefreshes > 12 ||
        !Number.isFinite(Date.parse(policy.until)) ||
        Date.parse(policy.until) <= this.clock().getTime() ||
        (a.lot.saleDate && Date.parse(policy.until) > Date.parse(a.lot.saleDate))
      )
        throw new AssessmentError(
          'invalid_input',
          'Watch requires bounded source kinds, interval, refresh count and an end before the auction',
        );
      await tx.execute({
        sql: "INSERT INTO assessment_watches(assessment_id,owner_id,policy,status,refreshes,next_at) VALUES(?,?,?,'active',0,?) ON CONFLICT(assessment_id) DO UPDATE SET policy=excluded.policy,status='active',next_at=excluded.next_at,lease_token=NULL,lease_until=NULL,last_error=NULL",
        args: [
          id,
          ownerId,
          JSON.stringify(policy),
          new Date(this.clock().getTime() + policy.intervalMs).toISOString(),
        ],
      });
    });
    return this.getWatch(ownerId, id);
  }
  async claimWatch(): Promise<WatchClaim | null> {
    return this.transaction(async (tx) => {
      const at = this.at();
      const rows = await tx.execute({
        sql: "SELECT * FROM assessment_watches WHERE (status='active' AND next_at<=?) OR (status='leased' AND lease_until<=?) ORDER BY next_at LIMIT 1",
        args: [at, at],
      });
      const row = rows.rows[0];
      if (!row) return null;
      const ownerId = String(row.owner_id),
        assessmentId = String(row.assessment_id);
      const a = await this.owned(tx, ownerId, assessmentId),
        policy = JSON.parse(String(row.policy)) as WatchPolicy;
      const stoppedByOwner =
        a.status === 'stopped' && (!('stopKind' in a) || a.stopKind === 'owner');
      const exhausted =
        a.budget.usedInvestigations >= a.budget.maxInvestigations ||
        (row.status !== 'leased' && Number(row.refreshes) >= policy.maxRefreshes);
      if (
        stoppedByOwner ||
        a.decision.readiness === 'vetoed' ||
        Date.parse(at) >= Date.parse(policy.until) ||
        (a.lot.saleDate && Date.parse(at) >= Date.parse(a.lot.saleDate)) ||
        exhausted
      ) {
        await tx.execute({
          sql: "UPDATE assessment_watches SET status='completed',lease_token=NULL,lease_until=NULL WHERE assessment_id=?",
          args: [assessmentId],
        });
        return null;
      }
      if (a.status === 'investigating') {
        await tx.execute({
          sql: "UPDATE assessment_watches SET status='active',next_at=?,lease_token=NULL,lease_until=NULL WHERE assessment_id=?",
          args: [
            pendingDeadline(a) ?? new Date(this.clock().getTime() + 60_000).toISOString(),
            assessmentId,
          ],
        });
        return null;
      }
      const actionKinds =
        row.status === 'leased' && row.reserved_kinds
          ? (JSON.parse(String(row.reserved_kinds)) as WatchPolicy['actionKinds'])
          : watchKindsDue(a, policy, at);
      if (!actionKinds.length) {
        await tx.execute({
          sql: "UPDATE assessment_watches SET status='active',next_at=?,lease_token=NULL,lease_until=NULL WHERE assessment_id=?",
          args: [new Date(this.clock().getTime() + policy.intervalMs).toISOString(), assessmentId],
        });
        return null;
      }
      // An expired watch lease reuses its operation number. Domain idempotency
      // then reconciles a crash after refresh without spending another wakeup.
      const refreshes = Number(row.refreshes) + (row.status === 'leased' ? 0 : 1),
        leaseToken = randomUUID();
      const expectedRevision =
        row.status === 'leased' && row.reserved_revision
          ? Number(row.reserved_revision)
          : a.revision;
      await tx.execute({
        sql: "UPDATE assessment_watches SET status='leased',refreshes=?,lease_token=?,lease_until=?,reserved_revision=?,reserved_kinds=? WHERE assessment_id=?",
        args: [
          refreshes,
          leaseToken,
          new Date(this.clock().getTime() + 30_000).toISOString(),
          expectedRevision,
          JSON.stringify(actionKinds),
          assessmentId,
        ],
      });
      return {
        assessmentId,
        ownerId,
        policy,
        status: 'leased',
        refreshes,
        nextAt: String(row.next_at),
        leaseToken,
        actionKinds,
        expectedRevision,
      };
    });
  }
  /**
   * Lots whose sale is over and whose owner has not said what happened
   * (SPEC 62). SQL narrows the candidates to assessments never prompted, or
   * prompted longer ago than the cadence allows; the rest of the rule is the
   * saved document's, because a sale date, a decision and an outcome all live
   * inside it. A fire reads a bounded window of the most recently updated
   * candidates rather than the table, so the scan cannot grow without limit.
   */
  async dueOutcomePrompts(now: Date, limit = 50): Promise<OutcomePromptDue[]> {
    await this.ensure();
    const rows = await this.execute({
      sql: 'SELECT a.document FROM assessments a LEFT JOIN assessment_outcome_prompts p ON p.assessment_id=a.id WHERE p.prompted_at IS NULL OR p.prompted_at<=? ORDER BY a.updated_at DESC LIMIT ?',
      args: [
        new Date(now.getTime() - OUTCOME_PROMPT_INTERVAL_MS).toISOString(),
        OUTCOME_PROMPT_SCAN,
      ],
    });
    const due: OutcomePromptDue[] = [];
    for (const row of rows.rows) {
      if (due.length >= limit) break;
      const a = JSON.parse(String(row.document)) as Assessment;
      if (askForOutcome(a, now)) due.push({ assessmentId: a.id, ownerId: a.ownerId });
    }
    return due;
  }
  /** Records that the desk has asked, which is what holds the cadence. */
  async recordOutcomePrompt(ownerId: string, id: string, at: string): Promise<void> {
    await this.transaction(async (tx) => {
      await tx.execute({
        sql: 'INSERT INTO assessment_outcome_prompts(assessment_id,owner_id,prompted_at) VALUES(?,?,?) ON CONFLICT(assessment_id) DO UPDATE SET owner_id=excluded.owner_id,prompted_at=excluded.prompted_at',
        args: [id, ownerId, at],
      });
    });
  }
  async finishWatch(claim: WatchClaim, error?: string) {
    await this.ensure();
    await this.execute({
      sql: "UPDATE assessment_watches SET status='active',next_at=?,lease_token=NULL,lease_until=NULL,last_error=? WHERE assessment_id=? AND owner_id=? AND lease_token=?",
      args: [
        new Date(this.clock().getTime() + claim.policy.intervalMs).toISOString(),
        error?.slice(0, 400) ?? null,
        claim.assessmentId,
        claim.ownerId,
        claim.leaseToken,
      ],
    });
  }
}
let singleton: LibsqlAssessmentQueue | undefined;
export function getAssessmentQueue() {
  singleton ??= new LibsqlAssessmentQueue(
    createClient({
      url: resolveAssessmentsUrl(process.env),
      authToken: process.env.ASSESSMENTS_AUTH_TOKEN,
      timeout: BUSY_TIMEOUT_MS,
    }),
  );
  return singleton;
}
