/** Trust the authenticated app bridge; never derive authority from model arguments. */
import { timingSafeEqual } from 'node:crypto';
import { ForbiddenError, UnauthenticatedError, type AuthFn } from 'eve/channels/auth';
import type { SessionContext } from 'eve/tools';
import { z } from 'zod';
import { liveEvidenceEnabled } from '../../src/assessment-http/settings';
import { getAssessmentService } from '../../src/assessments/service';

export const ownerInput = z.object({ ownerId: z.string().min(1).max(160) }).strict();
export const assessmentIdInput = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
const epochInput = z
  .string()
  .regex(/^(0|[1-9]\d{0,8})$/)
  .transform(Number);
const dispatchIdInput = z.string().min(1).max(250);

export function bridgeAuthorized(
  request: Request,
  secret = process.env.PADDOCK_AGENT_TOKEN,
): boolean {
  if (!secret || secret.length < 24) return false;
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const unauthenticated = (message: string) =>
  new UnauthenticatedError({ challenges: [{ scheme: 'Bearer' }], code: 'unauthorized', message });

/**
 * The only ingress policy for the framework channel (SPEC 49). A verified app
 * bridge asserts the owner, assessment, evidence epoch and durable delivery it
 * is acting for; this walk turns those headers into the same principal the
 * tools and the activity hook already read through `assessmentScope`. An
 * unknown assessment, a superseded epoch and unacknowledged live evidence are
 * refusals of authority (403), not input errors.
 */
export function bridgeAuth(): AuthFn<Request> {
  return async (request) => {
    if (!bridgeAuthorized(request))
      throw unauthenticated('The assessment bridge credential is missing or invalid.');
    const owner = ownerInput.safeParse({ ownerId: request.headers.get('x-paddock-owner') });
    const assessmentId = assessmentIdInput.safeParse(request.headers.get('x-paddock-assessment'));
    const epoch = epochInput.safeParse(request.headers.get('x-paddock-epoch'));
    const dispatchId = dispatchIdInput
      .optional()
      .safeParse(request.headers.get('x-paddock-dispatch') ?? undefined);
    if (!owner.success || !assessmentId.success || !epoch.success || !dispatchId.success)
      throw unauthenticated('The assessment bridge scope is missing or invalid.');
    const ownerId = owner.data.ownerId;
    const assessment = await getAssessmentService().getAssessment(ownerId, assessmentId.data);
    if (!assessment) throw new ForbiddenError({ message: 'assessment_not_available' });
    if (assessment.epoch !== epoch.data) throw new ForbiddenError({ message: 'stale_epoch' });
    if (assessment.mode !== 'fixture' && !liveEvidenceAdmitted())
      throw new ForbiddenError({ message: 'live_evidence_not_enabled' });
    return assessmentPrincipal(ownerId, assessment.id, assessment.epoch, dispatchId.data);
  };
}

// A misconfigured live coordinator throws from the settings module; live
// evidence is closed either way, so the failure never reaches the caller.
function liveEvidenceAdmitted(): boolean {
  try {
    return liveEvidenceEnabled();
  } catch {
    return false;
  }
}

export function assessmentScope(ctx: { session: { auth: SessionContext['session']['auth'] } }) {
  const current = ctx.session.auth.current;
  const initiator = ctx.session.auth.initiator;
  const assessmentId = assessmentIdInput.safeParse(current?.attributes.assessmentId);
  const epoch = epochInput.safeParse(current?.attributes.epoch);
  if (
    current?.authenticator !== 'paddock-assessment-bridge' ||
    current.principalType !== 'user' ||
    !current.principalId ||
    !assessmentId.success ||
    !epoch.success ||
    initiator?.principalId !== current.principalId ||
    initiator?.attributes.assessmentId !== assessmentId.data ||
    initiator?.attributes.epoch !== current.attributes.epoch
  ) {
    throw new Error('Assessment scope is not authorized.');
  }
  const dispatchId =
    typeof current.attributes.dispatchId === 'string' ? current.attributes.dispatchId : undefined;
  return {
    ownerId: current.principalId,
    assessmentId: assessmentId.data,
    epoch: epoch.data,
    dispatchId,
  };
}

export function assessmentPrincipal(
  ownerId: string,
  assessmentId: string,
  epoch: number,
  dispatchId?: string,
) {
  return {
    authenticator: 'paddock-assessment-bridge',
    principalType: 'user' as const,
    principalId: ownerId,
    attributes: { assessmentId, epoch: String(epoch), ...(dispatchId ? { dispatchId } : {}) },
  };
}
