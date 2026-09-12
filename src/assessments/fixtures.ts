/** Offline world: recorded salvage cases plus clearly labeled adversarial mutations (SPEC 49). */
import sf90 from '../../evals/salvage/cases/sf90-live-2026-08-18.json';
import strong from '../../evals/salvage/cases/sf90-clean-anchor-strong.json';
import empty from '../../evals/salvage/cases/sf90-research-empty.json';
import huracan from '../../evals/salvage/cases/huracan-dead-title.json';
import rich from '../../evals/salvage/cases/sf90-wreck-market-rich.json';
import bleed from '../../evals/salvage/cases/sf90-hammer-bleed.json';
import point from '../../evals/salvage/cases/sf90-hammer-point.json';
import { readyCandidateEvidence } from './decision-cases';
import { checkVin } from '@/inspector/vin';
import { lotProvenanceUrl, NO_LOT_ADDRESS } from '@/lib/url';
import { getSalvageLot } from '@/salvage/seed-lots';
import { parseTriageOutput } from '@/salvage/triage';
import type { SalvageEvidence } from '@/salvage/types';
import {
  AssessmentError,
  type Assessment,
  type AssessmentInvestigator,
  type EvidenceInput,
} from './types';

const CASES = {
  'sf90-live-2026-08-18': sf90,
  'sf90-clean-anchor-strong': strong,
  'sf90-research-empty': empty,
  'huracan-dead-title': huracan,
  'sf90-wreck-market-rich': rich,
  'sf90-hammer-bleed': bleed,
  'sf90-hammer-point': point,
};
export const ASSESSMENT_FIXTURE_CASES = [
  ...Object.entries(CASES).map(([id, value]) => ({
    id,
    name: value.name,
    lotId: value.lotId,
  })),
  {
    id: 'ready-candidate',
    name: 'SYNTHETIC equipped enthusiast complete candidate',
    lotId: 'sf90-front-il',
  },
];
export function createFixtureInvestigator(): AssessmentInvestigator {
  return async (a, action) => {
    const caseId = a.fixtureCaseId ?? 'standard';
    const aliases = [
      'standard',
      'ready-candidate',
      'wrong-car',
      'changed-comps',
      'changed-title',
      'duplicate',
      'stale',
      'budget',
      'interrupted',
    ];
    if (!aliases.includes(caseId) && !(caseId in CASES))
      throw new AssessmentError('invalid_input', 'Unknown fixture case');
    const selected =
      caseId in CASES
        ? CASES[caseId as keyof typeof CASES]
        : caseId === 'changed-comps' && a.epoch > 0
          ? empty
          : a.lot.id === huracan.lotId
            ? huracan
            : sf90;
    if (selected.lotId !== a.lot.id && caseId !== 'wrong-car')
      return {
        evidence: [],
        detail:
          'No recorded fixture exists for this vehicle; arbitrary manual lots do not inherit seed evidence',
      };
    const canonical = getSalvageLot(selected.lotId);
    if (
      !canonical ||
      canonical.vin !== a.lot.vin ||
      canonical.make !== a.lot.make ||
      canonical.model !== a.lot.model ||
      canonical.year !== a.lot.year ||
      JSON.stringify(canonical.photos) !== JSON.stringify(a.lot.photos)
    )
      return {
        evidence: [],
        detail:
          'Recorded fixture identity or photo set differs from supplied lot; no cross-car evidence applied',
      };
    if (caseId === 'ready-candidate') return readyCandidateEvidence(a, action);
    const capturedBy = ['wrong-car', 'changed-comps', 'changed-title', 'stale'].includes(caseId)
      ? ('synthetic_fixture' as const)
      : ('recorded_fixture' as const);
    const subject = {
      vin: a.lot.vin,
      make: a.lot.make,
      model: caseId === 'wrong-car' ? 'Synthetic wrong vehicle' : a.lot.model,
      year: a.lot.year,
    };
    const wrap = (payload: Pick<EvidenceInput, 'kind' | 'value'>, url: string): EvidenceInput =>
      ({
        ...payload,
        subject,
        source: {
          url,
          label: `${capturedBy === 'synthetic_fixture' ? 'SYNTHETIC adversarial fixture' : 'Recorded salvage eval fixture'}: ${caseId}`,
          capturedBy,
          retrievedAt: caseId === 'stale' ? '2010-01-01T00:00:00Z' : '2026-08-18T00:00:00Z',
          observation: structuredClone(payload.value) as Record<string, unknown>,
        },
      }) as EvidenceInput;
    let evidence: EvidenceInput[] = [];
    // A lot the user brought may carry no listing page, so an observation
    // about the lot itself cites the first photo instead (SPEC 61).
    const listing = lotProvenanceUrl(a.lot);
    if (action.kind === 'photo_triage') {
      if (!listing) return { evidence: [], detail: NO_LOT_ADDRESS, costCents: 0 };
      evidence = [
        wrap(
          {
            kind: 'triage',
            value: parseTriageOutput(selected.triage, Math.min(a.lot.photos.length, 12)),
          },
          listing,
        ),
      ];
    }
    if (action.kind === 'vin_identity') {
      if (!listing) return { evidence: [], detail: NO_LOT_ADDRESS, costCents: 0 };
      const check = checkVin(a.lot.vin, { make: a.lot.make, year: a.lot.year });
      evidence = [wrap({ kind: 'identity', value: check }, listing)];
      evidence[0].source.capturedBy = 'synthetic_fixture';
      evidence[0].source.label =
        'Deterministic local structural VIN check in fixture mode; federal database was not fetched';
    }
    const recorded = selected.evidence as SalvageEvidence;
    if (action.kind === 'market_comps') {
      const comps =
        caseId === 'changed-comps' && a.epoch > 0
          ? (sf90.evidence as SalvageEvidence).comps.map((comp) => ({
              ...comp,
              price: Math.round(comp.price * 0.5),
              note: 'SYNTHETIC changed-price stress scenario; not an actual sale',
            }))
          : recorded.comps;
      evidence = comps.map((value) => wrap({ kind: 'comp', value }, value.url));
    }
    if (action.kind === 'repair_evidence')
      evidence = recorded.prices
        .filter((price) => price.line === action.lineId)
        .map((value) => wrap({ kind: 'repair_price', value }, value.url));
    if (caseId === 'changed-title' && a.epoch > 0 && action.kind === 'market_comps' && listing)
      evidence.push(
        wrap(
          {
            kind: 'title',
            value: { titleBrand: 'Certificate of destruction (SYNTHETIC fixture observation)' },
          },
          listing,
        ),
      );
    return {
      evidence,
      detail: `Fixture ${caseId}: ${evidence.length} observation(s); no network or paid model calls`,
      costCents: 0,
    };
  };
}
export function fixtureSubject(a: Assessment) {
  return { vin: a.lot.vin, make: a.lot.make, model: a.lot.model, year: a.lot.year };
}
