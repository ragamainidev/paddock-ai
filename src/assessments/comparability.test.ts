/** Manual observations must identify the actual comparable, not inherit the assessed car (SPEC 53). */
import { describe, expect, it } from 'vitest';
import { createAssessmentService } from './service';
import { MemoryAssessmentStore } from './store';
import { reviewIssue, validateEvidence } from './validation';
import type { Assessment, EvidenceInput, EvidenceSource } from './types';

const at = '2026-09-06T12:00:00.000Z';
const service = () =>
  createAssessmentService({ store: new MemoryAssessmentStore(), now: () => new Date(at) });
function comp(
  a: Assessment,
  vehicle?: { make: string; model: string; year: number },
  capturedBy: EvidenceSource['capturedBy'] = 'user',
  year = vehicle?.year ?? a.lot.year,
): EvidenceInput {
  const value = {
    lane: 'clean' as const,
    outcome: 'sold' as const,
    title: 'clean' as const,
    price: 300000,
    year,
    date: '2026-09-01',
    url: 'https://example.com/comparable',
    source: 'example.com',
    ...(vehicle ? { vehicle } : {}),
  };
  return {
    kind: 'comp',
    value,
    subject: { make: a.lot.make, model: a.lot.model, year: a.lot.year, vin: a.lot.vin },
    source: {
      url: value.url,
      label: 'Synthetic test source',
      capturedBy,
      retrievedAt: at,
      observation: structuredClone(value),
    },
  };
}

describe('actual comparable identity', () => {
  it('requires actual vehicle fields before a supplied comparable can be reviewed', async () => {
    const a = await service().createAssessment('buyer', { seedLotId: 'sf90-front-il' });
    expect(reviewIssue(comp(a), a, at)).toMatch(/actual.*make.*model.*year/i);
  });
  it('rejects another make or model despite a target-stamped assessment subject', async () => {
    const svc = service();
    let a = await svc.createAssessment('buyer', { seedLotId: 'sf90-front-il' });
    const inputs = [
      comp(a, { make: 'Porsche', model: '911 Carrera', year: 2021 }),
      comp(a, { make: 'Ferrari', model: '296 GTB', year: 2021 }),
    ];
    a = await svc.recordEvidence('buyer', a.id, {
      evidence: inputs,
      expectedRevision: a.revision,
      idempotencyKey: 'foreign',
    });
    expect(a.evidence.every((e) => e.status === 'rejected')).toBe(true);
    await expect(
      svc.reviewEvidence('buyer', a.id, {
        evidenceIds: a.evidence.map((e) => e.id),
        expectedRevision: a.revision,
        idempotencyKey: 'review-foreign',
        rationale: 'Cannot turn other vehicles into Ferrari SF90 observations',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('cannot bypass actual identity by labeling caller-supplied evidence as a provider observation', async () => {
    const svc = service();
    let a = await svc.createAssessment('buyer', { seedLotId: 'sf90-front-il' });
    a = await svc.recordEvidence('buyer', a.id, {
      evidence: [comp(a, undefined, 'provider')],
      expectedRevision: a.revision,
      idempotencyKey: 'forged-provider',
    });
    expect(a.evidence[0].status).toBe('unverified');
    await expect(
      svc.reviewEvidence('buyer', a.id, {
        evidenceIds: [a.evidence[0].id],
        expectedRevision: a.revision,
        idempotencyKey: 'review-forged-provider',
        rationale: 'Provider label alone cannot establish actual comparable identity',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('accepts an adjacent model year and retains actual identity on the self-attested record', async () => {
    const svc = service();
    let a = await svc.createAssessment('buyer', { seedLotId: 'sf90-front-il' });
    const actual = { make: 'ferrari', model: 'SF90  Stradale', year: a.lot.year + 1 };
    a = await svc.recordEvidence('buyer', a.id, {
      evidence: [comp(a, actual)],
      expectedRevision: a.revision,
      idempotencyKey: 'comparable',
    });
    a = await svc.reviewEvidence('buyer', a.id, {
      evidenceIds: [a.evidence[0].id],
      expectedRevision: a.revision,
      idempotencyKey: 'review-comparable',
      rationale: 'Reviewed the actual make, model, year and title against the source',
    });
    expect(a.evidence[0].status).toBe('accepted');
    expect(a.evidence[0].value).toMatchObject({ vehicle: actual, year: actual.year });
    // The owner typed this comparable, so the server keeps no capture behind it (SPEC 56).
    expect(a.evidence[0].source.observation).toBeUndefined();
  });
  it('rejects out-of-window or contradictory comparable years', async () => {
    const a = await service().createAssessment('buyer', { seedLotId: 'sf90-front-il' });
    const actual = { make: a.lot.make, model: a.lot.model, year: a.lot.year + 3 };
    expect(reviewIssue(comp(a, actual), a, at)).toMatch(/year/i);
    expect(
      reviewIssue(comp(a, { ...actual, year: a.lot.year }, 'user', a.lot.year + 1), a, at),
    ).toMatch(/year/i);
  });
  it('preserves trusted legacy source compatibility but checks actual identity whenever supplied', async () => {
    const a = await service().createAssessment('buyer', { seedLotId: 'sf90-front-il' });
    const legacy = validateEvidence(comp(a, undefined, 'provider'), a, 'legacy', at, true);
    expect(legacy.status).toBe('accepted');
    expect(reviewIssue(legacy, a, at)).toBeUndefined();
    const wrong = comp(a, { make: 'Porsche', model: '911', year: 2021 }, 'provider');
    expect(validateEvidence(wrong, a, 'wrong', at, true).status).toBe('rejected');
  });
});
