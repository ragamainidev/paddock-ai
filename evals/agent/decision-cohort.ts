/** Independent synthetic expectations for decision behavior. Not a historical appraisal benchmark. */
import { BUYER_PRESETS, presetFor } from '../../src/assessments/buyer-profile';
import { readyCandidateEvidence } from '../../src/assessments/decision-cases';
import { createAssessmentService } from '../../src/assessments/service';
import { MemoryAssessmentStore } from '../../src/assessments/store';
import type {
  Assessment,
  AssessmentDecision,
  BuyerProfile,
  EvidenceInput,
} from '../../src/assessments/types';
import { getSalvageLot } from '../../src/salvage/seed-lots';

// Between the optimistic bound with selling costs at the high exit and the
// looser bound that derives them from the low exit: only the correct bound
// screens this bid out.
const DOMINATED_BID = 205000;

export const DECISION_CASES = [
  { id: 'equipped-opportunity', split: 'development', expected: 'build' },
  { id: 'cash-constrained', split: 'development', expected: 'walk' },
  { id: 'missing-physical-inspection', split: 'development', expected: 'needs_evidence' },
  { id: 'ineligible-title', split: 'development', expected: 'walk' },
  { id: 'wrong-jurisdiction', split: 'holdout', expected: 'needs_evidence' },
  { id: 'future-sale-leakage', split: 'holdout', expected: 'needs_evidence' },
  { id: 'unknown-title-market', split: 'holdout', expected: 'needs_evidence' },
  { id: 'unequipped-buyer', split: 'holdout', expected: 'needs_evidence' },
  { id: 'above-optimistic-bound', split: 'holdout', expected: 'walk' },
  { id: 'quote-on-diy-line', split: 'holdout', expected: 'build' },
  { id: 'dominated-at-high-exit', split: 'holdout', expected: 'walk' },
  { id: 'self-attested-market', split: 'holdout', expected: 'needs_evidence' },
  { id: 'broker-vs-direct', split: 'holdout', expected: 'build' },
  // A broker seat selling retail is the market persona minus the broker cut,
  // so this bidder is below the room's price by construction (SPEC 60): the
  // case pins the retail channel's own arithmetic and walks on the edge.
  { id: 'private-party-vs-retail', split: 'holdout', expected: 'walk' },
  { id: 'keep-not-sell', split: 'holdout', expected: 'build' },
  { id: 'no-edge-walk', split: 'holdout', expected: 'walk' },
  { id: 'edge-positive-build', split: 'holdout', expected: 'build' },
  // The shared profile already states the jurisdiction the fixture's
  // registration record covers, so this case changes nothing and reads the
  // title line: California's own process, on the buyer's side of the ledger
  // only (SPEC 59).
  { id: 'state-title-process', split: 'holdout', expected: 'build' },
] as const;
export type DecisionCaseId = (typeof DECISION_CASES)[number]['id'];

// Bidder-relative cases (SPEC 59): everything the kernel assumes — its
// discipline, no labor, no holding, no required surplus, cash that never
// binds, every tool owned — so the distance from the kernel's own ceiling
// (`kernelMaxBid`) is the one field the case changes. The jurisdiction stays
// Californian because the registration record is, and its title process is
// the one buyer-side line all three share.
const BIDDER_PROFILE: Partial<BuyerProfile> = {
  access: 'broker',
  exit: 'private_party',
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
    hv: true,
  },
  laborRatePerHour: 0,
  availableDiyHours: 1000,
  holdingDays: 0,
  holdingCostPerDay: 0,
  minSurplus: 0,
  maxAllIn: 10_000_000,
};
const BIDDER_CASES: Partial<Record<DecisionCaseId, Partial<BuyerProfile>>> = {
  'broker-vs-direct': { access: 'direct' },
  'private-party-vs-retail': { exit: 'retail' },
  'keep-not-sell': { exit: 'keep' },
};
// Two ceilings on one lot (SPEC 60): a preset's own resources against the
// market persona's on the same evidence. The hobbyist owns none of the
// equipment the plan wants and sells privately; the shop owns all of it, buys
// direct and never sells this car, so it genuinely pays less than the room.
const PRESET_CASES: Partial<Record<DecisionCaseId, BuyerProfile>> = {
  'no-edge-walk': BUYER_PRESETS.hobbyist,
  // Capitalized like the room it bids into, because the case is about the exit
  // channel and not the budget: a shop that keeps the car pays nothing to sell
  // it and clears a higher bid than the persona's retail exit.
  'edge-positive-build': { ...BUYER_PRESETS.shop, exit: 'keep', maxAllIn: 400_000 },
};
// `Object.assign` copies a reference, and both maps above are module constants
// shared by every case that names them: the fixture takes its own capabilities
// object so one case can never edit another case's profile.
function assignProfile(buyer: BuyerProfile, ...sources: Partial<BuyerProfile>[]): void {
  Object.assign(buyer, ...sources);
  buyer.capabilities = { ...buyer.capabilities };
}
export type CohortResult = {
  caseId: DecisionCaseId;
  split: string;
  expected: string;
  staticListing: string;
  capturedUnreviewed: string;
  legacyKernel: string;
  reviewedCapabilityLoop: string;
  passed: boolean;
  falsePositive: boolean;
  investigations: number;
  costCents: number;
  decision: AssessmentDecision;
  assessment: Assessment;
};
function mutateEvidence(
  records: EvidenceInput[],
  caseId: DecisionCaseId,
  a: Assessment,
): EvidenceInput[] {
  // The unequipped buyer's own labor line stays unquoted: that case tests
  // whether the buyer can execute DIY work, not what a specialist charges.
  const diyLines = new Set(
    a.decision.report?.plan.lines.filter((l) => l.who === 'diy').map((l) => l.id),
  );
  return records
    .filter(
      (e) =>
        !(
          ['missing-physical-inspection', 'dominated-at-high-exit'].includes(caseId) &&
          e.kind === 'inspection'
        ) &&
        !(
          caseId === 'unequipped-buyer' &&
          e.kind === 'repair_price' &&
          diyLines.has(e.value.line)
        ) &&
        // The self-attested world buys nothing captured on the market side; the
        // owner types every comp instead.
        !(caseId === 'self-attested-market' && e.kind === 'comp'),
    )
    .map((e) => {
      if (caseId === 'ineligible-title' && e.kind === 'title')
        e.value.titleBrand = 'Certificate of destruction';
      if (caseId === 'future-sale-leakage' && e.kind === 'comp') e.value.date = '2026-12-01';
      if (caseId === 'unknown-title-market' && e.kind === 'comp') e.value.title = 'unknown';
      // A wide sold spread separates the optimistic bound's low and high exits,
      // so selling costs derived from the wrong one are visible in the bound.
      if (caseId === 'dominated-at-high-exit' && e.kind === 'comp')
        e.value.price = 310000 + (e.value.price - 310000) * 10;
      e.source.observation = structuredClone(e.value) as Record<string, unknown>;
      return e;
    });
}
// The same market prices as the captured world, typed in by the owner: no
// artifact, no extraction, and no observation the server did not take itself.
function selfAttestedComps(a: Assessment): EvidenceInput[] {
  const vehicle = { make: a.lot.make, model: a.lot.model, year: a.lot.year };
  return [300000, 310000, 320000].map((price, i) => ({
    kind: 'comp',
    subject: { vin: a.lot.vin, ...vehicle },
    value: {
      lane: 'rebuilt',
      outcome: 'sold',
      title: 'rebuilt',
      price,
      year: a.lot.year,
      vehicle,
      date: a.updatedAt.slice(0, 10),
      url: `https://example.com/paddock-synthetic/owner-sale-${i}`,
      source: 'example.com',
      note: 'Invented completed sale the owner typed in for evaluation',
    },
    source: {
      url: `https://example.com/paddock-synthetic/owner-sale-${i}`,
      label: 'SYNTHETIC owner-typed comparable; invented price, not a captured record',
      capturedBy: 'user',
      retrievedAt: a.updatedAt,
    },
  }));
}
export async function runDecisionCase(caseId: DecisionCaseId): Promise<CohortResult> {
  const expectation = DECISION_CASES.find((c) => c.id === caseId)!;
  const at = '2026-09-06T00:00:00.000Z';
  const service = createAssessmentService({
    store: new MemoryAssessmentStore(),
    now: () => new Date(at),
    investigator: async (a, action) => {
      const result = readyCandidateEvidence(a, action);
      return { ...result, evidence: mutateEvidence(result.evidence, caseId, a) };
    },
  });
  // Stated in full: a cohort case measures the decision layer, so its buyer
  // never moves when a product default moves.
  const buyer: BuyerProfile = {
    preset: 'custom',
    jurisdiction: caseId === 'wrong-jurisdiction' ? 'US-NY' : 'US-CA',
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
    holdingDays: 90,
    holdingCostPerDay: 10,
    minSurplus: 10000,
    // The market persona has no cash arm (SPEC 60), so a case that is not about
    // cash states a limit that does not bind: a limit that binds is itself a
    // reason this bidder cannot reach the room's price.
    maxAllIn:
      caseId === 'cash-constrained'
        ? 1000
        : // Cash is not the binding constraint when the screen is the optimistic bound itself.
          caseId === 'dominated-at-high-exit'
          ? 1000000
          : 400000,
    // The quoted-DIY buyer has no time of their own; only professional work can execute this plan.
    availableDiyHours: caseId === 'quote-on-diy-line' ? 0 : 1000,
  };
  if (caseId === 'unequipped-buyer') buyer.capabilities.tools = false;
  if (caseId === 'above-optimistic-bound') buyer.minSurplus = 1000000;
  const bidder = BIDDER_CASES[caseId];
  if (bidder) assignProfile(buyer, BIDDER_PROFILE, bidder);
  const resources = PRESET_CASES[caseId];
  // The preset states resources and an exit; the case keeps its own residence,
  // because the registration record the fixture carries is for one state.
  if (resources) assignProfile(buyer, resources, { jurisdiction: buyer.jurisdiction });
  buyer.preset = presetFor(buyer);
  let a = await service.createAssessment('cohort', {
    // The observed-bid case carries the same seed lot with the bid the screen reads.
    ...(caseId === 'dominated-at-high-exit'
      ? { lot: { ...getSalvageLot('sf90-front-il')!, currentBid: DOMINATED_BID } }
      : { seedLotId: 'sf90-front-il' }),
    fixtureCaseId: 'ready-candidate',
    buyer,
    budget: { maxInvestigations: 12 },
  });
  // Diagnostic baseline: the listing's retail claim alone. This deliberately exposes what that shortcut misses.
  const staticListing = (a.lot.estRetailValue ?? 0) > buyer.maxAllIn ? 'build' : 'needs_evidence';
  while (a.offeredActions.length)
    a = await service.investigateAssessment('cohort', a.id, a.offeredActions[0].id, a.revision);
  if (caseId === 'self-attested-market')
    a = await service.recordEvidence('cohort', a.id, {
      evidence: selfAttestedComps(a),
      expectedRevision: a.revision,
      idempotencyKey: 'self-attested-comps',
    });
  const capturedUnreviewed = a.decision.verdict;
  const legacyKernel = a.decision.report?.assessment.verdict ?? 'needs_evidence';
  // An explicit simulated owner attests only the source records made available in this case.
  // A future sale is never manually promoted; its absence must cause abstention.
  const ids = a.evidence
    .filter(
      (e) => e.status !== 'rejected' && !(caseId === 'future-sale-leakage' && e.kind === 'comp'),
    )
    .map((e) => e.id);
  if (ids.length)
    a = await service.reviewEvidence('cohort', a.id, {
      evidenceIds: ids,
      expectedRevision: a.revision,
      idempotencyKey: 'synthetic-owner-review',
      rationale:
        'Simulated owner review of original synthetic documents; no real-world source accuracy claim',
    });
  return {
    caseId,
    split: expectation.split,
    expected: expectation.expected,
    staticListing,
    capturedUnreviewed,
    legacyKernel,
    reviewedCapabilityLoop: a.decision.verdict,
    passed: a.decision.verdict === expectation.expected,
    falsePositive: a.decision.verdict === 'build' && expectation.expected !== 'build',
    investigations: a.budget.usedInvestigations,
    costCents: a.budget.spentCostCents,
    decision: a.decision,
    assessment: a,
  };
}
export async function runDecisionCohort() {
  const results: CohortResult[] = [];
  for (const c of DECISION_CASES) results.push(await runDecisionCase(c.id));
  return {
    provenance: 'Original synthetic cases; no licensed records, live models, or provider calls',
    limitations:
      'Holdout labels reserve contract variants; these authored synthetic cases are not blind real-world validation. The capability loop is deterministic; actual Eve transport is separately evaluated by eval:agent. Owner review is simulated, not performed by the agent.',
    asOf: '2026-09-06T00:00:00.000Z',
    results,
  };
}
