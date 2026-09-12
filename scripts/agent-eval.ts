/** Drive the real Eve server and authored channel/tools, then grade persisted assessment history. */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import type { ScheduleHandlerArgs } from 'eve/schedules';
import { createAssessmentService } from '../src/assessments/service';
import { COPART_COMPLETE } from '../src/assessments/intake-fixtures/listings';
import { SALVAGE_LOTS } from '../src/salvage/seed-lots';
import { LibsqlAssessmentStore } from '../src/assessments/store';
import type { Assessment, AssessmentDecision } from '../src/assessments/types';
import {
  listActivity,
  SCHEDULE_SESSION,
  type ActivityEvent,
} from '../src/assessment-http/activity';
import { OUTCOME_PROMPT_EVENT, OUTCOME_PROMPT_MESSAGE } from '../src/assessments/outcome-prompt';
import { dispatchAssessment } from '../src/assessment-http/agent';
import { assessmentAction } from '../src/assessment-http/handlers';
import { LibsqlAssessmentQueue } from '../src/assessment-queue/queue';
import { BUSY_TIMEOUT_MS } from '../src/assessment-queue/schema';
import { createAssessmentWorker } from '../src/assessment-queue/worker';
import dispatchSchedule from '../agent/schedules/dispatch';

// GitHub-hosted runners compile `eve dev` several times slower than a laptop,
// and the outage case restarts it mid-suite, so every wait budget is scaled
// there rather than tuned per case.
const SLOW_RUNNER = process.env.CI === 'true' || process.env.PADDOCK_AGENT_EVAL_SLOW === '1';
const scale = (ms: number) => (SLOW_RUNNER ? ms * 4 : ms);

async function main() {
  const live = process.argv.includes('--live');
  const trials = Number(
    process.argv.find((arg) => arg.startsWith('--trials='))?.split('=')[1] ?? 1,
  );
  if (!Number.isInteger(trials) || trials < 1 || trials > 3 || (!live && trials !== 1))
    throw new Error('--trials=1..3 is available only for explicit live coordinator evaluation.');
  if (
    live &&
    (process.env.PADDOCK_AGENT_LIVE_ACK !== 'yes' ||
      !process.env.AI_GATEWAY_API_KEY ||
      !process.env.PADDOCK_AGENT_MODEL)
  )
    throw new Error(
      '--live requires PADDOCK_AGENT_LIVE_ACK=yes, AI_GATEWAY_API_KEY and explicit PADDOCK_AGENT_MODEL.',
    );
  const mode = live ? 'live-coordinator' : 'fixture';
  const directory = await mkdtemp(path.join(tmpdir(), 'paddock-agent-eval-'));
  const runtimeDirectory = path.join(directory, 'project');
  await mkdir(runtimeDirectory);
  for (const name of ['package.json', 'tsconfig.json'])
    await copyFile(path.join(process.cwd(), name), path.join(runtimeDirectory, name));
  for (const name of ['agent', 'src', 'evals', 'node_modules'])
    await symlink(path.join(process.cwd(), name), path.join(runtimeDirectory, name), 'dir');
  const databaseUrl = `file:${path.join(directory, 'assessments.db')}`;
  // The app reads saved activity from the same durable database the agent
  // writes, so the eval points this process at the isolated eval database.
  process.env.ASSESSMENTS_DATABASE_URL = databaseUrl;
  const port = process.env.PADDOCK_AGENT_EVAL_PORT
    ? Number(process.env.PADDOCK_AGENT_EVAL_PORT)
    : await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const token = 'local-eval-only-secret-0123456789';
  // The Next-side dispatch module addresses the eve process the eval started.
  const agentEnv = {
    ...process.env,
    ASSESSMENTS_DATABASE_URL: databaseUrl,
    PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE: '',
    PADDOCK_AGENT_MODE: mode,
    PADDOCK_AGENT_TOKEN: token,
    PADDOCK_AGENT_URL: base,
  };
  // This process writes the same file the eve process does, so its client
  // carries the same busy timeout the app's does (docs/database.md §6.4).
  const client = createClient({ url: databaseUrl, timeout: BUSY_TIMEOUT_MS });
  const service = createAssessmentService({
    // Intake's outside world is stubbed here, so the eval reads a pasted
    // listing block and reaches no network of its own (SPEC 61).
    intake: {
      caller: async () => ({
        fields: [
          {
            field: 'engine',
            value: '4.0L V8 twin-turbo hybrid',
            quote: 'Engine: 4.0L V8 Twin Turbo Hybrid',
            reason: 'The engine line of the pasted block states it',
          },
        ],
      }),
      vpicFetcher: async () => ({
        Results: [{ Make: 'FERRARI', Model: 'SF90 Stradale', ModelYear: '2021' }],
      }),
      photoProbe: async () => true,
    },
    store: new LibsqlAssessmentStore(client),
  });
  const queue = new LibsqlAssessmentQueue(client);
  const owner = 'runtime-eval';
  const results: Array<{
    name: string;
    checks: string[];
    assessment: Assessment;
    events: ActivityEvent[];
    sessionId: string;
  }> = [];
  let server: ChildProcess | undefined;
  let log = '';
  async function start() {
    server = spawn(
      'pnpm',
      [
        'exec',
        'eve',
        'dev',
        '--no-ui',
        '--logs',
        'all',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        cwd: runtimeDirectory,
        env: {
          ...process.env,
          ASSESSMENTS_DATABASE_URL: databaseUrl,
          PADDOCK_AGENT_TOKEN: token,
          PADDOCK_AGENT_MODE: mode,
          PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE: '',
          PADDOCK_AGENT_FIXTURE_DELAY_MS: '100',
          ...(!live ? { AI_GATEWAY_API_KEY: '', ANTHROPIC_API_KEY: '' } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout?.on('data', (d) => {
      log += String(d);
    });
    server.stderr?.on('data', (d) => {
      log += String(d);
    });
    await until(async () => {
      if (server?.exitCode !== null) throw new Error(`Eve exited: ${log.slice(-4000)}`);
      return fetch(`${base}/eve/v1/health`)
        .then((r) => r.ok)
        .catch(() => false);
    }, scale(90_000));
  }
  async function stop() {
    if (server && server.exitCode === null) {
      const exit = once(server, 'exit');
      server.kill('SIGTERM');
      await exit;
    }
    server = undefined;
  }
  // A timeout names what the runtime recorded, not only that it stalled:
  // the caller's context (typically the assessment's activity so far) is
  // printed ahead of the eve process log.
  async function until(
    test: () => Promise<boolean>,
    timeout = scale(45_000),
    context?: () => Promise<string>,
  ) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const detail = context
      ? await context().catch((error) => `context unavailable: ${String(error)}`)
      : '';
    throw new Error(`Runtime eval timed out after ${timeout} ms. ${detail}\n${log.slice(-8000)}`);
  }
  async function activitySummary(id: string, sessionId: string) {
    const es = await events(id);
    const lines = es.map(
      (e) => `${e.type}${e.sessionId === sessionId ? '' : ` (session ${e.sessionId})`}`,
    );
    return `assessment ${id}, session ${sessionId}: ${es.length} events [${lines.join(', ')}]`;
  }
  // The bridge scope Eve's auth walk reads; every session route requires it.
  function bridge(id: string, epoch: number, ownerId = owner) {
    return {
      authorization: `Bearer ${token}`,
      'x-paddock-owner': ownerId,
      'x-paddock-assessment': id,
      'x-paddock-epoch': String(epoch),
    };
  }
  async function probe(headers: Record<string, string>, path = '/eve/v1/session') {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ message: 'probe' }),
    });
  }
  async function deliver(
    id: string,
    options: { cancel?: boolean; dispatchId?: string; expectedEpoch?: number } = {},
  ) {
    return dispatchAssessment(id, owner, { ...options, env: agentEnv, queue });
  }
  async function events(id: string): Promise<ActivityEvent[]> {
    return listActivity(owner, id);
  }
  async function run(a: Assessment) {
    const before = (await events(a.id)).length;
    const intent = await queue.status(owner, a.id);
    let claim: Awaited<ReturnType<typeof queue.claim>> = null;
    if (intent && ['pending', 'leased', 'running'].includes(intent.status)) {
      await until(async () => {
        claim = await queue.claim();
        return Boolean(claim);
      });
      assert.equal(claim!.assessmentId, a.id, 'only the intended assessment is runnable');
    }
    const dispatchId = (await queue.status(owner, a.id))?.dispatchId;
    assert(dispatchId, 'a run carries the durable delivery identity of its assessment');
    const receipt = await deliver(a.id, { dispatchId, expectedEpoch: a.epoch });
    assert('sessionId' in receipt, 'a run returns a durable session receipt');
    const sessionId = receipt.sessionId;
    if (claim) await queue.running(claim, sessionId);
    await until(
      async () => {
        const es = (await events(a.id))
          .slice(claim ? before : 0)
          .filter((event) => event.sessionId === sessionId);
        const failed = es.find((e) => e.type === 'turn.failed' || e.type === 'step.failed');
        if (failed) throw new Error(JSON.stringify(failed));
        return es.some((e) => e.type === 'turn.completed');
      },
      live ? scale(120_000) : scale(45_000),
      () => activitySummary(a.id, sessionId),
    );
    const assessment = await service.getAssessment(owner, a.id);
    assert(assessment);
    const activity = await events(a.id);
    assert(activity.some((event) => event.sessionId === sessionId));
    return { assessment, events: activity, sessionId };
  }
  try {
    await start();
    if (!live) {
      await stop();
      const saved = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        budget: { maxInvestigations: 3, maxCostCents: 0 },
      });
      const worker = createAssessmentWorker({
        queue,
        domain: service,
        dispatch: async (a, scope) => {
          const receipt = await deliver(a.id, {
            dispatchId: scope.dispatchId,
            expectedEpoch: scope.expectedEpoch,
          });
          if (!('sessionId' in receipt)) throw new Error('Missing research receipt');
          return receipt;
        },
      });
      assert.equal((await worker.tick()).kind, 'retry');
      assert.equal((await queue.status(owner, saved.id))?.status, 'pending');
      assert.equal((await service.getAssessment(owner, saved.id))?.investigations.length, 0);
      await start();
      let recoveredSession = '';
      await until(async () => {
        const result = await worker.tick();
        if (result.kind === 'dispatched') recoveredSession = result.sessionId;
        return Boolean(recoveredSession);
      });
      await until(async () =>
        (await events(saved.id)).some(
          (e) => e.sessionId === recoveredSession && e.type === 'turn.completed',
        ),
      );
      const recovered = (await service.getAssessment(owner, saved.id))!;
      assert.equal(recovered.investigations.length, 3);
      assert.equal((await queue.status(owner, saved.id))?.status, 'completed');
      results.push({
        name: 'outbox-recovers-real-runtime-outage',
        checks: [
          'assessment and research intent survive runtime outage',
          'worker retries after runtime returns without a browser click',
          'real Eve tools settle the durable queue after bounded research',
        ],
        assessment: recovered,
        events: await events(saved.id),
        sessionId: recoveredSession,
      });
    }
    const standard = await service.createAssessment(owner, {
      seedLotId: 'sf90-front-il',
      mode: 'fixture',
      fixtureCaseId: 'standard',
      budget: { maxInvestigations: 3, maxCostCents: 0 },
    });
    // Admission is an authority decision on the framework channel: an absent
    // credential and an unusable scope are 401, a refused scope is 403.
    assert.equal((await probe({})).status, 401);
    assert.equal((await probe({}, '/eve/v1/session/wrun_absent')).status, 401);
    assert.equal((await probe({ authorization: `Bearer ${token}` })).status, 401);
    assert.equal(
      (await probe(bridge(standard.id, standard.epoch, 'someone-else'))).status,
      403,
      'another owner cannot reach an owned assessment',
    );
    assert.equal(
      (await probe(bridge(standard.id, standard.epoch + 5))).status,
      403,
      'a superseded epoch cannot open a session',
    );
    assert.equal((await fetch(`${base}/eve/v1/health`)).status, 200);
    const liveAssessment = await service.createAssessment(owner, {
      seedLotId: 'sf90-front-il',
      mode: 'live',
      budget: { maxInvestigations: 1, maxCostCents: 0 },
    });
    assert.equal(
      (await probe(bridge(liveAssessment.id, liveAssessment.epoch))).status,
      403,
      'live evidence stays closed until it is acknowledged',
    );
    assert.deepEqual(await deliver(liveAssessment.id, { cancel: true }), { cancelled: true });
    assert.equal((await events(liveAssessment.id)).length, 0);
    await service.stopAssessment(
      owner,
      liveAssessment.id,
      'Live evidence intentionally disabled in eval',
      liveAssessment.revision,
    );
    const standardRun = await run(standard);
    assert.equal(standardRun.assessment.status, 'stopped');
    assert.equal(standardRun.assessment.investigations.length, 3);
    assert(standardRun.assessment.evidence.length > 0);
    assert(standardRun.assessment.history.length > 3);
    assert(standardRun.events.some((e) => e.type === 'actions.requested'));
    results.push({
      name: 'bounded-investigation-and-auth',
      checks: [
        'the framework channel refuses an absent credential, an unusable scope and another owner',
        'an anonymous POST is refused by both the create and the session route',
        'actual tools persist evidence and decision revisions',
      ],
      ...standardRun,
    });
    if (live)
      for (let trial = 2; trial <= trials; trial++) {
        const fresh = await service.createAssessment(owner, {
          seedLotId: 'sf90-front-il',
          mode: 'fixture',
          fixtureCaseId: 'standard',
          budget: { maxInvestigations: 3, maxCostCents: 0 },
        });
        const result = await run(fresh);
        assert.equal(result.assessment.status, 'stopped');
        assert(result.assessment.investigations.length <= 3);
        assert.equal(result.assessment.decision.ceiling, null);
        results.push({
          name: `live-policy-trial-${trial}`,
          checks: [
            'fresh model session preserves budget and evidence authority against local inputs',
          ],
          ...result,
        });
      }
    if (!live) {
      const duplicate = await run(standardRun.assessment);
      assert.equal(duplicate.assessment.investigations.length, 3);
      assert.equal(duplicate.sessionId, standardRun.sessionId);
      results.push({
        name: 'duplicate-continuation',
        checks: ['same durable session resumes', 'completed work is not investigated twice'],
        ...duplicate,
      });
      const wrong = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'wrong-car',
        budget: { maxInvestigations: 2, maxCostCents: 0 },
      });
      const wrongRun = await run(wrong);
      assert(wrongRun.assessment.evidence.length > 0);
      assert(wrongRun.assessment.evidence.every((e) => e.status === 'rejected'));
      assert.equal(wrongRun.assessment.decision.ceiling, null);
      results.push({
        name: 'wrong-car-evidence',
        checks: ['wrong-subject observations persist as rejected', 'no authoritative bid ceiling'],
        ...wrongRun,
      });
      const zero = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        budget: { maxInvestigations: 1, maxCostCents: 0 },
      });
      const zeroRun = await run(zero);
      assert.equal(zeroRun.assessment.investigations.length, 1);
      assert.equal(zeroRun.assessment.status, 'stopped');
      results.push({
        name: 'exhausted-budget',
        checks: ['single investigation budget is enforced by domain'],
        ...zeroRun,
      });
      const candidate = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'ready-candidate',
        // Stated in full so a moving product default cannot move a fixture.
        buyer: {
          preset: 'custom',
          jurisdiction: 'US-CA',
          access: 'broker',
          exit: 'private_party',
          discipline: 0.75,
          capabilities: {
            tools: true,
            workspace: true,
            lift: true,
            diagnostics: true,
            specialistAccess: true,
            structural: false,
            paint: false,
            alignment: false,
            hv: false,
          },
          laborRatePerHour: 25,
          availableDiyHours: 400,
          holdingDays: 90,
          holdingCostPerDay: 10,
          maxAllIn: 600000,
          minSurplus: 10000,
        },
        budget: { maxInvestigations: 6, maxCostCents: 0 },
      });
      const candidateRun = await run(candidate);
      assert.equal(
        candidateRun.assessment.decision.ceiling,
        null,
        'agent cannot grant owner evidence acceptance',
      );
      const reviewed = await service.reviewEvidence(owner, candidate.id, {
        evidenceIds: candidateRun.assessment.evidence
          .filter((e) =>
            ['title', 'registration', 'inspection', 'repair_price', 'comp'].includes(e.kind),
          )
          .map((e) => e.id),
        expectedRevision: candidateRun.assessment.revision,
        idempotencyKey: 'synthetic-review',
        rationale:
          'Synthetic evaluation only: independently specified complete source bundle, not a real vehicle clearance',
      });
      assert.equal(reviewed.decision.readiness, 'ready');
      assert.equal(reviewed.decision.verdict, 'build');
      assert(reviewed.decision.ceiling! > 0);
      assert.equal(reviewed.status, 'stopped', 'a supported decision ends further research');
      results.push({
        name: 'complete-equipped-enthusiast-decision',
        checks: [
          'actual Eve gathers the synthetic evidence bundle',
          'agent leaves physical/title/eligibility review to an accountable owner',
          'review completes a positive buyer-specific decision and stops research',
        ],
        ...candidateRun,
        assessment: reviewed,
      });
      // The same recorded lot for a different bidder: a decision saved by the
      // real runtime carries both ceilings and the edge between them (SPEC 60).
      const shopLot = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'ready-candidate',
        // The `shop` preset's values, written out rather than spread, so a
        // moving product default cannot move a fixture. The jurisdiction is
        // this fixture's registration record: a preset states resources and an
        // exit, never where the buyer registers the car.
        buyer: {
          preset: 'shop',
          jurisdiction: 'US-CA',
          access: 'direct',
          exit: 'wholesale',
          discipline: 0.75,
          capabilities: {
            tools: true,
            workspace: true,
            lift: true,
            diagnostics: true,
            specialistAccess: true,
            structural: true,
            paint: true,
            alignment: true,
            hv: false,
          },
          laborRatePerHour: 75,
          availableDiyHours: 300,
          holdingDays: 45,
          holdingCostPerDay: 25,
          maxAllIn: 150000,
          minSurplus: 15000,
        },
        budget: { maxInvestigations: 6, maxCostCents: 0 },
      });
      const shopRun = await run(shopLot);
      const shopReviewed = await service.reviewEvidence(owner, shopLot.id, {
        evidenceIds: shopRun.assessment.evidence
          .filter((e) =>
            ['title', 'registration', 'inspection', 'repair_price', 'comp'].includes(e.kind),
          )
          .map((e) => e.id),
        expectedRevision: shopRun.assessment.revision,
        idempotencyKey: 'synthetic-review',
        rationale:
          'Synthetic evaluation only: independently specified complete source bundle, not a real vehicle clearance',
      });
      assert.equal(shopReviewed.decision.readiness, 'ready');
      const shopEconomics = shopReviewed.decision.buyerEconomics;
      assert(shopEconomics, 'a saved decision over a plan and an exit anchor carries economics');
      assert.equal(typeof shopEconomics.market.maxBid, 'number');
      assert.equal(typeof shopEconomics.edge, 'number');
      assert.equal(shopEconomics.edge, shopEconomics.maxBid - shopEconomics.market.maxBid!);
      assert.match(shopEconomics.market.basis, /professional rebuilder/);
      // The room's price on this recorded lot, as the saved decision carries
      // it: a persona that stopped being solved through the same ledger would
      // move this number rather than merely change its sign.
      assert.equal(shopEconomics.market.maxBid, 144_500);
      // The shop preset's $150,000 cash arm cannot reach an exotic rebuild the
      // room bids into, so the edge is a real difference between two solves. A
      // persona that collapsed onto the buyer would report zero here.
      assert(
        shopEconomics.edge! < 0,
        `expected the shop seat's ceiling below the market's; got ${shopEconomics.maxBid} against ${shopEconomics.market.maxBid}`,
      );
      results.push({
        name: 'shop-preset-carries-market-and-edge',
        checks: [
          'a stated shop profile reaches the runtime and prices the recorded lot',
          'the saved decision carries the market ceiling and the edge beside the buyer’s own',
          'the market basis names the professional rebuilder whose ceiling it is',
          'the edge is a difference between two solves, not a persona collapsed onto the buyer',
          'the persisted market ceiling holds its solved number ($144,500)',
        ],
        ...shopRun,
        assessment: shopReviewed,
      });
      const changing = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'changed-comps',
        budget: { maxInvestigations: 12, maxCostCents: 0 },
      });
      // Prepare an as-of baseline, then exercise changed evidence through the actual runtime.
      let baseline = changing;
      for (const kind of ['vin_identity', 'photo_triage', 'market_comps']) {
        const action = baseline.offeredActions.find((a) => a.kind === kind);
        assert(action);
        baseline = await service.investigateAssessment(
          owner,
          baseline.id,
          action.id,
          baseline.revision,
          `baseline-${kind}`,
        );
      }
      const firstRun = { assessment: baseline, sessionId: 'baseline-domain-only' };
      const refresh = await service.refreshAssessment(
        owner,
        changing.id,
        firstRun.assessment.revision,
        'eval-refresh',
        { actionKinds: ['market_comps'] },
      );
      const changedRun = await run(refresh);
      assert(changedRun.assessment.history.length > firstRun.assessment.history.length);
      assert(changedRun.assessment.epoch > firstRun.assessment.epoch);
      assert.notEqual(changedRun.sessionId, firstRun.sessionId);
      assert.equal(changedRun.assessment.id, firstRun.assessment.id);
      assert(
        changedRun.assessment.decision.report!.ledger!.exit!.typical <
          firstRun.assessment.decision.report!.ledger!.exit!.typical,
      );
      results.push({
        name: 'changed-evidence',
        checks: [
          'refresh retains earlier decision history',
          'refresh opens a new bounded session for the same durable assessment',
          'changed recorded observations change the deterministic exit estimate',
        ],
        ...changedRun,
      });
      let continuing = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'standard',
        budget: { maxInvestigations: 12, maxCostCents: 0 },
      });
      for (const kind of ['vin_identity', 'photo_triage', 'market_comps']) {
        const action = continuing.offeredActions.find((a) => a.kind === kind);
        assert(action);
        continuing = await service.investigateAssessment(
          owner,
          continuing.id,
          action.id,
          continuing.revision,
          `initial-${kind}`,
        );
      }
      const identityIds = continuing.evidence.filter((e) => e.kind === 'identity').map((e) => e.id);
      const epochSessions = new Set<string>();
      let continuingRun: Awaited<ReturnType<typeof run>> | undefined;
      for (let epoch = 1; epoch <= 3; epoch++) {
        continuing = await service.refreshAssessment(
          owner,
          continuing.id,
          continuing.revision,
          `epoch-refresh-${epoch}`,
          { actionKinds: ['market_comps'] },
        );
        continuingRun = await run(continuing);
        continuing = continuingRun.assessment;
        epochSessions.add(continuingRun.sessionId);
        assert.equal(continuing.epoch, epoch);
        assert.equal(continuing.budget.maxInvestigations, 12);
        assert.equal(continuing.budget.usedInvestigations, 3 + epoch);
        assert.deepEqual(
          continuing.evidence.filter((e) => e.kind === 'identity').map((e) => e.id),
          identityIds,
        );
      }
      assert(continuingRun);
      assert.equal(epochSessions.size, 3);
      for (const sessionId of epochSessions)
        assert(
          continuingRun.events.filter(
            (event) => event.sessionId === sessionId && event.type === 'step.completed',
          ).length <= 12,
        );
      results.push({
        name: 'selective-epochs-preserve-evidence-and-budget',
        checks: [
          'three market refresh epochs use three bounded Eve sessions',
          'fresh VIN evidence is retained without another identity call',
          'six total investigations leave six in the lifetime budget',
        ],
        ...continuingRun,
      });
      const stale = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'stale',
        budget: { maxInvestigations: 2, maxCostCents: 0 },
      });
      const staleRun = await run(stale);
      assert(staleRun.assessment.evidence.length > 0);
      assert(
        staleRun.assessment.evidence
          .filter((e) => e.kind === 'triage')
          .every((e) => e.status === 'unverified'),
      );
      assert.equal(staleRun.assessment.decision.ceiling, null);
      results.push({
        name: 'stale-observations',
        checks: [
          'stale damage observations are quarantined; structural VIN decode remains separately labeled',
          'stale observations do not authorize a bid',
        ],
        ...staleRun,
      });
      const interrupted = await service.createAssessment(owner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'interrupted',
        budget: { maxInvestigations: 3, maxCostCents: 0 },
      });
      const interruptedClaim = await queue.claim();
      assert.equal(interruptedClaim?.assessmentId, interrupted.id);
      const interruptedReceipt = await deliver(interrupted.id, {
        dispatchId: interruptedClaim!.dispatchId,
        expectedEpoch: interrupted.epoch,
      });
      assert('sessionId' in interruptedReceipt);
      await queue.running(interruptedClaim!, interruptedReceipt.sessionId);
      await until(async () =>
        (await events(interrupted.id)).some((e) => e.type === 'action.result'),
      );
      assert.deepEqual(await deliver(interrupted.id, { cancel: true }), { cancelled: true });
      await until(async () =>
        (await events(interrupted.id)).some((e) => e.type === 'turn.cancelled'),
      );
      const interruptedSession = (await events(interrupted.id))[0].sessionId;
      await stop();
      await start();
      const resumed = await run((await service.getAssessment(owner, interrupted.id))!);
      assert.equal(resumed.sessionId, interruptedSession);
      assert.equal(resumed.assessment.status, 'stopped');
      assert.equal(
        new Set(resumed.assessment.investigations.map((i) => i.action.id)).size,
        resumed.assessment.investigations.length,
      );
      results.push({
        name: 'interrupted-turn-restart-continuation',
        checks: [
          'actual active Eve turn cancelled through the session route',
          'same durable session continues after process restart',
          'completed investigations are not duplicated',
        ],
        ...resumed,
      });
      const revision = changedRun.assessment.revision;
      await assert.rejects(service.stopAssessment(owner, changing.id, 'stale write', revision - 1));
      assert.equal((await service.getAssessment(owner, changing.id))?.revision, revision);
      // Process restart preserves both independent assessment state and the Eve workflow stream.
      await stop();
      await start();
      assert.equal((await service.getAssessment(owner, standard.id))?.id, standard.id);
      const afterRestart = await events(standard.id);
      assert(afterRestart.some((e) => e.sessionId === standardRun.sessionId));
      results.push({
        name: 'restart-persistence-and-stale-write',
        checks: [
          'persisted runtime actions survive process restart',
          'stale revision does not mutate assessment',
        ],
        ...duplicate,
      });
      // The run route and the schedule both address the agent through this
      // process's own environment, exactly as a deployment does (SPEC 57).
      process.env.PADDOCK_AGENT_TOKEN = token;
      process.env.PADDOCK_AGENT_URL = base;
      process.env.PADDOCK_AGENT_MODE = mode;
      process.env.PADDOCK_AGENT_ALLOW_LIVE_EVIDENCE = '';
      // Local development without auth variables resolves every caller to
      // `local`, which is the owner the route handler reads from the session.
      const routeOwner = 'local';
      const dispatched = await service.createAssessment(routeOwner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'standard',
        budget: { maxInvestigations: 3, maxCostCents: 0 },
      });
      // The route may meet a runtime that has just restarted. Every answer it
      // gives is checked: acceptance requires a recorded session, and a refusal
      // names a reason and leaves the intent saved (SPEC 57).
      const refusals: string[] = [];
      await until(async () => {
        const answer = await assessmentAction(
          new Request(`http://127.0.0.1/api/assessments/${dispatched.id}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              expectedRevision: dispatched.revision,
              idempotencyKey: 'inline-run',
            }),
          }),
          dispatched.id,
          'run',
        );
        assert.equal(answer.status, 202);
        const research = (
          (await answer.json()) as {
            research: { accepted: boolean; queued: boolean; status?: string; reason?: string };
          }
        ).research;
        assert.equal(research.queued, true);
        if (!research.accepted) {
          assert(research.reason, 'a refused run names why it could not start');
          assert(await queue.status(routeOwner, dispatched.id), 'a refused run keeps its intent');
          refusals.push(research.reason);
          return false;
        }
        assert.equal(research.reason, undefined);
        assert.equal(research.status, 'running');
        return true;
      });
      const inlineSession = (await queue.status(routeOwner, dispatched.id))?.sessionId;
      assert(
        inlineSession,
        `an accepted run recorded the session it received (refusals: ${refusals.join(',')})`,
      );
      await until(async () =>
        (await listActivity(routeOwner, dispatched.id)).some(
          (e) => e.sessionId === inlineSession && e.type === 'turn.completed',
        ),
      );
      const inlineAssessment = (await service.getAssessment(routeOwner, dispatched.id))!;
      assert.equal(inlineAssessment.investigations.length, 3);
      results.push({
        name: 'inline-run-dispatches-and-accepts',
        checks: [
          'the run route starts a real session inline and answers accepted only then',
          'an inline dispatch records the received session and completes bounded research',
        ],
        assessment: inlineAssessment,
        events: await listActivity(routeOwner, dispatched.id),
        sessionId: inlineSession,
      });
      // A saved intent nobody delivered is picked up by the deployment's
      // schedule: the authored handler is invoked exactly as cron invokes it.
      // The expression is resolved at build time from PADDOCK_DISPATCH_CRON, so
      // an environment that does not set it must carry the Hobby-safe default.
      assert.match(dispatchSchedule.cron, /^(\S+\s+){4}\S+$/);
      if (!process.env.PADDOCK_DISPATCH_CRON) assert.equal(dispatchSchedule.cron, '0 6 * * *');
      const scheduled = await service.createAssessment(routeOwner, {
        seedLotId: 'sf90-front-il',
        mode: 'fixture',
        fixtureCaseId: 'standard',
        budget: { maxInvestigations: 3, maxCostCents: 0 },
      });
      assert.equal((await queue.status(routeOwner, scheduled.id))?.status, 'pending');
      let scheduledSession: string | undefined;
      await until(async () => {
        const tasks: Promise<unknown>[] = [];
        // A schedule handler receives `to`, `waitUntil` and `appAuth`; this one
        // reads only `waitUntil`, and the cron task awaits what it registers.
        await dispatchSchedule.run({
          waitUntil: (task: Promise<unknown>) => {
            tasks.push(task);
          },
        } as ScheduleHandlerArgs);
        await Promise.all(tasks);
        scheduledSession = (await queue.status(routeOwner, scheduled.id))?.sessionId;
        return Boolean(scheduledSession);
      });
      await until(async () =>
        (await listActivity(routeOwner, scheduled.id)).some(
          (e) => e.sessionId === scheduledSession && e.type === 'turn.completed',
        ),
      );
      const scheduledAssessment = (await service.getAssessment(routeOwner, scheduled.id))!;
      assert.equal(scheduledAssessment.investigations.length, 3);
      assert.notEqual(scheduledSession, inlineSession);
      results.push({
        name: 'schedule-drains-saved-intents',
        checks: [
          'the authored eve schedule delivers a saved intent with no daemon running',
          'schedule delivery opens its own bounded session and finishes the research',
        ],
        assessment: scheduledAssessment,
        events: await listActivity(routeOwner, scheduled.id),
        sessionId: scheduledSession!,
      });
      // A lot the user brought, through the real runtime: parsed from pasted
      // text, screened, and never inheriting a seeded lot's evidence (SPEC 61).
      const brought = await service.createAssessment(owner, {
        intake: { text: COPART_COMPLETE, photoUrls: SALVAGE_LOTS[0].photos.slice(0, 12) },
        mode: 'fixture',
        fixtureCaseId: 'standard',
        budget: { maxInvestigations: 3, maxCostCents: 0 },
      });
      assert.equal(brought.lot.source, 'user-supplied listing');
      assert.equal(
        brought.lot.url,
        undefined,
        'no listing page was supplied and none was invented',
      );
      assert.equal(brought.lot.vin, SALVAGE_LOTS[0].vin);
      const chips = brought.lotAssumptions ?? [];
      assert(chips.length > 10, 'every field the reading filled is a chip');
      assert(chips.some((chip) => chip.source === 'intake'));
      assert(chips.some((chip) => chip.source === 'llm'));
      const broughtRun = await run(brought);
      assert.equal(broughtRun.assessment.lot.source, 'user-supplied listing');
      assert.equal(broughtRun.assessment.investigations.length, 3);
      assert.equal(
        broughtRun.assessment.evidence.length,
        0,
        'a user-supplied lot inherits no seeded evidence',
      );
      assert(
        broughtRun.assessment.decision.residualRisks?.includes(
          'Listing details were typed or pasted by the owner and not captured from the auction page',
        ),
        'the decision states that the listing was typed rather than captured',
      );
      results.push({
        name: 'user-supplied-lot-intake',
        checks: [
          'a lot pasted as listing text reaches the runtime with its user provenance intact',
          'the reading is saved as chips naming the pass that filled each field',
          'no listing page was fetched and no seeded evidence was inherited',
          'the decision carries the owner-typed listing as a residual risk',
        ],
        ...broughtRun,
      });

      // A lot whose sale has already happened. The deployment's third schedule
      // phase asks what it made — once, in the activity log, with no session and
      // no model — and the answer records the market's price even though this
      // owner did not buy (SPEC 62).
      const settled = await service.createAssessment(owner, {
        // The shape a listing states: a calendar day, three days back, so the
        // day it names has fully closed (SPEC 62).
        lot: {
          ...SALVAGE_LOTS[0],
          saleDate: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
        },
        mode: 'fixture',
        fixtureCaseId: 'ready-candidate',
        // The hobbyist seat, stated in full so a moving product default cannot
        // move a fixture.
        buyer: {
          preset: 'custom',
          jurisdiction: 'US-CA',
          access: 'broker',
          exit: 'private_party',
          discipline: 0.75,
          capabilities: {
            tools: true,
            workspace: true,
            lift: true,
            diagnostics: true,
            specialistAccess: true,
            structural: false,
            paint: false,
            alignment: false,
            hv: false,
          },
          laborRatePerHour: 25,
          availableDiyHours: 400,
          holdingDays: 90,
          holdingCostPerDay: 10,
          maxAllIn: 600000,
          minSurplus: 10000,
        },
        budget: { maxInvestigations: 6, maxCostCents: 0 },
      });
      const settledRun = await run(settled);
      const settledDecision = await service.reviewEvidence(owner, settled.id, {
        evidenceIds: settledRun.assessment.evidence
          .filter((e) =>
            ['title', 'registration', 'inspection', 'repair_price', 'comp'].includes(e.kind),
          )
          .map((e) => e.id),
        expectedRevision: settledRun.assessment.revision,
        idempotencyKey: 'synthetic-review',
        rationale:
          'Synthetic evaluation only: independently specified complete source bundle, not a real vehicle clearance',
      });
      assert.equal(settledDecision.decision.readiness, 'ready');
      const deskWorker = createAssessmentWorker({
        queue,
        domain: service,
        dispatch: async () => {
          throw new Error('the outcome phase starts no research session');
        },
      });
      // The count covers every lot the eval database has made due, so this case
      // asserts its own assessment's log rather than that total.
      const prompts = async () =>
        (await events(settled.id)).filter((e) => e.type === OUTCOME_PROMPT_EVENT);
      await deskWorker.promptOutcomes();
      const asked = await prompts();
      assert.equal(asked.length, 1, 'the desk asked exactly once');
      assert.equal(asked[0].sessionId, SCHEDULE_SESSION);
      assert.equal(asked[0].modelMode, 'no-model');
      assert.deepEqual(asked[0].data, { message: OUTCOME_PROMPT_MESSAGE });
      // A second fire inside the week adds nothing for this assessment.
      await deskWorker.promptOutcomes();
      assert.equal((await prompts()).length, 1);
      const answered = await service.recordOutcome(owner, settled.id, {
        kind: 'lost_to_hammer',
        hammer: 141_000,
        note: 'Sold to another bidder at the Illinois sale',
        decisionRevision: settledDecision.decision.revision,
        expectedRevision: settledDecision.revision,
        idempotencyKey: 'settled-outcome',
      });
      assert.deepEqual(
        { kind: answered.outcomes[0].kind, hammer: answered.outcomes[0].hammer },
        { kind: 'lost_to_hammer', hammer: 141_000 },
        'the winning bid persists as its own figure on a lot the owner did not buy',
      );
      await deskWorker.promptOutcomes();
      assert.equal((await prompts()).length, 1, 'an answered assessment is never asked again');
      results.push({
        name: 'outcome-prompt-after-the-sale',
        checks: [
          'a lot whose sale date has passed is asked about once, in the durable activity log',
          'the prompt spends no research session and no model call',
          'a second fire inside the week records nothing further',
          'a pass the market answered persists its winning bid and stops the asking',
        ],
        assessment: answered,
        events: await events(settled.id),
        sessionId: settledRun.sessionId,
      });
    }
    const artifact = {
      generatedAt: new Date().toISOString(),
      trials,
      runtime: 'eve@0.52.2 over HTTP',
      mode,
      model: live ? process.env.PADDOCK_AGENT_MODEL : 'paddock-offered-actions-v1',
      tokenProvenance: live
        ? 'provider-reported usage in step.completed; paid coordinator only'
        : 'synthetic fixture token estimates; zero provider calls and zero provider spend',
      scope:
        'Local recorded/synthetic vehicle evidence; no network research, vision, purchasing or outreach',
      cases: results.map((result) => ({
        ...result,
        assessment: {
          id: result.assessment.id,
          mode: result.assessment.mode,
          fixtureCaseId: result.assessment.fixtureCaseId,
          revision: result.assessment.revision,
          epoch: result.assessment.epoch,
          status: result.assessment.status,
          stopReason: result.assessment.stopReason,
          budget: result.assessment.budget,
          evidence: result.assessment.evidence,
          investigations: result.assessment.investigations,
          decision: compactDecision(result.assessment.decision),
          history: result.assessment.history.map(compactDecision),
        },
      })),
    };
    await mkdir('evals/agent', { recursive: true });
    const stem = live ? 'live-results' : 'results';
    await writeFile(`evals/agent/${stem}.json`, JSON.stringify(artifact, null, 2) + '\n');
    await writeFile(
      `evals/agent/${stem}.md`,
      [
        `# Agent runtime evals`,
        ``,
        `Runtime: ${artifact.runtime}. Mode: ${mode}.`,
        `Generated: ${artifact.generatedAt}. Live trials requested: ${live ? trials : 0}.`,
        ``,
        artifact.tokenProvenance,
        ``,
        ...results.flatMap((r) => [
          `## ${r.name}`,
          ``,
          ...r.checks.map((c) => `- PASS: ${c}`),
          ``,
          // The session id is new on every run and would make the committed
          // artifact differ from a re-run on every line; it stays in the
          // gitignored JSON, where the run that produced it is read
          // (docs/testing-and-evals.md §3.3).
          `Revision: ${r.assessment.revision}; investigations: ${r.assessment.investigations.length}; evidence: ${r.assessment.evidence.length}.`,
          ``,
        ]),
      ].join('\n'),
    );
    console.log(
      `${results.length} actual-runtime cases passed; artifacts: evals/agent/${stem}.{json,md}`,
    );
  } finally {
    await stop();
    client.close();
    await writeFile(path.join(directory, 'runtime.log'), log);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function compactDecision(decision: AssessmentDecision) {
  const { report, ...summary } = decision;
  const exit = report?.ledger?.exit;
  return {
    ...summary,
    exitEstimate: exit
      ? { low: exit.low, typical: exit.typical, high: exit.high, lane: exit.lane }
      : null,
  };
}
async function unusedPort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
