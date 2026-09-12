/** Shared HTTP seams for the assessment workspace and programmatic clients. */
import { z } from 'zod';
import { getAssessmentService } from '@/assessments/service';
import {
  createAssessmentInputSchema,
  intakePreviewInputSchema,
  recordEvidenceInputSchema,
  recordOutcomeInputSchema,
  reviewEvidenceInputSchema,
  updateBuyerInputSchema,
} from '@/assessments/schemas';
import {
  getAssessmentQueue,
  type DispatchIntent,
  type LibsqlAssessmentQueue,
} from '@/assessment-queue/queue';
import { getAssessmentWorker } from '@/assessment-queue/worker';
import { OUTCOME_PROMPT_EVENT, outcomePromptPending } from '@/assessments/outcome-prompt';
import { summarizeOutcomes } from '@/assessment-reporting/outcomes';
import { SALVAGE_LOTS } from '@/salvage/seed-lots';
import { lastPromptedAt } from './activity';
import {
  agentCapability,
  assessmentAgentActivity,
  assessmentAgentStatus,
  dispatchAssessment,
} from './agent';
import {
  assessmentErrorResponse,
  AssessmentHttpError,
  assessmentOwner,
  requireSameOrigin,
} from './auth';

const revisionSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(160),
});
const watchSchema = revisionSchema
  .extend({
    policy: z
      .object({
        actionKinds: z
          .array(z.enum(['market_comps', 'photo_triage', 'vin_identity', 'repair_evidence']))
          .min(1)
          .max(4),
        intervalMs: z
          .number()
          .int()
          .min(60_000)
          .max(30 * 86400_000),
        until: z.string().datetime(),
        maxRefreshes: z.number().int().min(1).max(12),
      })
      .strict()
      .nullable(),
  })
  .strict();

// The co-hosted agent answers on this deployment's own origin unless an
// explicit address is configured; a route handler is the only place that
// knows it.
function requestOrigin(request: Request): string | undefined {
  try {
    return new URL(request.url).origin;
  } catch {
    return undefined;
  }
}

async function body(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > 512_000) throw new AssessmentHttpError(413, 'Assessment input is too large.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new AssessmentHttpError(400, 'Provide valid JSON.');
  }
}

function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AssessmentHttpError(
      400,
      result.error.issues[0]?.message ?? 'Invalid assessment input.',
    );
  return result.data;
}

export async function assessmentCollection(request: Request): Promise<Response> {
  try {
    const owner = await assessmentOwner(request);
    const service = getAssessmentService();
    if (request.method === 'GET') {
      const assessments = await service.listAssessments(owner);
      // One statement for the whole list, so a row costs no query of its own.
      // An unreadable activity log leaves the flag off rather than failing the
      // collection: the saved decisions are what this answer is for (SPEC 62).
      const prompted = await lastPromptedAt(owner, OUTCOME_PROMPT_EVENT).catch(
        () => new Map<string, string>(),
      );
      return Response.json({
        assessments: assessments.map((a) => ({
          ...a,
          outcomeDue: outcomePromptPending(prompted.get(a.id), a.outcomes),
        })),
        outcomeReport: summarizeOutcomes(assessments),
        agent: await assessmentAgentStatus({ origin: requestOrigin(request) }),
        seeds: SALVAGE_LOTS.map(({ id, title }) => ({ id, title })),
      });
    }
    requireSameOrigin(request);
    const input = parsed(createAssessmentInputSchema, await body(request));
    const assessment = await service.createAssessment(owner, input);
    const research = await continueResearch(assessment.id, owner);
    // A lot the user brought carries the chips behind every field it states,
    // so the workspace can show what was inferred from what (SPEC 2, 61).
    return Response.json(
      { assessment, research, assumptions: assessment.lotAssumptions ?? [] },
      { status: 201 },
    );
  } catch (error) {
    return assessmentErrorResponse(error);
  }
}

/**
 * The reading alone: the deterministic pass, the model completion and the
 * federal decode over what the user pasted, creating nothing and fetching no
 * listing page (SPEC 61). The workspace calls it before it offers to save.
 */
export async function assessmentIntakePreview(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await assessmentOwner(request);
    const input = parsed(intakePreviewInputSchema, await body(request));
    const reading = await getAssessmentService().previewIntake(owner, input);
    return Response.json(reading);
  } catch (error) {
    return assessmentErrorResponse(error);
  }
}

export async function assessmentDetail(request: Request, id: string): Promise<Response> {
  try {
    const owner = await assessmentOwner(request);
    const assessment = await getAssessmentService().getAssessment(owner, id);
    if (!assessment) throw new AssessmentHttpError(404, 'Assessment not found.');
    const queue = getAssessmentQueue();
    const intent = await queue.status(owner, id);
    // The same fact the collection reads, scoped to this record, so the banner
    // and the list tag cannot disagree. An unreadable log costs the banner and
    // nothing else (SPEC 62).
    const prompted = await lastPromptedAt(owner, OUTCOME_PROMPT_EVENT, id).catch(
      () => new Map<string, string>(),
    );
    return Response.json({
      assessment,
      outcomePromptedAt: prompted.get(id),
      agent: await assessmentAgentStatus({ origin: requestOrigin(request) }),
      research: intent
        ? {
            status: intent.status,
            attempts: intent.attempts,
            availableAt: intent.availableAt,
            lastError: intent.lastError,
          }
        : null,
      watch: await queue.getWatch(owner, id),
    });
  } catch (error) {
    return assessmentErrorResponse(error);
  }
}

export async function assessmentAction(
  request: Request,
  id: string,
  action: 'run' | 'refresh' | 'evidence' | 'stop' | 'outcome' | 'buyer' | 'review' | 'watch',
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const owner = await assessmentOwner(request);
    const service = getAssessmentService();
    const current = await service.getAssessment(owner, id);
    if (!current) throw new AssessmentHttpError(404, 'Assessment not found.');
    if (action === 'run') {
      const input = parsed(revisionSchema, await body(request));
      const queue = getAssessmentQueue();
      const intent = await queue.requestRun(owner, id, input.expectedRevision);
      const started = await startResearch(queue, owner, id, intent, requestOrigin(request));
      return Response.json(
        {
          research: {
            accepted: started.accepted,
            queued: true,
            status: started.status,
            ...(started.reason ? { reason: started.reason } : {}),
          },
        },
        { status: 202 },
      );
    }
    if (action === 'watch') {
      const input = parsed(watchSchema, await body(request));
      return Response.json({
        watch: await getAssessmentQueue().setWatch(owner, id, input.policy, input.expectedRevision),
      });
    }
    if (action === 'buyer' || action === 'review') {
      const value = await body(request);
      const assessment =
        action === 'buyer'
          ? await service.updateBuyer(owner, id, parsed(updateBuyerInputSchema, value))
          : await service.reviewEvidence(owner, id, parsed(reviewEvidenceInputSchema, value));
      return Response.json({ assessment, research: await continueResearch(id, owner) });
    }
    if (action === 'evidence') {
      const input = parsed(recordEvidenceInputSchema, await body(request));
      const assessment = await service.recordEvidence(owner, id, input);
      return Response.json({
        assessment,
        research: assessment.status === 'active' ? await continueResearch(id, owner) : undefined,
      });
    }
    if (action === 'outcome')
      return Response.json({
        assessment: await service.recordOutcome(
          owner,
          id,
          parsed(recordOutcomeInputSchema, await body(request)),
        ),
      });
    const input = parsed(revisionSchema, await body(request));
    if (action === 'stop') {
      const assessment = await service.stopAssessment(
        owner,
        id,
        'Stopped by the owner.',
        input.expectedRevision,
      );
      // The domain transition revokes further work even when the runtime is unavailable.
      await dispatchAssessment(id, owner, {
        cancel: true,
        origin: requestOrigin(request),
      }).catch(() => undefined);
      return Response.json({ assessment });
    }
    const assessment = await service.refreshAssessment(
      owner,
      id,
      input.expectedRevision,
      input.idempotencyKey,
    );
    return Response.json({ assessment, research: await continueResearch(id, owner) });
  } catch (error) {
    return assessmentErrorResponse(error);
  }
}

/** How long the run route waits for its own delivery attempt before answering. */
const INLINE_DISPATCH_MS = 10_000;
const QUEUED_STATUSES = ['pending', 'leased', 'running'];
type ResearchReason =
  'agent_unreachable' | 'agent_not_configured' | 'already_running' | 'not_runnable';

/** A lease another claimant still holds: this assessment's delivery is in flight. */
function heldByAnother(intent: DispatchIntent, now: number): boolean {
  return (
    ['leased', 'running'].includes(intent.status) &&
    intent.leaseUntil !== undefined &&
    Date.parse(intent.leaseUntil) > now
  );
}

/**
 * SPEC 57: the run route performs its own bounded delivery attempt, so
 * `accepted` reports a received session id rather than a saved row. Anything
 * else leaves the committed intent for the deployment's schedule to retry, and
 * names why this request could not start it.
 */
async function startResearch(
  queue: Pick<LibsqlAssessmentQueue, 'status'>,
  ownerId: string,
  id: string,
  intent: DispatchIntent | null,
  origin: string | undefined,
): Promise<{ accepted: boolean; reason?: ResearchReason; status?: string }> {
  if (!intent || !QUEUED_STATUSES.includes(intent.status))
    return { accepted: false, reason: 'not_runnable', status: intent?.status };
  // A tick that outlives the bound keeps settling its own delivery; the request
  // stops waiting for it so a stalled runtime cannot hold the response open.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = getAssessmentWorker({ origin })
    .tickFor(ownerId, id)
    .catch((error: unknown) => {
      console.error(`assessment ${id}: inline dispatch failed:`, error);
      return { kind: 'retry' as const };
    });
  const result = await Promise.race([
    attempt,
    new Promise<{ kind: 'unbounded' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'unbounded' }), INLINE_DISPATCH_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  // The attempt moves the intent on, so the answer reports the state it left
  // behind rather than the one this request found.
  const settled = await queue.status(ownerId, id).catch(() => null);
  const status = (settled ?? intent).status;
  if (result.kind === 'dispatched') return { accepted: true, status };
  if (result.kind === 'superseded' || result.kind === 'reconciled')
    return { accepted: false, reason: 'not_runnable', status };
  // A scoped claim also finds nothing while another claimant holds a live
  // lease. That intent is being delivered, not stranded.
  if (result.kind === 'idle' && settled && heldByAnother(settled, Date.now()))
    return { accepted: false, reason: 'already_running', status };
  // The intent is queued and unclaimed, so the work remains runnable: the
  // runtime is either unconfigured or unreachable from this deployment.
  return {
    accepted: false,
    reason: agentCapability().configured ? 'agent_unreachable' : 'agent_not_configured',
    status,
  };
}

/**
 * The store commits the outbox atomically; the schedule owns retries and
 * watches. No delivery is attempted here, so the answer reports `saved` — the
 * intent is committed — and never `accepted`, which only the run route earns
 * for a session the runtime received (SPEC 57).
 */
async function continueResearch(id: string, owner: string) {
  const assessment = await getAssessmentService().getAssessment(owner, id);
  if (assessment?.status === 'stopped')
    return {
      saved: false,
      message:
        assessment.stopReason || 'No eligible investigation remains. The assessment is saved.',
    };
  try {
    const intent = await getAssessmentQueue().requestRun(owner, id);
    return { saved: Boolean(intent), queued: true, status: intent?.status };
  } catch (error) {
    return {
      saved: false,
      message:
        error instanceof AssessmentHttpError
          ? error.message
          : 'The assessment is saved. Research queue status is temporarily unavailable.',
    };
  }
}

export async function assessmentActivity(request: Request, id: string): Promise<Response> {
  try {
    const owner = await assessmentOwner(request);
    if (!(await getAssessmentService().getAssessment(owner, id)))
      throw new AssessmentHttpError(404, 'Assessment not found.');
    return Response.json(await assessmentAgentActivity(id, owner));
  } catch (error) {
    return assessmentErrorResponse(error);
  }
}
