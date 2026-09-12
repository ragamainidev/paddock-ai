/** Capability authority is bound to both the owned assessment and its current evidence epoch. */
import type { SessionContext, ToolContext } from 'eve/tools';
import { getAssessmentService } from '../../src/assessments/service';
import { AssessmentError } from '../../src/assessments/types';
import { assessmentScope } from './auth';
import { assessmentBoard } from './board';

type ScopedContext = { session: { auth: SessionContext['session']['auth'] } };
type AssessmentToolContext = Pick<ToolContext, 'session' | 'callId'>;

export async function getScopedAssessment(ctx: ScopedContext) {
  const scope = assessmentScope(ctx);
  const assessment = await getAssessmentService().getAssessment(scope.ownerId, scope.assessmentId);
  if (!assessment) throw new Error('Assessment not found.');
  if (assessment.epoch !== scope.epoch)
    throw new Error('Assessment epoch changed; this session no longer has authority.');
  return { scope, assessment };
}
export async function readOwnedAssessment(ctx: ScopedContext) {
  const { assessment } = await getScopedAssessment(ctx);
  return { ok: true, assessment: assessmentBoard(assessment) };
}
export async function investigateOwnedAssessment(
  input: { actionId: string; expectedRevision: number },
  ctx: AssessmentToolContext,
) {
  const { scope, snapshot } = await mutationScope(ctx, input.expectedRevision);
  try {
    const assessment = await getAssessmentService().investigateAssessment(
      scope.ownerId,
      scope.assessmentId,
      input.actionId,
      snapshot.revision,
      `eve:${ctx.session.id}:${ctx.callId}`,
    );
    return { ok: true, attempt: input, assessment: assessmentBoard(assessment) };
  } catch (error) {
    return domainError(error, ctx);
  }
}
export async function finishOwnedAssessment(
  input: { reason: string; expectedRevision: number },
  ctx: AssessmentToolContext,
) {
  const { scope, snapshot } = await mutationScope(ctx, input.expectedRevision);
  try {
    const assessment = await getAssessmentService().finishResearch(
      scope.ownerId,
      scope.assessmentId,
      input.reason,
      snapshot.revision,
    );
    return { ok: true, assessment: assessmentBoard(assessment) };
  } catch (error) {
    return domainError(error, ctx);
  }
}
async function mutationScope(ctx: ScopedContext, expectedRevision: number) {
  const { scope, assessment: snapshot } = await getScopedAssessment(ctx);
  // Pin the domain write to the checked snapshot so a racing refresh fails its revision guard.
  if (snapshot.revision !== expectedRevision)
    throw new AssessmentError('conflict', 'Assessment revision changed; read it again.');
  return { scope, snapshot };
}
async function domainError(error: unknown, ctx: ScopedContext) {
  if (!(error instanceof AssessmentError)) throw new Error('Assessment capability is unavailable.');
  return { ...(await readOwnedAssessment(ctx)), ok: false, error: error.code };
}
