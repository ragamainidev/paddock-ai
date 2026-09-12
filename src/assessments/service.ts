/** Durable assessment lifecycle, idempotent reserved investigations and bounded stopping (SPEC 46–49). */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { BUSY_TIMEOUT_MS } from '@/assessment-queue/schema';
import { getSalvageLot } from '@/salvage/seed-lots';
import type { SalvageLot } from '@/salvage/types';
import { defaultPhotoProbe, type PhotoProbe } from '@/inspector/photos';
import { defaultVpicFetcher, type VpicFetcher } from '@/inspector/vin';
import { createLiveInvestigator } from './adapters';
import { createIntakeCaller } from './intake-caller';
import {
  buildUserLot,
  runIntake,
  screenIntakePhotos,
  UNUSABLE_LOT,
  type Assumption,
  type IntakeCaller,
  type IntakeInput,
  type IntakeReading,
} from './intake';
import { resolveAssessmentsUrl } from './database-url';
import { repairScopeFingerprint } from './scope';
import { projectAssessment } from './decision';
import { createFixtureInvestigator } from './fixtures';
import { LibsqlAssessmentStore } from './store';
import {
  AssessmentError,
  OUTCOME_KINDS,
  type Assessment,
  type AssessmentDecision,
  type AssessmentInvestigator,
  type AssessmentStore,
  type CreateAssessmentInput,
  type InvestigationResult,
  type RecordEvidenceInput,
  type ReviewEvidenceInput,
  type UpdateBuyerInput,
  type OfferedAction,
  type OutcomeKind,
} from './types';
import {
  createAssessmentInputSchema,
  fingerprint,
  intakePreviewInputSchema,
  parseInput,
  salvageLotSchema,
  recordEvidenceInputSchema,
  recordOutcomeInputSchema,
  validateEvidence,
  reviewIssue,
  reviewEvidenceInputSchema,
  updateBuyerInputSchema,
  observationFreshnessIssue,
} from './validation';

export { createAssessmentInputSchema, recordEvidenceInputSchema } from './validation';
// A completion write that loses a revision race is re-applied to the newer
// record; only after this many conflicts is the finished work billed as failed.
const COMPLETION_ATTEMPTS = 3;
// The finished result lost every revision race it was given. It is a distinct
// failure from unavailable, timed-out or invalid work, and it says so.
class CompletionExhausted extends Error {}
const COMPLETION_LOST =
  'Investigation completed but its result could not be saved after repeated conflicts; the allowance is consumed and no evidence was recorded';
const INVESTIGATION_FAILED =
  'Investigation unavailable, timed out, or returned invalid evidence; no unsupported facts were accepted';
type BuyerEconomics = NonNullable<AssessmentDecision['buyerEconomics']>;
/**
 * A stored decision's buyer arithmetic as it may actually read back: each of
 * these is required on a current decision and simply absent on one written
 * before the buyer layer solved it.
 */
type SavedEconomics = Partial<Omit<BuyerEconomics, 'discipline'>> & {
  discipline?: Partial<BuyerEconomics['discipline']>;
};
/**
 * Whether a stored decision's buyer arithmetic predates a field the current
 * one carries: the market persona's ceiling, the buyer's own cost lines, or
 * the arm that bound the ceiling (SPEC 58–60). A record short of any of them
 * does not satisfy its own type once read, so it is projected again; a
 * decision with no economics at all is a legitimate state rather than an old
 * shape, and is left alone.
 */
function staleDecisionShape(a: Assessment): boolean {
  const economics: SavedEconomics | undefined = a.decision.buyerEconomics;
  return (
    economics !== undefined &&
    (!economics.market || !economics.lines || !economics.discipline?.bound)
  );
}
export type AssessmentService = ReturnType<typeof createAssessmentService>;
/**
 * Intake's outside world, injected so every reading path runs offline. `null`
 * disables a step rather than defaulting it: a service with no photo probe
 * screens nothing, and says so by refusing to be the default.
 */
export type AssessmentIntakeDeps = {
  caller?: IntakeCaller | null;
  vpicFetcher?: VpicFetcher | null;
  photoProbe?: PhotoProbe | null;
};
export type AssessmentServiceDeps = {
  store: AssessmentStore;
  investigator?: AssessmentInvestigator;
  now?: () => Date;
  id?: () => string;
  investigationTimeoutMs?: number;
  intake?: AssessmentIntakeDeps;
};
export function createAssessmentService(deps: AssessmentServiceDeps) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const id = deps.id ?? randomUUID;
  const fixtures = createFixtureInvestigator();
  const live = createLiveInvestigator({ now: deps.now });
  const investigate =
    deps.investigator ??
    ((a, action) => (a.mode === 'fixture' ? fixtures(a, action) : live(a, action)));
  const timeoutMs = Math.max(10, Math.min(240_000, deps.investigationTimeoutMs ?? 210_000));
  const intakeCaller =
    deps.intake?.caller === null ? null : (deps.intake?.caller ?? createIntakeCaller());
  const intakeVpic =
    deps.intake?.vpicFetcher === null ? null : (deps.intake?.vpicFetcher ?? defaultVpicFetcher);
  const intakePhotoProbe =
    deps.intake?.photoProbe === null ? null : (deps.intake?.photoProbe ?? defaultPhotoProbe);
  const owner = (value: string) => {
    if (!value.trim() || value.length > 200)
      throw new AssessmentError('invalid_input', 'A valid owner is required');
  };
  async function getAssessment(ownerId: string, assessmentId: string): Promise<Assessment | null> {
    owner(ownerId);
    const a = await deps.store.get(ownerId, assessmentId);
    if (!a) return null;
    const expired = a.investigations.filter((i) => i.status === 'pending' && i.deadlineAt <= now());
    const staleEvidence = a.evidence.some(
      (e) => a.decision.evidenceIds.includes(e.id) && observationFreshnessIssue(e, now()),
    );
    if (!expired.length && !staleEvidence) {
      // A record written before the ceiling became bidder-relative reads back
      // with economics short of the market ceiling, the lines or the arm that
      // bound the bid (SPEC 58–60). It is projected again — over the same
      // evidence, at the record's own time, so nothing but the shape moves —
      // and the row is left alone: a read never rewrites what it read, and no
      // history entry is appended.
      if (staleDecisionShape(a)) projectAssessment(a, a.updatedAt, false);
      return a;
    }
    const revision = a.revision;
    for (const i of expired) {
      i.costBasis = 'allowance_estimate';
      i.status = 'failed';
      i.finishedAt = now();
      i.detail =
        'Investigation interrupted or timed out; reserved allowance consumed conservatively';
      a.budget.reservedCostCents -= i.action.maxCostCents;
      a.budget.spentCostCents += i.action.maxCostCents;
    }
    a.revision++;
    if (a.stopKind !== 'owner') {
      a.status = a.investigations.some((i) => i.status === 'pending') ? 'investigating' : 'active';
      delete a.stopReason;
      delete a.stopKind;
    }
    projectAssessment(a, now());
    try {
      await deps.store.save(a, revision);
      return a;
    } catch (error) {
      if (error instanceof AssessmentError && error.code === 'conflict')
        return deps.store.get(ownerId, assessmentId);
      throw error;
    }
  }
  async function requireAssessment(ownerId: string, assessmentId: string) {
    const a = await getAssessment(ownerId, assessmentId);
    if (!a) throw new AssessmentError('not_found', 'Assessment not found');
    return a;
  }
  function revision(a: Assessment, expected: number) {
    if (a.revision !== expected)
      throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
    if (a.status === 'investigating')
      throw new AssessmentError('conflict', 'An investigation is already pending');
  }
  function replay(a: Assessment, key: string, hash: string) {
    if (!key.trim() || key.length > 200)
      throw new AssessmentError('invalid_input', 'Idempotency keys must contain 1–200 characters');
    const old = a.operations.find((op) => op.key === key);
    if (old && old.fingerprint !== hash)
      throw new AssessmentError('conflict', 'Idempotency key was used with different input');
    return Boolean(old);
  }
  /**
   * R1–R3 over what the user pasted, creating nothing. The workspace calls it
   * to show the chips before an assessment exists (SPEC 61).
   */
  async function previewIntake(ownerId: string, input: IntakeInput): Promise<IntakeReading> {
    owner(ownerId);
    return runIntake(parseInput(intakePreviewInputSchema, input), {
      caller: intakeCaller,
      vpicFetcher: intakeVpic,
    });
  }
  /**
   * A lot the user brought, read and screened before anything is saved. The
   * listing URL is provenance only and is never fetched; the photo addresses
   * are screened through the request-forgery boundary (SPEC 29, 61).
   */
  async function intakeLot(
    intake: NonNullable<CreateAssessmentInput['intake']>,
    at: string,
  ): Promise<{ lot: SalvageLot; assumptions: Assumption[] }> {
    // The photo screen runs first: a link the server will not dereference
    // refuses the lot, and it should refuse it before a model call is spent.
    const screened = await screenIntakePhotos(intake.photoUrls, intakePhotoProbe);
    if (screened.blocked) throw new AssessmentError('invalid_input', screened.blocked);
    const reading = await runIntake(intake, {
      caller: intakeCaller,
      vpicFetcher: intakeVpic,
    });
    if (reading.blocked) throw new AssessmentError('invalid_input', reading.blocked);
    const built = buildUserLot(reading.fields, intake.photoUrls, at, {
      assumptions: reading.assumptions,
      listingUrl: intake.listingUrl,
      id: id(),
    });
    // A lot the user brought is held to the same schema as one a caller
    // states: a reading that cannot satisfy it never becomes a record, and the
    // refusal states the reading rather than echoing a validator.
    let lot: SalvageLot;
    try {
      lot = parseInput(salvageLotSchema, built);
    } catch {
      throw new AssessmentError('invalid_input', UNUSABLE_LOT);
    }
    return { lot, assumptions: reading.assumptions };
  }
  async function createAssessment(
    ownerId: string,
    input: CreateAssessmentInput,
  ): Promise<Assessment> {
    owner(ownerId);
    const parsed = parseInput(createAssessmentInputSchema, input);
    // The buyer profile is the caller's own, or the schema's default; intake
    // reads a lot, never a bidder.
    const buyer = parsed.buyer;
    const at = now();
    const brought = parsed.intake ? await intakeLot(parsed.intake, at) : undefined;
    const lot = brought?.lot ?? parsed.lot ?? getSalvageLot(parsed.seedLotId!);
    if (!lot) throw new AssessmentError('invalid_input', 'Unknown seed lot');
    const a: Assessment = {
      id: id(),
      ownerId,
      revision: 1,
      epoch: 0,
      lot: structuredClone(lot),
      ...(brought ? { lotAssumptions: brought.assumptions } : {}),
      mode: parsed.mode,
      buyer,
      fixtureCaseId: parsed.fixtureCaseId,
      createdAt: at,
      updatedAt: at,
      status: 'active',
      budget: {
        maxInvestigations: parsed.budget?.maxInvestigations ?? 6,
        maxCostCents: parsed.budget?.maxCostCents ?? 0,
        usedInvestigations: 0,
        reservedCostCents: 0,
        spentCostCents: 0,
      },
      evidence: [],
      investigations: [],
      decision: {
        revision: 1,
        at,
        readiness: 'needs_evidence',
        verdict: 'needs_evidence',
        ceiling: null,
        provisionalCeiling: null,
        unknowns: [],
        reasons: [],
        evidenceIds: [],
      },
      history: [],
      offeredActions: [],
      operations: [],
      outcomes: [],
    };
    projectAssessment(a, at);
    return deps.store.create(
      a,
      parsed.idempotencyKey,
      fingerprint({ ...parsed, idempotencyKey: undefined }),
    );
  }
  async function investigateAssessment(
    ownerId: string,
    assessmentId: string,
    actionId: string,
    expectedRevision: number,
    idempotencyKey = `investigate:${actionId}`,
  ): Promise<Assessment> {
    const a = await requireAssessment(ownerId, assessmentId);
    const hash = fingerprint({ actionId });
    if (replay(a, idempotencyKey, hash)) return a;
    revision(a, expectedRevision);
    const action = a.offeredActions.find((candidate) => candidate.id === actionId);
    if (!action || a.status === 'stopped')
      throw new AssessmentError(
        'not_offered',
        'Choose an action currently offered by this assessment',
      );
    if (
      a.budget.usedInvestigations >= a.budget.maxInvestigations ||
      action.maxCostCents >
        a.budget.maxCostCents - a.budget.spentCostCents - a.budget.reservedCostCents
    )
      throw new AssessmentError('budget_exhausted', 'Investigation budget exhausted');
    const startedAt = now();
    const investigation = {
      id: id(),
      action: structuredClone(action),
      idempotencyKey,
      status: 'pending' as const,
      startedAt,
      deadlineAt: new Date(Date.parse(startedAt) + timeoutMs).toISOString(),
      evidenceIds: [],
      costCents: 0,
    };
    a.investigations.push(investigation);
    a.operations.push({ key: idempotencyKey, fingerprint: hash });
    a.budget.usedInvestigations++;
    a.budget.reservedCostCents += action.maxCostCents;
    a.status = 'investigating';
    a.offeredActions = [];
    a.revision++;
    a.updatedAt = startedAt;
    await deps.store.save(a, expectedRevision);
    // The completion write is separate from the investigation: a concurrent
    // writer's conflict is re-applied to the record it lost to, so a paid
    // result is never discarded by another operation's timing. A conflicted
    // save never persists, so each attempt starts from the stored record.
    const complete = async (result: InvestigationResult): Promise<Assessment> => {
      for (let attempt = 1; ; attempt++) {
        const latest = await requireAssessment(ownerId, assessmentId);
        const pending = latest.investigations.find((i) => i.id === investigation.id)!;
        if (pending.status !== 'pending') return latest;
        if (result.evidence.length > 100)
          throw new AssessmentError(
            'invalid_input',
            'Investigation returned too many evidence records',
          );
        const at = now();
        // An operation deduplicates its own payload; a new capture is a new observation even if a value returns to an earlier state.
        const captured = new Map<string, string>();
        for (const raw of result.evidence) {
          const e = validateEvidence(raw, latest, id(), at, true);
          const oldId = captured.get(e.fingerprint);
          if (oldId) {
            pending.evidenceIds.push(oldId);
            continue;
          }
          latest.evidence.push(e);
          captured.set(e.fingerprint, e.id);
          pending.evidenceIds.push(e.id);
        }
        // Without metered provider usage, consume the full authorized allowance rather than report zero spend.
        if (
          result.costCents !== undefined &&
          (!Number.isFinite(result.costCents) || result.costCents < 0)
        )
          throw new AssessmentError('invalid_input', 'Invalid provider usage');
        const cost = result.costCents ?? action.maxCostCents;
        pending.costBasis = result.costCents === undefined ? 'allowance_estimate' : 'metered';
        pending.status = 'completed';
        pending.finishedAt = at;
        pending.detail = result.detail.slice(0, 2000);
        pending.costCents = cost;
        latest.budget.reservedCostCents -= action.maxCostCents;
        latest.budget.spentCostCents += cost;
        const prev = latest.revision;
        latest.revision++;
        latest.status = 'active';
        const resultKind = {
          photo_triage: 'triage',
          vin_identity: 'identity',
          market_comps: 'comp',
          repair_evidence: 'repair_price',
        }[action.kind];
        if (
          latest.evidence.some(
            (e) =>
              pending.evidenceIds.includes(e.id) &&
              e.status === 'accepted' &&
              e.kind === resultKind,
          )
        )
          latest.refreshPending = latest.refreshPending?.filter((kind) => kind !== action.kind);
        projectAssessment(latest, at);
        try {
          await deps.store.save(latest, prev);
        } catch (error) {
          if (!(error instanceof AssessmentError) || error.code !== 'conflict') throw error;
          if (attempt < COMPLETION_ATTEMPTS) continue;
          throw new CompletionExhausted();
        }
        return latest;
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await complete(
        await Promise.race([
          investigate(structuredClone(a), action),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new AssessmentError('unavailable', 'Investigation timed out')),
              timeoutMs,
            );
          }),
        ]),
      );
    } catch (error) {
      const latest = await requireAssessment(ownerId, assessmentId);
      const pending = latest.investigations.find((i) => i.id === investigation.id)!;
      if (pending.status !== 'pending') return latest;
      pending.costBasis = 'allowance_estimate';
      pending.status = 'failed';
      pending.finishedAt = now();
      pending.detail =
        error instanceof CompletionExhausted ? COMPLETION_LOST : INVESTIGATION_FAILED;
      pending.costCents = action.maxCostCents;
      latest.budget.reservedCostCents -= action.maxCostCents;
      latest.budget.spentCostCents += action.maxCostCents;
      const prev = latest.revision;
      latest.revision++;
      latest.status = 'active';
      projectAssessment(latest, now());
      await deps.store.save(latest, prev);
      return latest;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function recordEvidence(
    ownerId: string,
    assessmentId: string,
    input: RecordEvidenceInput,
  ): Promise<Assessment> {
    const parsed = parseInput(recordEvidenceInputSchema, input);
    const a = await requireAssessment(ownerId, assessmentId);
    const hash = fingerprint({ evidence: parsed.evidence });
    if (replay(a, parsed.idempotencyKey, hash)) return a;
    revision(a, parsed.expectedRevision);
    for (const raw of parsed.evidence) {
      const source = {
        ...raw.source,
        capturedBy: /fixture/.test(raw.source.capturedBy) ? raw.source.capturedBy : 'user',
        basis: raw.source.capturedBy === 'model' ? 'model_inference' : raw.source.basis,
      };
      // A self-attested record has no capture behind it: the server owns the
      // observation, artifact, extraction and basis, and never takes them from
      // the client that typed the number (SPEC 56). The only basis a typed
      // record keeps is the inference marker the server derived above.
      if (source.capturedBy === 'user') {
        delete source.observation;
        delete source.artifact;
        delete source.extraction;
        if (source.basis !== 'model_inference') delete source.basis;
      }
      const e = validateEvidence({ ...raw, source }, a, id(), now(), false);
      if (!a.evidence.some((item) => item.fingerprint === e.fingerprint)) a.evidence.push(e);
    }
    a.operations.push({ key: parsed.idempotencyKey, fingerprint: hash });
    a.revision++;
    resumeEvidenceWork(a);
    projectAssessment(a, now());
    await deps.store.save(a, parsed.expectedRevision);
    return a;
  }
  function resumeEvidenceWork(a: Assessment) {
    if (a.stopKind === 'owner') return;
    a.status = 'active';
    delete a.stopReason;
    delete a.stopKind;
  }
  async function reviewEvidence(
    ownerId: string,
    assessmentId: string,
    input: ReviewEvidenceInput,
  ): Promise<Assessment> {
    const parsed = parseInput(reviewEvidenceInputSchema, input);
    const a = await requireAssessment(ownerId, assessmentId);
    const hash = fingerprint({
      operation: 'review',
      evidenceIds: [...new Set(parsed.evidenceIds)].sort(),
      rationale: parsed.rationale,
    });
    if (replay(a, parsed.idempotencyKey, hash)) return a;
    revision(a, parsed.expectedRevision);
    const chosen = [...new Set(parsed.evidenceIds)].map((eid) => {
      const e = a.evidence.find((item) => item.id === eid);
      if (!e)
        throw new AssessmentError('invalid_input', 'Evidence record not found on this assessment');
      const issue = reviewIssue(e, a, now());
      if (issue) throw new AssessmentError('invalid_input', issue);
      return e;
    });
    for (const e of chosen) e.status = 'accepted';
    const scope = repairScopeFingerprint(a);
    for (const e of chosen) {
      e.status = 'accepted';
      e.reason =
        'Owner reviewed the scoped source observation; attestation retained, not independent verification';
      e.review = {
        ownerId,
        at: now(),
        rationale: parsed.rationale,
        ...(e.kind === 'inspection' || e.kind === 'repair_price'
          ? { scopeFingerprint: scope }
          : {}),
      };
      e.reviews = [...(e.reviews ?? []), structuredClone(e.review)];
      const kind = {
        triage: 'photo_triage',
        identity: 'vin_identity',
        comp: 'market_comps',
        repair_price: 'repair_evidence',
        title: undefined,
        registration: undefined,
        inspection: undefined,
      }[e.kind];
      if (kind && a.refreshRequestedAt && e.source.retrievedAt >= a.refreshRequestedAt)
        a.refreshPending = a.refreshPending?.filter((item) => item !== kind);
    }
    a.operations.push({ key: parsed.idempotencyKey, fingerprint: hash });
    a.revision++;
    resumeEvidenceWork(a);
    projectAssessment(a, now());
    await deps.store.save(a, parsed.expectedRevision);
    return a;
  }
  async function updateBuyer(
    ownerId: string,
    assessmentId: string,
    input: UpdateBuyerInput,
  ): Promise<Assessment> {
    const parsed = parseInput(updateBuyerInputSchema, input);
    const a = await requireAssessment(ownerId, assessmentId);
    const hash = fingerprint({ operation: 'buyer', buyer: parsed.buyer });
    if (replay(a, parsed.idempotencyKey, hash)) return a;
    revision(a, parsed.expectedRevision);
    a.buyer = parsed.buyer;
    a.operations.push({ key: parsed.idempotencyKey, fingerprint: hash });
    a.revision++;
    resumeEvidenceWork(a);
    projectAssessment(a, now());
    await deps.store.save(a, parsed.expectedRevision);
    return a;
  }
  async function finishResearch(
    ownerId: string,
    assessmentId: string,
    reason: string,
    expectedRevision: number,
  ): Promise<Assessment> {
    const a = await requireAssessment(ownerId, assessmentId);
    revision(a, expectedRevision);
    if (a.offeredActions.length)
      throw new AssessmentError(
        'not_offered',
        'Useful bounded research remains; complete offered actions before finishing',
      );
    if (a.status === 'stopped') return a;
    if (!reason.trim() || reason.length > 1000)
      throw new AssessmentError('invalid_input', 'A bounded stop reason is required');
    a.status = 'stopped';
    a.stopKind = a.decision.readiness === 'ready' ? 'decision' : 'waiting';
    a.stopReason = reason;
    a.revision++;
    projectAssessment(a, now());
    await deps.store.save(a, expectedRevision);
    return a;
  }
  async function refreshAssessment(
    ownerId: string,
    assessmentId: string,
    expectedRevision: number,
    idempotencyKey: string,
    options?: { actionKinds?: OfferedAction['kind'][]; allowOwnerStopped?: boolean },
  ): Promise<Assessment> {
    const a = await requireAssessment(ownerId, assessmentId);
    if (
      options?.allowOwnerStopped === false &&
      (a.stopKind === 'owner' || (a.status === 'stopped' && !a.stopKind))
    )
      throw new AssessmentError('conflict', 'Owner stopped this assessment');
    if (
      options?.actionKinds?.some(
        (kind) =>
          !['photo_triage', 'vin_identity', 'market_comps', 'repair_evidence'].includes(kind),
      )
    )
      throw new AssessmentError('invalid_input', 'Unknown refresh capability');
    const hash = fingerprint({ operation: 'refresh', expectedRevision, options });
    if (replay(a, idempotencyKey, hash)) return a;
    revision(a, expectedRevision);
    a.epoch++;
    a.refreshKinds =
      options?.actionKinds ?? (a.decision.readiness === 'ready' ? ['market_comps'] : undefined);
    a.refreshPending = options?.actionKinds ?? ['market_comps'];
    a.refreshRequestedAt = now();
    delete a.stopKind;
    a.revision++;
    a.status = 'active';
    delete a.stopReason;
    a.operations.push({ key: idempotencyKey, fingerprint: hash });
    projectAssessment(a, now());
    await deps.store.save(a, expectedRevision);
    return a;
  }
  async function stopAssessment(
    ownerId: string,
    assessmentId: string,
    reason: string,
    expectedRevision: number,
  ): Promise<Assessment> {
    const a = await requireAssessment(ownerId, assessmentId);
    if (a.revision !== expectedRevision)
      throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
    if (!reason.trim() || reason.length > 1000)
      throw new AssessmentError('invalid_input', 'A bounded stop reason is required');
    for (const pending of a.investigations.filter((i) => i.status === 'pending')) {
      pending.costBasis = 'allowance_estimate';
      pending.status = 'failed';
      pending.finishedAt = now();
      pending.detail = 'Stopped by owner; any late provider result is discarded';
      pending.costCents = pending.action.maxCostCents;
      a.budget.reservedCostCents -= pending.action.maxCostCents;
      a.budget.spentCostCents += pending.action.maxCostCents;
    }
    a.revision++;
    a.status = 'stopped';
    a.stopReason = reason;
    a.stopKind = 'owner';
    projectAssessment(a, now());
    await deps.store.save(a, expectedRevision);
    return a;
  }
  async function recordOutcome(
    ownerId: string,
    assessmentId: string,
    input: {
      kind: OutcomeKind;
      note: string;
      amount?: number;
      hammer?: number;
      observedAt?: string;
      decisionRevision?: number;
      repairCost?: number;
      holdingCost?: number;
      saleProceeds?: number;
      expectedRevision: number;
      idempotencyKey: string;
    },
  ): Promise<Assessment> {
    const a = await requireAssessment(ownerId, assessmentId);
    input = parseInput(recordOutcomeInputSchema, input);
    const hash = fingerprint({
      operation: 'outcome',
      kind: input.kind,
      note: input.note,
      amount: input.amount,
      hammer: input.hammer,
      observedAt: input.observedAt,
      decisionRevision: input.decisionRevision,
      repairCost: input.repairCost,
      holdingCost: input.holdingCost,
      saleProceeds: input.saleProceeds,
    });
    if (replay(a, input.idempotencyKey, hash)) return a;
    revision(a, input.expectedRevision);
    if (
      !(OUTCOME_KINDS as readonly string[]).includes(input.kind) ||
      !input.note.trim() ||
      input.note.length > 2000 ||
      [input.amount, input.hammer].some(
        (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
      )
    )
      throw new AssessmentError('invalid_input', 'Invalid outcome');
    const observedAt = input.observedAt ?? now();
    const selected =
      input.decisionRevision === undefined
        ? a.decision
        : a.history.find((d) => d.revision === input.decisionRevision);
    if (
      !selected ||
      Date.parse(selected.at) > Date.parse(observedAt) ||
      Date.parse(observedAt) > Date.parse(now())
    )
      throw new AssessmentError(
        'invalid_input',
        'Choose an existing decision made no later than the observed outcome, which cannot be future dated',
      );
    a.outcomes.push({
      at: now(),
      kind: input.kind,
      note: input.note,
      amount: input.amount,
      hammer: input.hammer,
      repairCost: input.repairCost,
      holdingCost: input.holdingCost,
      saleProceeds: input.saleProceeds,
      observedAt,
      decisionRevision: selected.revision,
      decisionCeiling: selected.ceiling,
    });
    a.operations.push({ key: input.idempotencyKey, fingerprint: hash });
    a.revision++;
    projectAssessment(a, now());
    await deps.store.save(a, input.expectedRevision);
    return a;
  }
  return {
    createAssessment,
    previewIntake,
    getAssessment,
    listAssessments: async (ownerId: string) => {
      owner(ownerId);
      const records = await deps.store.list(ownerId);
      return (await Promise.all(records.map((a) => getAssessment(ownerId, a.id)))).filter(
        (a): a is Assessment => a !== null,
      );
    },
    investigateAssessment,
    recordEvidence,
    reviewEvidence,
    updateBuyer,
    finishResearch,
    refreshAssessment,
    stopAssessment,
    recordOutcome,
  };
}
const globalService = globalThis as typeof globalThis & {
  __paddockAssessments?: AssessmentService;
};
export function getAssessmentService(): AssessmentService {
  if (!globalService.__paddockAssessments) {
    const url = resolveAssessmentsUrl(process.env);
    if (url.startsWith('file:')) mkdirSync(dirname(url.slice(5)), { recursive: true });
    globalService.__paddockAssessments = createAssessmentService({
      store: new LibsqlAssessmentStore(
        createClient({
          url,
          authToken: process.env.ASSESSMENTS_AUTH_TOKEN,
          timeout: BUSY_TIMEOUT_MS,
        }),
      ),
    });
  }
  return globalService.__paddockAssessments;
}
