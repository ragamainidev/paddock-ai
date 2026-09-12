/** Provider boundaries remain explicit and claims cannot masquerade as observed sources. */
import { describe, expect, it } from 'vitest';
import { createLiveInvestigator } from './adapters';
import { createFixtureInvestigator } from './fixtures';
import { createAssessmentService } from './service';
import { MemoryAssessmentStore } from './store';
import type { Comp } from '@/salvage/types';
import { createCompsObservationFetcher } from '@/salvage/comps';
import { verifySourceArtifact } from './source-artifacts';

const date = () => new Date('2026-09-06T00:00:00Z');
const make = (investigator = createFixtureInvestigator()) =>
  createAssessmentService({ store: new MemoryAssessmentStore(), investigator, now: date });
describe('assessment provider contracts', () => {
  it('requires explicit live mode before calling even an injected provider', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il' });
    let calls = 0;
    const adapter = createLiveInvestigator({
      vpicFetcher: async () => {
        calls++;
        return {};
      },
    });
    await expect(
      adapter(
        a,
        a.offeredActions.find((x) => x.kind === 'vin_identity')!,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toBe(0);
  });
  it('captures federal model identity contradictions but never supplies a title-history verdict', async () => {
    const service = make(
      createLiveInvestigator({
        now: date,
        vpicFetcher: async () => ({
          Results: [{ Make: 'PORSCHE', Model: '911', ModelYear: '2021' }],
        }),
      }),
    );
    const a = await service.createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const b = await service.investigateAssessment(
      'owner',
      a.id,
      a.offeredActions.find((x) => x.kind === 'vin_identity')!.id,
      a.revision,
    );
    const identity = b.evidence[0];
    expect(identity.kind).toBe('identity');
    if (identity.kind === 'identity') {
      expect(identity.value.mismatches.length).toBeGreaterThan(0);
      expect(identity.value.note).toMatch(/NOT checked/);
    }
    expect(b.decision.unknowns.some((s) => /Identity conflict/.test(s))).toBe(true);
    expect(b.decision.ceiling).toBeNull();
  });
  it('uses structured eBay asks and does not convert them into sales', async () => {
    const comp: Comp = {
      lane: 'clean',
      outcome: 'ask',
      price: 320000,
      year: 2021,
      url: 'https://www.ebay.com/itm/123',
      source: 'ebay.com',
      date: '2026-09-06',
    };
    let calls = 0;
    const service = make(
      createLiveInvestigator({
        now: date,
        comps: async () => {
          calls++;
          return [comp];
        },
      }),
    );
    const a = await service.createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const b = await service.investigateAssessment(
      'owner',
      a.id,
      a.offeredActions.find((x) => x.kind === 'market_comps')!.id,
      a.revision,
    );
    expect(calls).toBe(1);
    expect(b.evidence[0].status).toBe('accepted');
    expect(b.evidence[0].value).toMatchObject({ outcome: 'ask', price: 320000 });
  });
  it('quarantines a URL-only monetary claim and a structured snapshot with different fields', async () => {
    const fixture = createFixtureInvestigator();
    const service = make(async (a, action) => {
      const result = await fixture(a, action);
      if (action.kind === 'market_comps') {
        result.evidence = result.evidence.slice(0, 2).map((e, i) => ({
          ...e,
          source: {
            ...e.source,
            capturedBy: 'provider' as const,
            observation: i === 0 ? undefined : { price: 1 },
          },
        }));
      }
      return result;
    });
    const a = await service.createAssessment('owner', { seedLotId: 'sf90-front-il' });
    const b = await service.investigateAssessment(
      'owner',
      a.id,
      a.offeredActions.find((x) => x.kind === 'market_comps')!.id,
      a.revision,
    );
    expect(b.evidence.length).toBe(2);
    expect(b.evidence.every((e) => e.status === 'unverified')).toBe(true);
    expect(b.decision.ceiling).toBeNull();
  });
});

describe('live source provenance', () => {
  it('rejects a completed-sale result injected into the active-listing adapter', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const adapter = createLiveInvestigator({
      now: date,
      comps: async () => [
        {
          lane: 'clean',
          outcome: 'sold',
          price: 350000,
          url: 'https://www.ebay.com/itm/1',
          source: 'ebay.com',
        },
      ],
    });
    const result = await adapter(
      a,
      a.offeredActions.find((action) => action.kind === 'market_comps')!,
    );
    expect(result.evidence).toEqual([]);
  });
  it('combines an exact vPIC model and trim without hiding either source field', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const raw = {
      Results: [
        { Make: 'FERRARI', Model: 'SF90', Trim: 'Stradale', ModelYear: '2021', ErrorCode: '0' },
      ],
    };
    const result = await createLiveInvestigator({ now: date, vpicFetcher: async () => raw })(
      a,
      a.offeredActions.find((action) => action.kind === 'vin_identity')!,
    );
    const identity = result.evidence[0];
    if (identity.kind !== 'identity') throw new Error('Expected identity');
    expect(identity.value.decoded).toMatchObject({ model: 'SF90 Stradale', trim: 'Stradale' });
    expect(identity.value.mismatches).toEqual([]);
    expect(identity.source.artifact?.content).toEqual(raw);
  });
  it('retains vPIC decode errors as conflicts even when its partial model fields happen to match', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    for (const ErrorCode of ['1,7', '6', undefined]) {
      const result = await createLiveInvestigator({
        now: date,
        vpicFetcher: async () => ({
          Results: [{ Make: 'FERRARI', Model: 'SF90 Stradale', ModelYear: '2021', ErrorCode }],
        }),
      })(
        a,
        a.offeredActions.find((action) => action.kind === 'vin_identity')!,
      );
      const identity = result.evidence[0];
      if (identity.kind !== 'identity') throw new Error('Expected identity');
      expect(identity.value.mismatches.some((message) => /vPIC.*decode/i.test(message))).toBe(true);
    }
  });
  it('does not assign a different returned VIN to the requested vehicle', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const result = await createLiveInvestigator({
      now: date,
      vpicFetcher: async () => ({
        Results: [
          {
            Make: 'FERRARI',
            Model: 'SF90 Stradale',
            ModelYear: '2021',
            ErrorCode: '0',
            VIN: 'ZFF95NLA4M0265120',
          },
        ],
      }),
    })(
      a,
      a.offeredActions.find((action) => action.kind === 'vin_identity')!,
    );
    const identity = result.evidence[0];
    if (identity.kind !== 'identity') throw new Error('Expected identity');
    expect(identity.value.mismatches.some((message) => /returned VIN/i.test(message))).toBe(true);
  });
  it('archives the actual vPIC response alongside deterministic decoded fields', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const raw = {
      Results: [
        {
          Make: 'FERRARI',
          Model: 'SF90 STRADALE',
          ModelYear: '2021',
          ErrorCode: '0',
          untouched: 'source field',
        },
      ],
    };
    const urls: string[] = [];
    const adapter = createLiveInvestigator({
      now: date,
      vpicFetcher: async (url) => {
        urls.push(url);
        return raw;
      },
    });
    const result = await adapter(
      a,
      a.offeredActions.find((action) => action.kind === 'vin_identity')!,
    );
    const source = result.evidence[0].source;
    expect(urls).toHaveLength(1);
    expect(source.artifact?.content).toEqual(raw);
    expect(source.artifact && verifySourceArtifact(source.artifact)).toBe(true);
    expect(source.observation).toMatchObject({ vin: a.lot.vin });
    expect(source.observation).not.toHaveProperty('Results');
    expect(source.extraction).toEqual({ method: 'deterministic', version: 'vpic-identity-v1' });
  });

  it('retains raw listing fields and never labels a normalized object as the provider response', async () => {
    const a = await make().createAssessment('owner', { seedLotId: 'sf90-front-il', mode: 'live' });
    const item = {
      itemId: '1',
      title: '2021 Ferrari SF90 Stradale',
      price: { value: '350000', currency: 'USD' },
      itemWebUrl: 'https://www.ebay.com/itm/1',
      buyingOptions: ['FIXED_PRICE'],
    };
    const adapter = createLiveInvestigator({
      now: date,
      compObservations: createCompsObservationFetcher(
        { searchRaw: async () => [item] },
        () => '2026-09-06',
      ),
    });
    const result = await adapter(
      a,
      a.offeredActions.find((action) => action.kind === 'market_comps')!,
    );
    const evidence = result.evidence[0];
    expect(evidence.source.artifact?.content).toEqual(item);
    expect(evidence.source.observation).toMatchObject({ outcome: 'ask', title: 'unknown' });
    expect(evidence.source.basis).toBe('source_observation');
    expect(evidence.source.extraction?.method).toBe('deterministic');
  });

  it('marks photo output as model inference and archives image references rather than claiming inspected image bytes', async () => {
    const a = await make().createAssessment('owner', {
      seedLotId: 'sf90-front-il',
      mode: 'live',
      budget: { maxCostCents: 300 },
    });
    const adapter = createLiveInvestigator({
      now: date,
      triageCaller: async () => ({
        overall: 'rebuildable',
        areas: [
          {
            area: 'front bumper',
            kind: 'cosmetic',
            severity: 'light',
            description: 'Visible scratch',
            photos: [0],
          },
        ],
        airbagsDeployed: 'unknown',
        floodEvidence: false,
        fireEvidence: false,
        drivetrainRisk: 'Unknown from image',
        observations: [{ photo: 0, note: 'Scratch' }],
        confidence: 0.5,
      }),
    });
    const result = await adapter(
      a,
      a.offeredActions.find((action) => action.kind === 'photo_triage')!,
    );
    expect(result.evidence[0].source).toMatchObject({
      capturedBy: 'model',
      basis: 'model_inference',
      extraction: { method: 'model' },
      artifact: { kind: 'image_manifest' },
    });
    expect(result.evidence[0].source.artifact?.content).toMatchObject({
      contentCaptured: false,
      images: a.lot.photos.slice(0, 12),
    });
    expect(result.evidence[0].source.observation).toEqual(result.evidence[0].value);
  });
});
