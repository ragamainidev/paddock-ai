/** Real domain service behind the HTTP boundary; only runtime transport is replaced. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssessmentService, getAssessmentService } from '@/assessments/service';
import { MemoryAssessmentStore } from '@/assessments/store';
import {
  assessmentAction,
  assessmentActivity,
  assessmentCollection,
  assessmentDetail,
  assessmentIntakePreview,
} from './handlers';
import { COPART_COMPLETE } from '@/assessments/intake-fixtures/listings';
import { USER_LOT_SOURCE } from '@/assessments/intake';
import { dispatchAssessment } from './agent';
import { AssessmentHttpError } from './auth';

const queue = vi.hoisted(() => ({
  requestRun: vi.fn(),
  status: vi.fn(),
  getWatch: vi.fn(),
  setWatch: vi.fn(),
  claim: vi.fn(),
  claimWatch: vi.fn(),
  current: vi.fn(),
  running: vi.fn(),
  retry: vi.fn(),
  settled: vi.fn(),
}));
vi.mock('@/assessment-queue/queue', () => ({ getAssessmentQueue: () => queue }));

// The activity log is a second database read; the collection's own contract is
// what it does with the answer.
const prompts = vi.hoisted(() => ({ lastPromptedAt: vi.fn() }));
vi.mock('./activity', async (original) => ({
  ...(await original<typeof import('./activity')>()),
  lastPromptedAt: prompts.lastPromptedAt,
}));

vi.mock('@/assessments/service', async (original) => ({
  ...(await original<typeof import('@/assessments/service')>()),
  getAssessmentService: vi.fn(),
}));
// `agentCapability` stays real: whether a bridge credential exists is what
// separates an unreachable runtime from an unconfigured one.
vi.mock('./agent', async (original) => ({
  ...(await original<typeof import('./agent')>()),
  assessmentAgentStatus: vi.fn(async () => ({
    configured: true,
    liveEvidenceEnabled: false,
    modelMode: 'fixture',
  })),
  dispatchAssessment: vi.fn(async (assessmentId: string) => ({
    assessmentId,
    sessionId: 'test-session',
    modelMode: 'fixture',
  })),
  assessmentAgentActivity: vi.fn(async () => ({ events: [] })),
}));

function request(method = 'GET', value?: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/assessments', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}
async function runAction(a: { id: string; revision: number }) {
  const response = await assessmentAction(
    request('POST', { expectedRevision: a.revision, idempotencyKey: 'run' }),
    a.id,
    'run',
  );
  expect(response.status).toBe(202);
  return (await response.json()) as {
    research: { accepted: boolean; queued: boolean; status?: string; reason?: string };
  };
}
/** The leased intent the outbox commits alongside a saved assessment. */
function claim(assessmentId: string, epoch: number) {
  return {
    assessmentId,
    ownerId: 'local',
    epoch,
    revision: 1,
    generation: 1,
    status: 'leased',
    attempts: 1,
    availableAt: '2026-09-06T00:00:00.000Z',
    leaseToken: 'lease-token',
    dispatchId: `${assessmentId}:${epoch}:1`,
  };
}
let service: ReturnType<typeof createAssessmentService>;
beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', '');
  vi.stubEnv('AUTH_USERS', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('PADDOCK_AGENT_TOKEN', 'test-bridge-token');
  service = createAssessmentService({ store: new MemoryAssessmentStore() });
  vi.mocked(getAssessmentService).mockReturnValue(service);
  vi.mocked(dispatchAssessment).mockClear();
  queue.requestRun.mockReset().mockResolvedValue({ status: 'pending' });
  queue.status
    .mockReset()
    .mockResolvedValue({ status: 'pending', attempts: 0, leaseToken: 'never-export-this' });
  queue.getWatch.mockReset().mockResolvedValue(null);
  queue.setWatch.mockReset().mockResolvedValue(null);
  // The run route leases through the worker; the claim describes the intent the
  // outbox would have committed for the assessment under test.
  queue.claim.mockReset().mockResolvedValue(null);
  queue.claimWatch.mockReset().mockResolvedValue(null);
  queue.current.mockReset().mockResolvedValue(true);
  queue.running.mockReset().mockResolvedValue(undefined);
  queue.retry.mockReset().mockResolvedValue(undefined);
  queue.settled.mockReset().mockResolvedValue(undefined);
  prompts.lastPromptedAt.mockReset().mockResolvedValue(new Map<string, string>());
});
afterEach(() => vi.unstubAllEnvs());

describe('saved assessment HTTP contract', () => {
  it('persists before automatic dispatch and isolates a foreign assessment', async () => {
    const response = await assessmentCollection(
      request('POST', { seedLotId: 'sf90-front-il', idempotencyKey: 'first' }),
    );
    expect(response.status).toBe(201);
    const { assessment, research } = await response.json();
    // No delivery is attempted on the create path, so it reports the saved
    // intent and never claims a started session.
    expect(research).toMatchObject({ saved: true, queued: true });
    expect(research.accepted).toBeUndefined();
    expect(await service.getAssessment('local', assessment.id)).not.toBeNull();
    expect(queue.requestRun).toHaveBeenCalledWith('local', assessment.id);
    expect(dispatchAssessment).not.toHaveBeenCalled();
    const foreign = await service.createAssessment('other', { seedLotId: 'sf90-front-il' });
    expect((await assessmentDetail(request(), foreign.id)).status).toBe(404);
    expect((await assessmentAction(request('POST', {}), foreign.id, 'run')).status).toBe(404);
    expect((await assessmentActivity(request(), foreign.id)).status).toBe(404);
    expect(queue.requestRun).toHaveBeenCalledTimes(1);
  });
  it('marks the saved decisions the desk is waiting on, in one read for the list (SPEC 62)', async () => {
    const waiting = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const answered = await service.createAssessment('local', { seedLotId: '296gtb-front-wa' });
    await service.recordOutcome('local', answered.id, {
      kind: 'lost_to_hammer',
      hammer: 34_250,
      note: 'Sold to another bidder',
      expectedRevision: answered.revision,
      idempotencyKey: 'answered',
    });
    prompts.lastPromptedAt.mockResolvedValueOnce(
      new Map([
        [waiting.id, '2026-09-06T06:00:00.000Z'],
        [answered.id, '2020-01-01T00:00:00.000Z'],
      ]),
    );
    const rows = (await (await assessmentCollection(request())).json()).assessments as {
      id: string;
      outcomeDue: boolean;
    }[];
    expect(rows.find((row) => row.id === waiting.id)?.outcomeDue).toBe(true);
    expect(rows.find((row) => row.id === answered.id)?.outcomeDue).toBe(false);
    expect(prompts.lastPromptedAt).toHaveBeenCalledTimes(1);

    // An unreadable activity log costs the flag, not the saved decisions.
    prompts.lastPromptedAt.mockRejectedValueOnce(new Error('activity unavailable'));
    const degraded = await assessmentCollection(request());
    expect(degraded.status).toBe(200);
    expect(
      (await degraded.json()).assessments.every((row: { outcomeDue: boolean }) => !row.outcomeDue),
    ).toBe(true);

    // The detail answer reads the same fact, scoped to the one record, so the
    // banner and the list tag cannot disagree (SPEC 62).
    prompts.lastPromptedAt.mockResolvedValueOnce(
      new Map([[waiting.id, '2026-09-08T06:00:00.000Z']]),
    );
    const detail = await (await assessmentDetail(request(), waiting.id)).json();
    expect(detail.outcomePromptedAt).toBe('2026-09-08T06:00:00.000Z');
    expect(prompts.lastPromptedAt).toHaveBeenLastCalledWith('local', 'outcome_prompt', waiting.id);
    prompts.lastPromptedAt.mockRejectedValueOnce(new Error('activity unavailable'));
    const withoutLog = await assessmentDetail(request(), waiting.id);
    expect(withoutLog.status).toBe(200);
    expect((await withoutLog.json()).outcomePromptedAt).toBeUndefined();
  });

  it('answers the list with calibration statistics that count no recorded demonstration (SPEC 63)', async () => {
    await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const live = await service.createAssessment('local', {
      seedLotId: '296gtb-front-wa',
      mode: 'live',
    });
    await service.recordOutcome('local', live.id, {
      kind: 'purchased',
      hammer: 120_000,
      note: 'Won it',
      expectedRevision: live.revision,
      idempotencyKey: 'won',
    });
    const report = (await (await assessmentCollection(request())).json()).outcomeReport;
    expect(report.excludedFixtures).toBe(1);
    expect(report.matchedOutcomes).toBe(1);
    // The live decision never solved a ceiling, so the purchase is that
    // statistic's own exclusion rather than a hit nobody could read.
    expect(report.statistics.purchasesAboveCeiling).toEqual({ n: 0, excluded: 1, tooFew: true });
    expect(report.statistics.hammerVsMarketCeiling).toEqual({ n: 0, excluded: 1, tooFew: true });
    expect(report.statistics.exitResidual).toEqual({ n: 0, excluded: 0, tooFew: true });
  });
  it('keeps a created assessment when queue status is unavailable and reuses idempotent creation', async () => {
    queue.requestRun.mockRejectedValueOnce(new Error('private network detail'));
    const result = await assessmentCollection(
      request('POST', { seedLotId: 'sf90-front-il', idempotencyKey: 'same' }),
    );
    const first = await result.json();
    expect(result.status).toBe(201);
    expect(first.research.saved).toBe(false);
    expect(JSON.stringify(first)).not.toContain('private network detail');
    const second = await (
      await assessmentCollection(
        request('POST', { seedLotId: 'sf90-front-il', idempotencyKey: 'same' }),
      )
    ).json();
    expect(second.assessment.id).toBe(first.assessment.id);
    expect(await service.listAssessments('local')).toHaveLength(1);
  });
  it('rejects cross-origin writes and stale revisions without changing saved state', async () => {
    expect(
      (
        await assessmentCollection(
          request('POST', { seedLotId: 'sf90-front-il' }, { origin: 'https://attacker.invalid' }),
        )
      ).status,
    ).toBe(403);
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const stale = await assessmentAction(
      request('POST', { expectedRevision: 0, idempotencyKey: 'stop' }),
      a.id,
      'stop',
    );
    expect(stale.status).toBe(409);
    expect((await service.getAssessment('local', a.id))?.status).toBe('active');
  });
  it('records outcomes with revision checks without model authority or dispatch', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const response = await assessmentAction(
      request('POST', {
        kind: 'passed',
        note: 'Physical scope exceeded our budget',
        expectedRevision: a.revision,
        idempotencyKey: 'outcome',
      }),
      a.id,
      'outcome',
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.assessment.outcomes).toHaveLength(1);
    expect(dispatchAssessment).not.toHaveBeenCalled();
  });

  it('reports a saved refresh separately from unavailable queue status', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    queue.requestRun.mockRejectedValueOnce(new Error('runtime down'));
    const response = await assessmentAction(
      request('POST', { expectedRevision: a.revision, idempotencyKey: 'refresh' }),
      a.id,
      'refresh',
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.research.saved).toBe(false);
    expect(result.assessment.epoch).toBe(a.epoch + 1);
    expect((await service.getAssessment('local', a.id))?.epoch).toBe(a.epoch + 1);
  });

  it('keeps queue lease authority out of the owner-visible response', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const response = await assessmentDetail(request(), a.id);
    const payload = await response.text();
    expect(response.status).toBe(200);
    expect(payload).toContain('pending');
    expect(payload).not.toContain('never-export-this');
    expect(payload).not.toContain('leaseToken');
  });

  it('does not let a review payload nominate its own reviewer or accept model inference', async () => {
    let a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const value = { titleBrand: 'Clean' };
    a = await service.recordEvidence('local', a.id, {
      evidence: [
        {
          kind: 'title',
          value,
          subject: { vin: a.lot.vin, year: a.lot.year, make: a.lot.make, model: a.lot.model },
          source: {
            url: 'https://example.com/title',
            label: 'Model claim',
            capturedBy: 'model',
            basis: 'model_inference',
            retrievedAt: new Date().toISOString(),
            observation: value,
          },
        },
      ],
      expectedRevision: a.revision,
      idempotencyKey: 'claim',
    });
    const input = {
      evidenceIds: [a.evidence[0].id],
      expectedRevision: a.revision,
      idempotencyKey: 'review',
      rationale: 'Attempt to accept a model assertion',
    };
    expect(
      (
        await assessmentAction(
          request('POST', { ...input, ownerId: 'trusted-provider' }),
          a.id,
          'review',
        )
      ).status,
    ).toBe(400);
    expect((await assessmentAction(request('POST', input), a.id, 'review')).status).toBe(400);
    expect((await service.getAssessment('local', a.id))?.evidence[0].review).toBeUndefined();
    expect(queue.requestRun).not.toHaveBeenCalled();
  });

  it('run answers accepted:false with agent_unreachable when dispatch fails and keeps the intent', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    queue.claim.mockResolvedValue(claim(a.id, a.epoch));
    vi.mocked(dispatchAssessment).mockRejectedValueOnce(new Error('connection refused'));
    const response = await assessmentAction(
      request('POST', { expectedRevision: a.revision, idempotencyKey: 'run' }),
      a.id,
      'run',
    );
    expect(response.status).toBe(202);
    const { research } = await response.json();
    expect(research).toMatchObject({
      accepted: false,
      queued: true,
      reason: 'agent_unreachable',
      status: 'pending',
    });
    expect(JSON.stringify(research)).not.toContain('connection refused');
    // The lease is returned to the queue, so the schedule still owns the intent.
    expect(queue.retry).toHaveBeenCalledWith(claim(a.id, a.epoch));
    expect(queue.running).not.toHaveBeenCalled();
  });

  it('run answers accepted:true after a successful inline dispatch', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    queue.claim.mockResolvedValue(claim(a.id, a.epoch));
    const response = await assessmentAction(
      request('POST', { expectedRevision: a.revision, idempotencyKey: 'run' }),
      a.id,
      'run',
    );
    expect(response.status).toBe(202);
    const { research } = await response.json();
    expect(research.accepted).toBe(true);
    expect(research.reason).toBeUndefined();
    // The co-hosted agent is addressed through the route's own origin.
    expect(dispatchAssessment).toHaveBeenCalledWith(
      a.id,
      'local',
      expect.objectContaining({
        dispatchId: `${a.id}:0:1`,
        expectedEpoch: 0,
        origin: 'http://localhost',
      }),
    );
    expect(queue.running).toHaveBeenCalledWith(claim(a.id, a.epoch), 'test-session');
    expect(queue.retry).not.toHaveBeenCalled();
  });

  it('run answers accepted:false with agent_not_configured when no bridge credential is set', async () => {
    vi.stubEnv('PADDOCK_AGENT_TOKEN', '');
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    queue.claim.mockResolvedValue(claim(a.id, a.epoch));
    vi.mocked(dispatchAssessment).mockRejectedValueOnce(
      new AssessmentHttpError(503, 'The research agent is not connected.'),
    );
    const { research } = await runAction(a);
    expect(research).toMatchObject({ accepted: false, reason: 'agent_not_configured' });
    expect(queue.retry).toHaveBeenCalled();
  });

  it('run answers accepted:false with not_runnable when no intent is queued', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    queue.requestRun.mockResolvedValue(null);
    const { research } = await runAction(a);
    expect(research).toMatchObject({ accepted: false, queued: true, reason: 'not_runnable' });
    // Nothing to lease, so the route never reaches the runtime.
    expect(queue.claim).not.toHaveBeenCalled();
    expect(dispatchAssessment).not.toHaveBeenCalled();
  });

  it('run answers accepted:false with already_running while a live lease holds the intent', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    queue.requestRun.mockResolvedValue({ status: 'running' });
    // A scoped claim finds nothing because another claimant already has it.
    queue.claim.mockResolvedValue(null);
    queue.status.mockResolvedValue({
      status: 'running',
      attempts: 1,
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    const { research } = await runAction(a);
    expect(research).toEqual({
      accepted: false,
      queued: true,
      status: 'running',
      reason: 'already_running',
    });
    expect(dispatchAssessment).not.toHaveBeenCalled();
    expect(queue.retry).not.toHaveBeenCalled();
  });

  it('validates explicit watch limits before contacting the queue', async () => {
    const a = await service.createAssessment('local', { seedLotId: 'sf90-front-il' });
    const response = await assessmentAction(
      request('POST', {
        expectedRevision: a.revision,
        idempotencyKey: 'watch',
        policy: {
          actionKinds: ['market_comps'],
          intervalMs: 1,
          until: '2026-09-20T00:00:00.000Z',
          maxRefreshes: 10000,
        },
      }),
      a.id,
      'watch',
    );
    expect(response.status).toBe(400);
    expect(queue.setWatch).not.toHaveBeenCalled();
  });

  it('creates a lot from intake and answers with the chips behind it (SPEC 61)', async () => {
    service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      intake: {
        caller: null,
        vpicFetcher: async () => ({ Results: [{ Make: 'FERRARI', ModelYear: '2021' }] }),
        photoProbe: async () => true,
      },
    });
    vi.mocked(getAssessmentService).mockReturnValue(service);
    const response = await assessmentCollection(
      request('POST', {
        intake: { text: COPART_COMPLETE, photoUrls: ['https://cs.copart.com/a.jpg'] },
      }),
    );
    expect(response.status).toBe(201);
    const { assessment, assumptions } = await response.json();
    expect(assessment.lot.source).toBe(USER_LOT_SOURCE);
    expect(assumptions.length).toBeGreaterThan(10);
    expect(assumptions[0]).toMatchObject({ source: 'intake', field: 'vin' });
  });

  it('refuses a photo link that is not a public https address, with a fixed reason', async () => {
    service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      intake: {
        caller: null,
        vpicFetcher: null,
        // A public hostname that resolves into the private network is what
        // the probe refuses; a private literal never reaches it, because the
        // schema rejects that host outright.
        photoProbe: async (url) => !url.includes('rebind.example.test'),
      },
    });
    vi.mocked(getAssessmentService).mockReturnValue(service);
    const response = await assessmentCollection(
      request('POST', {
        intake: {
          text: COPART_COMPLETE,
          photoUrls: ['https://cs.copart.com/a.jpg', 'https://rebind.example.test/b.jpg'],
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'photo link 2 is not a public https address',
    });
  });

  it('refuses a photo link that is not https before any probe runs', async () => {
    const probe = vi.fn(async () => true);
    service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      intake: { caller: null, vpicFetcher: null, photoProbe: probe },
    });
    vi.mocked(getAssessmentService).mockReturnValue(service);
    const response = await assessmentCollection(
      request('POST', {
        intake: { text: COPART_COMPLETE, photoUrls: ['http://cs.copart.com/a.jpg'] },
      }),
    );
    expect(response.status).toBe(400);
    expect(probe).not.toHaveBeenCalled();
  });

  it('creates through the route with exactly one corrected chip', async () => {
    service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      intake: { caller: null, vpicFetcher: null, photoProbe: async () => true },
    });
    vi.mocked(getAssessmentService).mockReturnValue(service);
    const response = await assessmentCollection(
      request('POST', {
        intake: {
          text: COPART_COMPLETE,
          photoUrls: ['https://cs.copart.com/a.jpg'],
          // One field, not all fifteen: corrections are partial by definition.
          edits: { titleBrand: 'IL salvage, rebuildable' },
        },
      }),
    );
    expect(response.status).toBe(201);
    const { assessment, assumptions } = await response.json();
    expect(assessment.lot.titleBrand).toBe('IL salvage, rebuildable');
    const corrected = assessment.lotAssumptions.filter(
      (chip: { field: string }) => chip.field === 'titleBrand',
    );
    expect(corrected).toEqual([
      expect.objectContaining({ source: 'user', meaning: 'IL salvage, rebuildable' }),
    ]);
    expect(assumptions).toEqual(assessment.lotAssumptions);
  });

  it('previews a reading with the corrections already made', async () => {
    service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      intake: { caller: null, vpicFetcher: null, photoProbe: async () => true },
    });
    vi.mocked(getAssessmentService).mockReturnValue(service);
    const response = await assessmentIntakePreview(
      request('POST', { text: COPART_COMPLETE, edits: { make: 'Ferrari' } }),
    );
    expect(response.status).toBe(200);
    const reading = await response.json();
    expect(reading.fields.make).toBe('Ferrari');
    expect(reading.assumptions.filter((a: { field: string }) => a.field === 'make')).toEqual([
      expect.objectContaining({ source: 'user', meaning: 'Ferrari' }),
    ]);
  });

  it('previews a reading without creating an assessment', async () => {
    service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      intake: {
        caller: async () => ({ skipped: 'no key' }),
        vpicFetcher: null,
        photoProbe: async () => true,
      },
    });
    vi.mocked(getAssessmentService).mockReturnValue(service);
    const response = await assessmentIntakePreview(request('POST', { text: COPART_COMPLETE }));
    expect(response.status).toBe(200);
    const reading = await response.json();
    expect(reading.fields.lotNumber).toBe('63198496');
    expect(reading.note).toBe('model completion skipped: no key');
    expect(reading.blocked).toBeUndefined();
    expect(await service.listAssessments('local')).toEqual([]);
  });
});
