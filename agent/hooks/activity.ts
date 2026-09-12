/** Mirror public action/outcome/token events for the assessment view; omit model reasoning. */
import { defineHook } from 'eve/hooks';
import { assessmentScope } from '../lib/auth';
import { saveActivity } from '../lib/events';
import { getAssessmentQueue } from '../../src/assessment-queue/queue';
const types = new Set([
  'session.started',
  'step.started',
  'step.completed',
  'actions.requested',
  'action.result',
  'turn.completed',
  'turn.cancelled',
  'session.waiting',
  'step.failed',
  'turn.failed',
]);
export default defineHook({
  events: {
    '*': async (event, ctx) => {
      if (!types.has(event.type)) return;
      const scope = assessmentScope(ctx);
      const data =
        event.type === 'step.failed' || event.type === 'turn.failed'
          ? { message: 'Coordinator did not complete; saved assessment remains available.' }
          : 'data' in event
            ? event.data
            : null;
      await saveActivity(scope.ownerId, scope.assessmentId, {
        id: event.meta.id,
        sessionId: ctx.session.id,
        type: event.type,
        at: event.meta.at,
        data,
      });
      const queue = getAssessmentQueue();
      if (['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type))
        await queue.settled(
          scope.ownerId,
          scope.assessmentId,
          scope.epoch,
          scope.dispatchId,
          event.type !== 'turn.completed',
        );
      else await queue.heartbeat(scope.ownerId, scope.assessmentId, scope.epoch, scope.dispatchId);
    },
  },
});
