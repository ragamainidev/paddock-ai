/** Store contract runs against memory and isolated libSQL files (SPEC 46). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createAssessmentService } from './service';
import { LibsqlAssessmentStore, MemoryAssessmentStore } from './store';
import type { Assessment, AssessmentDecision, AssessmentStore, BuyerProfile } from './types';

type Economics = NonNullable<AssessmentDecision['buyerEconomics']>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function disk() {
  const dir = mkdtempSync(join(tmpdir(), 'paddock-assessment-'));
  const url = `file:${join(dir, 'assessments.db')}`;
  const client = createClient({ url });
  cleanups.push(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store: new LibsqlAssessmentStore(client), url, client };
}
for (const [name, factory] of [
  ['memory', () => new MemoryAssessmentStore()],
  ['libSQL', () => disk().store],
] as const)
  describe(`${name} assessment contract`, () => {
    async function seed() {
      const store: AssessmentStore = factory();
      const service = createAssessmentService({ store });
      const a = await service.createAssessment('alice', {
        seedLotId: 'sf90-front-il',
        idempotencyKey: 'create',
      });
      return { store, service, a };
    }
    it('isolates owners, rejects changed creation replays, and returns detached snapshots', async () => {
      const { store, service, a } = await seed();
      expect(await store.get('bob', a.id)).toBeNull();
      expect(await store.list('bob')).toEqual([]);
      await expect(
        service.createAssessment('alice', {
          seedLotId: 'sf90-front-il',
          budget: { maxInvestigations: 1 },
          idempotencyKey: 'create',
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
      a.lot.title = 'tampered outside store';
      expect((await store.get('alice', a.id))?.lot.title).not.toBe(a.lot.title);
    });
    it('allows one competing update and preserves the winning revision', async () => {
      const { store, a } = await seed();
      const left = { ...structuredClone(a), revision: 2, stopReason: 'left' };
      const right = { ...structuredClone(a), revision: 2, stopReason: 'right' };
      const results = await Promise.allSettled([store.save(left, 1), store.save(right, 1)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect((await store.get('alice', a.id))?.revision).toBe(2);
    });
  });
it('reopens a separate assessment database with decision history, evidence and reservations intact', async () => {
  const { store, url } = disk();
  const service = createAssessmentService({ store });
  const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  const b = await service.investigateAssessment('alice', a.id, a.offeredActions[0].id, a.revision);
  const reopened = createClient({ url });
  cleanups.unshift(() => reopened.close());
  const saved = await createAssessmentService({
    store: new LibsqlAssessmentStore(reopened),
  }).getAssessment('alice', a.id);
  expect(saved).toEqual(b);
  expect(saved?.history.length).toBeGreaterThan(1);
  expect(saved?.evidence.length).toBeGreaterThan(0);
});

it('reads a record saved before the buyer profile learned who is bidding', async () => {
  const { store, client } = disk();
  const service = createAssessmentService({ store });
  const a = await service.createAssessment('alice', { seedLotId: 'sf90-front-il' });
  const document = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
  // The profile as an earlier writer left it on disk: no preset, access, exit,
  // discipline or equipment flags, and its own defaults for the rest.
  document.buyer = {
    jurisdiction: 'US-unspecified',
    capabilities: {
      tools: true,
      workspace: true,
      lift: false,
      diagnostics: true,
      specialistAccess: true,
    },
    laborRatePerHour: 25,
    availableDiyHours: 200,
    holdingDays: 90,
    holdingCostPerDay: 10,
    maxAllIn: 100000,
    minSurplus: 10000,
  };
  const write = (value: Record<string, unknown>) =>
    client.execute({
      sql: 'update assessments set document = ? where id = ?',
      args: [JSON.stringify(value), a.id],
    });
  await write(document);
  const filled = (await store.get('alice', a.id))?.buyer;
  expect(filled).toEqual({
    preset: 'custom',
    jurisdiction: 'US-unspecified',
    access: 'broker',
    exit: 'private_party',
    discipline: 0.75,
    capabilities: {
      tools: true,
      workspace: true,
      lift: false,
      diagnostics: true,
      specialistAccess: true,
      structural: false,
      paint: false,
      alignment: false,
      hv: false,
    },
    laborRatePerHour: 25,
    availableDiyHours: 200,
    holdingDays: 90,
    holdingCostPerDay: 10,
    maxAllIn: 100000,
    minSurplus: 10000,
  } satisfies BuyerProfile);
  // A record that states no buyer keeps stating none; its readers hold the default.
  delete document.buyer;
  await write(document);
  expect((await store.get('alice', a.id))?.buyer).toBeUndefined();
  expect((await store.list('alice'))[0]?.buyer).toBeUndefined();
});

it('re-projects a decision saved before the ceiling became bidder-relative, without rewriting it', async () => {
  const { store, client } = disk();
  const service = createAssessmentService({ store });
  let a = await service.createAssessment('alice', {
    seedLotId: 'sf90-front-il',
    fixtureCaseId: 'ready-candidate',
  });
  for (const kind of ['vin_identity', 'photo_triage', 'market_comps'] as const) {
    const action = a.offeredActions.find((offered) => offered.kind === kind)!;
    a = await service.investigateAssessment('alice', a.id, action.id, a.revision, `seed-${kind}`);
  }
  const solved = a.decision.buyerEconomics!;
  expect(solved.market.maxBid).toBeGreaterThan(0);
  const write = (value: Assessment) =>
    client.execute({
      sql: 'update assessments set document = ? where id = ?',
      args: [JSON.stringify(value), a.id],
    });
  const readDocument = async () => {
    const raw = await client.execute({
      sql: 'select document from assessments where id = ?',
      args: [a.id],
    });
    return JSON.parse(String(raw.rows[0].document)) as Assessment;
  };
  const saved = (value: Assessment) =>
    value.decision.buyerEconomics as Partial<Omit<Economics, 'discipline'>> & {
      discipline: Partial<Economics['discipline']>;
    };
  // The record as a writer before the buyer ledger left it: the buyer's own
  // arithmetic, and nothing about the room's price or where the money went.
  const document = JSON.parse(JSON.stringify(a)) as Assessment;
  const legacy = saved(document);
  delete legacy.market;
  delete legacy.edge;
  delete legacy.lines;
  delete legacy.kernelMaxBid;
  await write(document);
  const read = await service.getAssessment('alice', a.id);
  const economics = read!.decision.buyerEconomics!;
  expect(economics.market.maxBid).toBe(solved.market.maxBid);
  expect(economics.lines.length).toBeGreaterThan(0);
  expect(economics.edge).toBe(solved.edge);
  // A read is a read: the row keeps the shape it was written with, the record
  // keeps its revision, and no decision was appended to its history.
  expect((await readDocument()).decision.buyerEconomics).not.toHaveProperty('market');
  expect(read!.revision).toBe(a.revision);
  expect(read!.history.length).toBe(a.history.length);
  // A record short of only the arm that bound its ceiling is stale the same
  // way: `bound` is required on a current decision, so a stored one that
  // states `share` and `basis` alone is projected again rather than read back
  // short of its own type.
  const boundless = JSON.parse(JSON.stringify(a)) as Assessment;
  delete saved(boundless).discipline.bound;
  await write(boundless);
  const current = await service.getAssessment('alice', a.id);
  expect(current!.decision.buyerEconomics!.discipline.bound).toBe(solved.discipline.bound);
  expect(current!.decision.buyerEconomics!.discipline.share).toBe(solved.discipline.share);
  expect((await readDocument()).decision.buyerEconomics!.discipline).not.toHaveProperty('bound');
  expect(current!.revision).toBe(a.revision);
  expect(current!.history.length).toBe(a.history.length);
});
