/** Public assessment behavior: ownership, evidence authority and bounded durable work. */
import { describe, expect, it } from 'vitest';
import { createAssessmentService } from './service';
import { MemoryAssessmentStore } from './store';
import { createFixtureInvestigator } from './fixtures';
import { AssessmentError, type AssessmentInvestigator, type AssessmentStore } from './types';
import { BUYER_PRESETS, DEFAULT_BUYER_PROFILE } from './buyer-profile';
import { UNUSABLE_LOT, USER_LOT_SOURCE } from './intake';
import { COPART_COMPLETE, COPART_MINIMAL, IAA_SPARSE } from './intake-fixtures/listings';

const now = () => new Date('2026-09-06T00:00:00Z');
const setup = (investigator?: AssessmentInvestigator) =>
  createAssessmentService({
    store: new MemoryAssessmentStore(),
    now,
    investigator: investigator ?? createFixtureInvestigator(),
  });

describe('persistent assessment domain', () => {
  it('imports seed input idempotently and scopes every operation to its owner (SPEC 46)', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      idempotencyKey: 'create-one',
    });
    expect(
      (
        await service.createAssessment('alice', {
          seedLotId: 'sf90-front-il',
          idempotencyKey: 'create-one',
        })
      ).id,
    ).toBe(a.id);
    expect(await service.getAssessment('bob', a.id)).toBeNull();
    expect(await service.listAssessments('bob')).toEqual([]);
    await expect(
      service.investigateAssessment('bob', a.id, 'vin_identity:0', a.revision),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(a.decision.verdict).toBe('needs_evidence');
    expect(a.decision.ceiling).toBeNull();
  });
  it('validates manual lots and refuses fixture evidence for a different car (SPEC 47)', async () => {
    const service = setup();
    await expect(
      service.createAssessment('alice', { lot: { year: -1 } as never }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      fixtureCaseId: 'wrong-car',
    });
    const b = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions[0].id,
      a.revision,
    );
    expect(b.evidence.some((e) => e.status === 'rejected' && /subject/i.test(e.reason))).toBe(true);
    expect(b.decision.ceiling).toBeNull();
  });
  it('reserves before calling adapters, rejects stale work, and replays duplicates without another call (SPEC 48)', async () => {
    let calls = 0;
    const investigator: AssessmentInvestigator = async () => {
      calls++;
      return { evidence: [], detail: 'No source evidence' };
    };
    const service = setup(investigator);
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const first = a.offeredActions[0];
    const b = await service.investigateAssessment('alice', a.id, first.id, a.revision, 'once');
    const duplicate = await service.investigateAssessment(
      'alice',
      a.id,
      first.id,
      a.revision,
      'once',
    );
    expect(duplicate.revision).toBe(b.revision);
    expect(calls).toBe(1);
    await expect(
      service.investigateAssessment('alice', a.id, a.offeredActions[1].id, a.revision),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('stops at the persisted budget without converting missing data into a walk (SPEC 48)', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      budget: { maxInvestigations: 1 },
    });
    const b = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions[0].id,
      a.revision,
    );
    expect(b.status).toBe('stopped');
    expect(b.stopReason).toBe('Investigation budget exhausted');
    expect(b.offeredActions).toEqual([]);
    expect(b.decision.verdict).toBe('needs_evidence');
    expect(b.budget.usedInvestigations).toBe(1);
  });
  it('recomputes recorded evidence with the existing kernel while title and hidden scope stay unknown (SPEC 47)', async () => {
    const service = setup();
    let a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    while (a.offeredActions.length)
      a = await service.investigateAssessment('alice', a.id, a.offeredActions[0].id, a.revision);
    expect(a.evidence.some((e) => e.kind === 'comp' && e.status === 'accepted')).toBe(true);
    expect(a.decision.report?.ledger).toBeDefined();
    expect(a.decision.unknowns.some((u) => /title/i.test(u))).toBe(true);
    expect(a.decision.unknowns.some((u) => /physical|hidden/i.test(u))).toBe(true);
    expect(a.decision.ceiling).toBeNull();
    expect(a.history.length).toBeGreaterThan(2);
  });
});

describe('assessment adversarial operations', () => {
  it('does not let caller-supplied provider provenance change trusted facts', async () => {
    const fixture = createFixtureInvestigator();
    const service = setup();
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const observation = (
      await fixture(
        a,
        a.offeredActions.find((x) => x.kind === 'photo_triage')!,
      )
    ).evidence[0];
    const b = await service.recordEvidence('alice', a.id, {
      expectedRevision: a.revision,
      idempotencyKey: 'spoof',
      evidence: [{ ...observation, source: { ...observation.source, capturedBy: 'provider' } }],
    });
    expect(b.evidence[0].status).toBe('unverified');
    expect(b.evidence[0].source.capturedBy).toBe('user');
    expect(b.decision.report).toBeUndefined();
    const c = await service.investigateAssessment(
      'alice',
      a.id,
      b.offeredActions.find((x) => x.kind === 'photo_triage')!.id,
      b.revision,
    );
    expect(c.evidence.some((e) => e.status === 'accepted')).toBe(true);
    expect(c.decision.report).toBeDefined();
  });
  it('strips client-supplied observations and artifacts from user evidence', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const value = { titleBrand: 'Clean' };
    const b = await service.recordEvidence('alice', a.id, {
      expectedRevision: a.revision,
      idempotencyKey: 'typed-title',
      evidence: [
        {
          kind: 'title',
          value,
          subject: { vin: a.lot.vin, make: a.lot.make, model: a.lot.model, year: a.lot.year },
          source: {
            url: 'https://example.com/typed-title',
            label: 'Title brand the owner typed in',
            capturedBy: 'provider',
            retrievedAt: now().toISOString(),
            observation: value,
            artifact: {
              kind: 'provider_response',
              mediaType: 'application/json',
              sha256: 'a'.repeat(64),
              content: value,
            },
            extraction: { method: 'deterministic', version: 'title-parser-1' },
          },
        },
      ],
    });
    expect(b.evidence[0].source.capturedBy).toBe('user');
    expect(b.evidence[0].source.observation).toBeUndefined();
    expect(b.evidence[0].source.artifact).toBeUndefined();
    expect(b.evidence[0].source.extraction).toBeUndefined();
    expect(b.evidence[0].status).toBe('unverified');
    expect(b.decision.gates?.find((g) => g.id === 'title')?.status).toBe('missing');
  });
  it('review accepts a self-attested price with an https source and no artifact', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      fixtureCaseId: 'ready-candidate',
    });
    const triaged = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions.find((x) => x.kind === 'photo_triage')!.id,
      a.revision,
    );
    const line = triaged.decision.report!.plan.lines.find((l) => l.who === 'pro')!;
    const recorded = await service.recordEvidence('alice', a.id, {
      expectedRevision: triaged.revision,
      idempotencyKey: 'typed-quote',
      evidence: [
        {
          kind: 'repair_price',
          value: {
            line: line.id,
            item: `Whole job: ${line.task}`,
            kind: 'job_quote',
            low: 5000,
            high: 10000,
            url: 'https://example.com/typed-quote',
            source: 'example.com',
          },
          subject: { vin: a.lot.vin, make: a.lot.make, model: a.lot.model, year: a.lot.year },
          source: {
            url: 'https://example.com/typed-quote',
            label: 'Quote the owner typed from a shop estimate',
            capturedBy: 'user',
            retrievedAt: now().toISOString(),
          },
        },
      ],
    });
    const quote = recorded.evidence.at(-1)!;
    expect(quote.source.observation).toBeUndefined();
    expect(quote.status).toBe('unverified');
    const reviewed = await service.reviewEvidence('alice', a.id, {
      evidenceIds: [quote.id],
      rationale: 'Owner attests to the shop estimate behind this typed quote',
      expectedRevision: recorded.revision,
      idempotencyKey: 'review-typed-quote',
    });
    const accepted = reviewed.evidence.find((e) => e.id === quote.id)!;
    expect(accepted.status).toBe('accepted');
    expect(accepted.review?.ownerId).toBe('alice');
  });
  it('refuses to review a self-attested comparable behind a plaintext source', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const vehicle = { make: a.lot.make, model: a.lot.model, year: a.lot.year };
    const url = 'http://example.com/owner-sale';
    const b = await service.recordEvidence('alice', a.id, {
      expectedRevision: a.revision,
      idempotencyKey: 'typed-comp',
      evidence: [
        {
          kind: 'comp',
          value: {
            lane: 'rebuilt',
            outcome: 'sold',
            title: 'rebuilt',
            price: 300000,
            year: a.lot.year,
            vehicle,
            date: '2026-09-01',
            url,
            source: 'example.com',
          },
          subject: { vin: a.lot.vin, ...vehicle },
          source: {
            url,
            label: 'Sale price the owner typed in',
            capturedBy: 'user',
            retrievedAt: now().toISOString(),
          },
        },
      ],
    });
    await expect(
      service.reviewEvidence('alice', a.id, {
        evidenceIds: [b.evidence[0].id],
        rationale: 'Owner attests to a sale they read somewhere',
        expectedRevision: b.revision,
        idempotencyKey: 'review-typed-comp',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await service.getAssessment('alice', a.id))?.evidence[0].status).toBe('unverified');
  });
  it('reserves concurrent work exactly once and returns its pending record on retries', async () => {
    let finish!: () => void;
    let calls = 0;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const service = setup(async () => {
      calls++;
      await barrier;
      return { evidence: [], detail: 'done' };
    });
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const work = service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions[0].id,
      a.revision,
      'same',
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pending = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions[0].id,
      a.revision,
      'same',
    );
    expect(pending.status).toBe('investigating');
    expect(pending.budget.usedInvestigations).toBe(1);
    expect(calls).toBe(1);
    await expect(
      service.investigateAssessment(
        'alice',
        a.id,
        a.offeredActions[1].id,
        pending.revision,
        'same',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    finish();
    expect((await work).investigations[0].status).toBe('completed');
  });
  it('a write conflict after a completed investigation keeps its evidence and bills once', async () => {
    const store = new MemoryAssessmentStore();
    let conflicts = 0;
    const contested: AssessmentStore = {
      create: (a, key, hash) => store.create(a, key, hash),
      get: (ownerId, id) => store.get(ownerId, id),
      list: (ownerId) => store.list(ownerId),
      async save(a, expectedRevision) {
        // Another writer lands its own revision first, exactly once, on the completion write.
        if (!conflicts && a.investigations.some((i) => i.status === 'completed')) {
          conflicts++;
          const concurrent = (await store.get(a.ownerId, a.id))!;
          concurrent.revision++;
          concurrent.updatedAt = '2026-09-06T00:00:01Z';
          await store.save(concurrent, expectedRevision);
          throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
        }
        return store.save(a, expectedRevision);
      },
    };
    const fixture = createFixtureInvestigator();
    const service = createAssessmentService({
      store: contested,
      now,
      // Unmetered provider capture: the full authorized allowance is billed, and only once.
      investigator: async (a, action) => {
        const { evidence, detail } = await fixture(a, action);
        return {
          evidence: evidence.map((e) => ({
            ...e,
            source: { ...e.source, capturedBy: 'provider' as const },
          })),
          detail,
        };
      },
    });
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      mode: 'live',
      budget: { maxInvestigations: 4, maxCostCents: 1000 },
    });
    const action = a.offeredActions.find((x) => x.kind === 'photo_triage')!;
    const b = await service.investigateAssessment('alice', a.id, action.id, a.revision);
    expect(conflicts).toBe(1);
    expect(b.investigations[0].status).toBe('completed');
    expect(b.investigations[0].evidenceIds.length).toBeGreaterThan(0);
    expect(b.evidence.map((e) => e.id)).toEqual(b.investigations[0].evidenceIds);
    expect(b.budget.spentCostCents).toBe(action.maxCostCents);
    expect(b.budget.reservedCostCents).toBe(0);
    expect(b.decision.report).toBeDefined();
  });
  it('three completion conflicts fall back to the failure path and bill once', async () => {
    const store = new MemoryAssessmentStore();
    let conflicts = 0;
    const contested: AssessmentStore = {
      create: (a, key, hash) => store.create(a, key, hash),
      get: (ownerId, id) => store.get(ownerId, id),
      list: (ownerId) => store.list(ownerId),
      async save(a, expectedRevision) {
        // Every completion write loses its race, so the retry budget runs out
        // and the finished result is billed as a failure that names its cause.
        if (a.investigations.some((i) => i.status === 'completed')) {
          conflicts++;
          const concurrent = (await store.get(a.ownerId, a.id))!;
          concurrent.revision++;
          await store.save(concurrent, expectedRevision);
          throw new AssessmentError('conflict', 'Assessment revision changed; read it again');
        }
        return store.save(a, expectedRevision);
      },
    };
    const service = createAssessmentService({
      store: contested,
      now,
      investigator: createFixtureInvestigator(),
    });
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      mode: 'live',
      budget: { maxInvestigations: 4, maxCostCents: 1000 },
    });
    const action = a.offeredActions.find((x) => x.kind === 'photo_triage')!;
    const b = await service.investigateAssessment('alice', a.id, action.id, a.revision);
    expect(conflicts).toBe(3);
    expect(b.investigations[0].status).toBe('failed');
    expect(b.investigations[0].detail).toBe(
      'Investigation completed but its result could not be saved after repeated conflicts; the allowance is consumed and no evidence was recorded',
    );
    expect(b.investigations[0].evidenceIds).toEqual([]);
    expect(b.evidence).toEqual([]);
    // The allowance is consumed exactly once and nothing stays reserved.
    expect(b.investigations[0].costCents).toBe(action.maxCostCents);
    expect(b.budget.spentCostCents).toBe(action.maxCostCents);
    expect(b.budget.reservedCostCents).toBe(0);
  });
  it('an identical later capture is a new observation, not a link to the earlier record', async () => {
    const price = {
      line: 'front.panels',
      item: 'Front bumper cover, OEM',
      kind: 'part_new' as const,
      low: 4000,
      high: 6000,
      url: 'https://example.com/synthetic/bumper-cover',
      source: 'example.com',
    };
    const fixture = createFixtureInvestigator();
    const service = createAssessmentService({
      store: new MemoryAssessmentStore(),
      now,
      // The same source observation, captured again at the same instant.
      investigator: async (a, action) =>
        action.kind === 'photo_triage'
          ? fixture(a, action)
          : {
              detail: 'Synthetic repeated part price',
              evidence: [
                {
                  kind: 'repair_price',
                  value: price,
                  subject: {
                    vin: a.lot.vin,
                    make: a.lot.make,
                    model: a.lot.model,
                    year: a.lot.year,
                  },
                  source: {
                    url: price.url,
                    label: 'SYNTHETIC repeated capture',
                    capturedBy: 'synthetic_fixture',
                    retrievedAt: now().toISOString(),
                    observation: { ...price },
                  },
                },
              ],
            },
    });
    let a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      budget: { maxInvestigations: 12 },
    });
    const act = async (kind: string) =>
      service.investigateAssessment(
        'alice',
        a.id,
        a.offeredActions.find((x) => x.kind === kind)!.id,
        a.revision,
      );
    // Captured before any repair plan exists: the claim addresses no active line.
    a = await act('market_comps');
    expect(a.evidence.at(-1)!.status).toBe('rejected');
    a = await act('photo_triage');
    a = await service.refreshAssessment('alice', a.id, a.revision, 'recapture', {
      actionKinds: ['market_comps'],
    });
    a = await act('market_comps');
    const repeats = a.evidence.filter((e) => e.kind === 'repair_price');
    expect(repeats).toHaveLength(2);
    expect(repeats[0].fingerprint).toBe(repeats[1].fingerprint);
    expect(repeats[0].id).not.toBe(repeats[1].id);
    expect(repeats.map((e) => e.status)).toEqual(['rejected', 'accepted']);
    expect(a.investigations.at(-1)!.evidenceIds).toEqual([repeats[1].id]);
  });
  it('recovers an expired persistent reservation without repeating the provider call', async () => {
    let clock = new Date('2026-09-06T00:00:00Z');
    let finish!: () => void;
    const store = new MemoryAssessmentStore();
    const service = createAssessmentService({
      store,
      now: () => clock,
      investigator: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { evidence: [], detail: 'late' };
      },
    });
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const work = service.investigateAssessment('alice', a.id, a.offeredActions[0].id, a.revision);
    await new Promise((resolve) => setTimeout(resolve, 5));
    clock = new Date('2026-09-06T01:00:00Z');
    const restarted = createAssessmentService({ store, now: () => clock });
    const recovered = await restarted.getAssessment('alice', a.id);
    expect(recovered?.investigations[0].status).toBe('failed');
    expect(recovered?.budget.usedInvestigations).toBe(1);
    finish();
    expect((await work).investigations[0].status).toBe('failed');
  });
  it('does not reuse fixtures merely because a manual input copies a seed identifier', async () => {
    const service = setup();
    const source = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const a = await service.createAssessment('alice', {
      lot: { ...source.lot, vin: 'WP0AA2999XS123456' },
    });
    const b = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions[0].id,
      a.revision,
    );
    expect(b.evidence).toEqual([]);
    expect(b.decision.report).toBeUndefined();
  });
  it('preserves unverified stale observations and refuses to price them', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      fixtureCaseId: 'stale',
    });
    const b = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions.find((x) => x.kind === 'photo_triage')!.id,
      a.revision,
    );
    expect(b.evidence[0].status).toBe('unverified');
    expect(b.evidence[0].reason).toMatch(/freshness/);
    expect(b.decision.report).toBeUndefined();
  });
  it('refresh changes provisional arithmetic while retaining prior decision revisions and the total budget', async () => {
    const service = setup();
    let a = await service.createAssessment('alice', {
      seedLotId: 'sf90-front-il',
      fixtureCaseId: 'changed-comps',
      budget: { maxInvestigations: 12 },
    });
    for (const kind of ['photo_triage', 'market_comps'])
      a = await service.investigateAssessment(
        'alice',
        a.id,
        a.offeredActions.find((x) => x.kind === kind)!.id,
        a.revision,
      );
    const original = a.decision.report!.ledger!.exit!.typical;
    a = await service.refreshAssessment('alice', a.id, a.revision, 'refresh');
    a = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions.find((x) => x.kind === 'market_comps')!.id,
      a.revision,
    );
    expect(a.decision.report!.ledger!.exit!.typical).toBeLessThan(original);
    expect(a.history.some((d) => d.report?.ledger?.exit?.typical === original)).toBe(true);
    expect(a.budget.usedInvestigations).toBe(3);
    expect(
      a.evidence
        .filter((e) => e.kind === 'comp')
        .every((e) => e.source.capturedBy === 'synthetic_fixture'),
    ).toBe(true);
  });
  it('records outcomes idempotently without turning a reported purchase into an external action', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const input = {
      kind: 'passed' as const,
      note: 'Manual decision after review',
      expectedRevision: a.revision,
      idempotencyKey: 'outcome',
    };
    const b = await service.recordOutcome('alice', a.id, input);
    expect((await service.recordOutcome('alice', a.id, input)).outcomes).toEqual(b.outcomes);
    expect(b.outcomes).toHaveLength(1);
  });
  it('records the winning bid on a lot the owner passed on and lost (SPEC 62)', async () => {
    const service = setup();
    const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
    const b = await service.recordOutcome('alice', a.id, {
      kind: 'lost_to_hammer',
      hammer: 141_000,
      note: 'Sold to another bidder at the Illinois sale',
      expectedRevision: a.revision,
      idempotencyKey: 'lost',
    });
    expect(b.outcomes[0]).toMatchObject({ kind: 'lost_to_hammer', hammer: 141_000 });
    // The market's price is the point of the record, so it is required.
    await expect(
      service.recordOutcome('alice', a.id, {
        kind: 'lost_to_hammer',
        note: 'Sold to another bidder, price unknown',
        expectedRevision: b.revision,
        idempotencyKey: 'lost-without-price',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'A purchased or lost lot records the winning bid as the hammer price',
    });
  });
});

it('a new synthetic title observation changes the decision to a veto and preserves the prior unknown', async () => {
  const service = setup();
  let a = await service.createAssessment('alice', {
    seedLotId: 'sf90-front-il',
    fixtureCaseId: 'changed-title',
  });
  expect(a.decision.verdict).toBe('needs_evidence');
  a = await service.refreshAssessment('alice', a.id, a.revision, 'title-refresh');
  a = await service.investigateAssessment(
    'alice',
    a.id,
    a.offeredActions.find((x) => x.kind === 'market_comps')!.id,
    a.revision,
  );
  expect(a.decision.verdict).toBe('walk');
  expect(a.decision.readiness).toBe('vetoed');
  expect(a.decision.ceiling).toBe(0);
  expect(a.evidence.find((e) => e.kind === 'title')?.source.capturedBy).toBe('synthetic_fixture');
  expect(a.history.some((d) => d.verdict === 'needs_evidence')).toBe(true);
});
it('validates source URLs as references and rejects private literals in manual photos', async () => {
  const service = setup();
  const source = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  for (const url of [
    'http://127.0.0.1/a',
    'http://169.254.169.254/a',
    'http://localhost/a',
    'http://[::1]/a',
  ])
    await expect(
      service.createAssessment('alice', { lot: { ...source.lot, photos: [url] } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
});

it('stopping pending work discards late completion and never resurrects the assessment', async () => {
  let finish!: () => void;
  const service = setup(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { evidence: [], detail: 'late completion' };
  });
  const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  const work = service.investigateAssessment('alice', a.id, a.offeredActions[0].id, a.revision);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const pending = (await service.getAssessment('alice', a.id))!;
  const stopped = await service.stopAssessment(
    'alice',
    a.id,
    'Owner stopped this assessment',
    pending.revision,
  );
  finish();
  const late = await work;
  expect(late.status).toBe('stopped');
  expect(late.revision).toBe(stopped.revision);
  expect(late.stopReason).toBe('Owner stopped this assessment');
  expect(late.investigations[0].status).toBe('failed');
  expect(late.offeredActions).toEqual([]);
});
it('refresh preserves lifetime investigation and provider allowances', async () => {
  const service = setup(async () => ({ evidence: [], detail: 'Unmetered provider invocation' }));
  const a = await service.createAssessment('alice', {
    seedLotId: 'sf90-front-il',
    mode: 'live',
    budget: { maxInvestigations: 1, maxCostCents: 300 },
  });
  const b = await service.investigateAssessment(
    'alice',
    a.id,
    a.offeredActions.find((x) => x.kind === 'photo_triage')!.id,
    a.revision,
  );
  expect(b.budget.spentCostCents).toBe(300);
  expect(b.budget.reservedCostCents).toBe(0);
  const c = await service.refreshAssessment('alice', a.id, b.revision, 'refresh-spent');
  expect(c.budget).toEqual(b.budget);
  expect(c.status).toBe('stopped');
  expect(c.offeredActions).toEqual([]);
});

it('a listing title string cannot stand in for independently captured title evidence', async () => {
  const service = setup();
  const seed = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  const a = await service.createAssessment('alice', {
    mode: 'live',
    lot: { ...seed.lot, titleBrand: 'Salvage' },
  });
  expect(a.evidence).toEqual([]);
  expect(a.decision.unknowns.some((item) => /title brand.*unverified/i.test(item))).toBe(true);
});
it('re-evaluates accepted observation freshness without rewriting historical decisions', async () => {
  let clock = new Date('2026-09-06T00:00:00Z');
  const service = createAssessmentService({
    store: new MemoryAssessmentStore(),
    investigator: createFixtureInvestigator(),
    now: () => clock,
  });
  let a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  for (const kind of ['photo_triage', 'market_comps'])
    a = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions.find((action) => action.kind === kind)!.id,
      a.revision,
    );
  expect(a.decision.report).toBeDefined();
  const historicalRevision = a.revision;
  clock = new Date('2027-10-10T00:00:00Z');
  a = (await service.getAssessment('alice', a.id))!;
  a = await service.refreshAssessment('alice', a.id, a.revision, 'aged-refresh');
  expect(a.decision.report).toBeUndefined();
  expect(a.decision.evidenceIds).toEqual([]);
  expect(a.decision.unknowns.some((item) => /freshness|expired/i.test(item))).toBe(true);
  expect(a.history.find((item) => item.revision === historicalRevision)?.report).toBeDefined();
});
it('accepts a new A→B→A source observation instead of reviving the old A record or keeping B', async () => {
  let clock = new Date('2026-09-06T00:00:00Z');
  let price = 300000;
  const fixture = createFixtureInvestigator();
  const service = createAssessmentService({
    store: new MemoryAssessmentStore(),
    now: () => clock,
    investigator: async (assessment, action) => {
      if (action.kind !== 'market_comps') return fixture(assessment, action);
      const value = {
        lane: 'clean' as const,
        outcome: 'ask' as const,
        price,
        year: 2021,
        url: 'https://example.com/one-vehicle',
        source: 'example.com',
        date: '2026-09-06',
      };
      return {
        detail: 'Synthetic repeated observation',
        costCents: 0,
        evidence: [
          {
            kind: 'comp',
            value,
            subject: {
              vin: assessment.lot.vin,
              make: assessment.lot.make,
              model: assessment.lot.model,
              year: assessment.lot.year,
            },
            source: {
              url: value.url,
              label: 'SYNTHETIC reversion regression',
              capturedBy: 'synthetic_fixture',
              retrievedAt: clock.toISOString(),
              observation: { ...value },
            },
          },
        ],
      };
    },
  });
  let a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  a = await service.investigateAssessment(
    'alice',
    a.id,
    a.offeredActions.find((action) => action.kind === 'photo_triage')!.id,
    a.revision,
  );
  for (let step = 0; step < 3; step++) {
    if (step > 0)
      a = await service.refreshAssessment('alice', a.id, a.revision, `reversion-${step}`);
    price = step === 1 ? 400000 : 300000;
    clock = new Date(`2026-09-${String(6 + step).padStart(2, '0')}T00:00:00Z`);
    a = await service.investigateAssessment(
      'alice',
      a.id,
      a.offeredActions.find((action) => action.kind === 'market_comps')!.id,
      a.revision,
    );
    expect(a.decision.report?.evidence.comps.map((comp) => comp.price)).toEqual([price]);
  }
  const observations = a.evidence.filter((e) => e.kind === 'comp');
  expect(observations).toHaveLength(3);
  expect(a.investigations.at(-1)?.evidenceIds).toEqual([observations[2].id]);
  expect(a.history.some((d) => d.report?.evidence.comps[0]?.price === 400000)).toBe(true);
});

it('accepts public supplier hostnames while rejecting private IPv6 source references', async () => {
  const service = setup();
  const seed = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  const publicLot = {
    ...seed.lot,
    url: 'https://www.fcpeuro.com/products/example',
    photos: ['https://fcpeuro.com/images/example.jpg'],
  };
  expect((await service.createAssessment('alice', { lot: publicLot })).lot.url).toBe(publicLot.url);
  for (const url of [
    'http://[fc00::1]/image.jpg',
    'http://[fd12::1]/image.jpg',
    'http://[fe80::1]/image.jpg',
  ])
    await expect(
      service.createAssessment('alice', { lot: { ...seed.lot, photos: [url] } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
});

describe('a lot the user brought (SPEC 61)', () => {
  const photos = [
    'https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0726/a_ful.jpg',
    'https://cs.copart.com/v1/AUTH_svc.pdoc00001/lpp/0726/b_ful.jpg',
  ];
  const decode = async () => ({
    Results: [{ Make: 'FERRARI', Model: 'SF90 Stradale', ModelYear: '2021' }],
  });
  const intakeService = (intake: Parameters<typeof createAssessmentService>[0]['intake']) =>
    createAssessmentService({
      store: new MemoryAssessmentStore(),
      now,
      investigator: createFixtureInvestigator(),
      intake,
    });

  it('creates a lot from pasted text alone and carries the chips behind every field', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: decode,
      photoProbe: async () => true,
    });
    const a = await service.createAssessment('alice', {
      intake: { text: COPART_COMPLETE, photoUrls: photos },
      mode: 'fixture',
    });
    expect(a.lot.source).toBe(USER_LOT_SOURCE);
    expect(a.lot.url).toBeUndefined();
    expect(a.lot.vin).toBe('ZFF95NLA2M0263155');
    expect(a.lot.photos).toEqual(photos);
    expect(a.lotAssumptions?.length).toBeGreaterThan(10);
    expect(a.lotAssumptions?.every((chip) => chip.source === 'intake')).toBe(true);
    expect(a.lot.notes).toContain('no auction or broker page was fetched');
  });

  it('keeps a listing URL as provenance and never dereferences it', async () => {
    const fetched: string[] = [];
    const service = intakeService({
      caller: null,
      vpicFetcher: decode,
      photoProbe: async (url) => {
        fetched.push(url);
        return true;
      },
    });
    const a = await service.createAssessment('alice', {
      intake: {
        text: COPART_COMPLETE,
        photoUrls: photos,
        listingUrl: 'https://example.test/lot/63198496',
      },
    });
    expect(a.lot.url).toBe('https://example.test/lot/63198496');
    // Only the photo addresses are ever dereferenced (SPEC 29, 61).
    expect(fetched).toEqual(photos);
  });

  it('refuses a photo link the screen will not dereference', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: decode,
      photoProbe: async (url) => url === photos[0],
    });
    await expect(
      service.createAssessment('alice', {
        intake: { text: COPART_COMPLETE, photoUrls: photos },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'photo link 2 is not a public https address',
    });
  });

  it('refuses a lot whose stated identity the VIN decode contradicts', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: async () => ({ Results: [{ Make: 'LAMBORGHINI', ModelYear: '2019' }] }),
      photoProbe: async () => true,
    });
    await expect(
      service.createAssessment('alice', {
        intake: { text: COPART_COMPLETE, photoUrls: photos },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'VIN decodes to 2019 Lamborghini; the listing says 2021 FERRARI',
    });
  });

  it('takes exactly one of a seed lot, a stated lot or an intake', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: null,
      photoProbe: async () => true,
    });
    await expect(
      service.createAssessment('alice', {
        seedLotId: 'sf90-front-il',
        intake: { text: COPART_COMPLETE, photoUrls: photos },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(service.createAssessment('alice', {})).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('creates with one corrected chip, which no longer requires correcting them all', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: decode,
      photoProbe: async () => true,
    });
    const a = await service.createAssessment('alice', {
      intake: {
        text: COPART_COMPLETE,
        photoUrls: photos,
        edits: { titleBrand: 'IL salvage, rebuildable' },
      },
    });
    expect(a.lot.titleBrand).toBe('IL salvage, rebuildable');
    const chips = a.lotAssumptions!.filter((chip) => chip.field === 'titleBrand');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ source: 'user', meaning: 'IL salvage, rebuildable' });
  });

  it('holds the lot it built to the lot schema rather than saving what it read', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: null,
      photoProbe: async () => true,
    });
    // A sale date the field's own coercion accepts as text, and the lot schema
    // refuses as a date. The refusal states the reading, not the validator.
    await expect(
      service.createAssessment('alice', {
        intake: {
          text: COPART_COMPLETE,
          photoUrls: photos,
          edits: { saleDate: 'next Tuesday' },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input', message: UNUSABLE_LOT });
    // A year no vehicle has is refused earlier still, by the field itself.
    await expect(
      service.createAssessment('alice', {
        intake: { text: COPART_COMPLETE, photoUrls: photos, edits: { year: '1899' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('screens the photo links before a model call is spent on the block', async () => {
    const calls: string[] = [];
    const service = intakeService({
      caller: async () => {
        calls.push('model');
        return { fields: [] };
      },
      vpicFetcher: async () => {
        calls.push('vpic');
        return { Results: [{ Make: 'FERRARI', ModelYear: '2021' }] };
      },
      photoProbe: async () => false,
    });
    await expect(
      service.createAssessment('alice', {
        intake: { text: IAA_SPARSE, photoUrls: photos },
      }),
    ).rejects.toMatchObject({ message: 'photo link 1 is not a public https address' });
    expect(calls).toEqual([]);
  });

  it('previews the reading without creating anything', async () => {
    const service = intakeService({
      caller: async () => ({ skipped: 'no key' }),
      vpicFetcher: decode,
      photoProbe: async () => true,
    });
    const reading = await service.previewIntake('alice', { text: COPART_MINIMAL });
    expect(reading.fields.make).toBe('MCLAREN');
    expect(reading.note).toBe('model completion skipped: no key');
    expect(await service.listAssessments('alice')).toEqual([]);
  });

  it('takes the buyer from the profile the caller states, never from the lot', async () => {
    const service = intakeService({
      caller: null,
      vpicFetcher: decode,
      photoProbe: async () => true,
    });
    // Intake reads a lot; the bidder is the caller's own profile, and without
    // one the schema's default hobbyist stands.
    const stated = await service.createAssessment('alice', {
      intake: { text: COPART_COMPLETE, photoUrls: photos },
      buyer: { ...BUYER_PRESETS.dealer },
    });
    expect(stated.buyer?.preset).toBe('dealer');
    const defaulted = await service.createAssessment('alice', {
      intake: { text: COPART_COMPLETE, photoUrls: photos },
    });
    expect(defaulted.buyer?.preset).toBe(DEFAULT_BUYER_PROFILE.preset);
  });
});
