/**
 * Delivery of saved research intents, and the desk's own question once a sale
 * is over. `tick()` takes one unit of work from the whole queue and is what the
 * deployment's schedule drains; `tickFor()` leases only the named assessment, so
 * a run route can start its own assessment inline and report acceptance from a
 * received session id (SPEC 57); `promptOutcomes()` is the schedule's separate
 * third phase, which asks — in the activity log and nowhere else — what
 * happened to a lot whose sale is over (SPEC 62). Queue, domain, transport, the
 * activity writer and the clock are injected, so every path here tests offline.
 */
import { recordActivity, type ActivityWriter } from '../assessment-http/activity';
import { OUTCOME_PROMPT_EVENT, OUTCOME_PROMPT_MESSAGE } from '../assessments/outcome-prompt';
import { dispatchAssessment } from '../assessment-http/agent';
import type { Assessment, OfferedAction } from '../assessments/types';
import { getAssessmentService } from '../assessments/service';
import { getAssessmentQueue, type DispatchIntent, type LibsqlAssessmentQueue } from './queue';
import { runnable } from './policy';

type Domain = {
  getAssessment(ownerId: string, id: string): Promise<Assessment | null>;
  refreshAssessment(
    ownerId: string,
    id: string,
    revision: number,
    key: string,
    options?: { actionKinds?: OfferedAction['kind'][]; allowOwnerStopped?: boolean },
  ): Promise<Assessment>;
};
// The dispatch generation in the delivery identity already carries the revision
// the lease was taken at, so the transport asserts owner, assessment, epoch and
// delivery only.
export type QueueDispatch = (
  assessment: Assessment,
  scope: { dispatchId: string; expectedEpoch: number },
) => Promise<{ sessionId: string }>;
export type WorkerTick =
  | { kind: 'idle' }
  | { kind: 'watch'; assessmentId: string }
  | { kind: 'superseded' }
  | { kind: 'reconciled'; assessmentId: string }
  | { kind: 'dispatched'; assessmentId: string; sessionId: string }
  | { kind: 'retry'; assessmentId: string };
export function createAssessmentWorker(deps: {
  queue: LibsqlAssessmentQueue;
  domain: Domain;
  dispatch: QueueDispatch;
  activity?: ActivityWriter;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());
  const activity = deps.activity ?? recordActivity;
  async function deliver(claim: DispatchIntent): Promise<WorkerTick> {
    try {
      // Reading through the service settles expired investigation reservations
      // before dispatch. Their paid allowance remains consumed and done action
      // IDs are never reoffered by this recovery path.
      const a = await deps.domain.getAssessment(claim.ownerId, claim.assessmentId);
      if (!a || a.epoch !== claim.epoch || !(await deps.queue.current(claim)))
        return { kind: 'superseded' };
      if (!runnable(a)) {
        await deps.queue.settled(a.ownerId, a.id, a.epoch, claim.dispatchId, false);
        return { kind: 'reconciled', assessmentId: a.id };
      }
      const receipt = await deps.dispatch(a, {
        dispatchId: claim.dispatchId,
        expectedEpoch: a.epoch,
      });
      await deps.queue.running(claim, receipt.sessionId);
      return { kind: 'dispatched', assessmentId: a.id, sessionId: receipt.sessionId };
    } catch (error) {
      // The retry row records a generic message, so the cause only survives here.
      console.error(`assessment ${claim.assessmentId}: research dispatch failed:`, error);
      await deps.queue.retry(claim);
      return { kind: 'retry', assessmentId: claim.assessmentId };
    }
  }
  return {
    async tick(): Promise<WorkerTick> {
      const watch = await deps.queue.claimWatch();
      if (watch) {
        try {
          const a = await deps.domain.getAssessment(watch.ownerId, watch.assessmentId);
          if (!a) throw new Error('Assessment unavailable');
          if (a.status === 'stopped' && (!('stopKind' in a) || a.stopKind === 'owner'))
            throw new Error('Owner cancelled this assessment');
          await deps.domain.refreshAssessment(
            watch.ownerId,
            watch.assessmentId,
            watch.expectedRevision,
            `watch:${watch.assessmentId}:${watch.refreshes}`,
            { actionKinds: watch.actionKinds, allowOwnerStopped: false },
          );
          await deps.queue.finishWatch(watch);
        } catch {
          await deps.queue.finishWatch(
            watch,
            'Watch refresh could not be applied; saved state retained',
          );
        }
        return { kind: 'watch', assessmentId: watch.assessmentId };
      }
      const claim = await deps.queue.claim();
      return claim ? deliver(claim) : { kind: 'idle' };
    },
    /**
     * Ask what happened to every lot whose sale is over and whose owner has
     * recorded no outcome, at most once a week each (SPEC 62). The question is
     * an activity event and nothing else: no message leaves the deployment, and
     * no model is called to write it. Returns how many were asked.
     */
    async promptOutcomes(now = clock()): Promise<number> {
      const due = await deps.queue.dueOutcomePrompts(now);
      const at = now.toISOString();
      for (const { ownerId, assessmentId } of due) {
        await activity({
          ownerId,
          assessmentId,
          type: OUTCOME_PROMPT_EVENT,
          data: { message: OUTCOME_PROMPT_MESSAGE },
          at,
        });
        // Recorded after the event, so a failed write is asked again next fire
        // rather than being silently skipped for a week.
        await deps.queue.recordOutcomePrompt(ownerId, assessmentId, at);
      }
      return due.length;
    },
    /**
     * One delivery attempt for one owned assessment. Watches belong to the
     * schedule, so an inline start never refreshes a different assessment.
     */
    async tickFor(ownerId: string, assessmentId: string): Promise<WorkerTick> {
      // The queue owns the lease window; a scoped claim only narrows which
      // intent may be leased.
      const claim = await deps.queue.claim(undefined, { assessmentId, ownerId });
      return claim ? deliver(claim) : { kind: 'idle' };
    },
  };
}
/**
 * The worker a deployment actually runs. A route handler supplies its own
 * origin, which is how the co-hosted agent is addressed when no explicit
 * `PADDOCK_AGENT_URL` and no `VERCEL_URL` name it; the schedule has no request
 * and relies on those variables.
 */
export function getAssessmentWorker(options: { origin?: string } = {}) {
  return createAssessmentWorker({
    queue: getAssessmentQueue(),
    domain: getAssessmentService(),
    dispatch: async (a, scope) => {
      const receipt = await dispatchAssessment(a.id, a.ownerId, {
        dispatchId: scope.dispatchId,
        env: process.env,
        expectedEpoch: scope.expectedEpoch,
        origin: options.origin,
      });
      if (!('sessionId' in receipt)) throw new Error('Missing research receipt');
      return receipt;
    },
  });
}
