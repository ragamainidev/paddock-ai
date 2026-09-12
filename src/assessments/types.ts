/** Durable assessment contracts, independent of agent sessions (SPEC 46–49). */
import type { VinCheck } from '@/inspector/types';
import type { Assumption, IntakeField } from './intake';
import type {
  BuyerAccess,
  Comp,
  CostLine,
  DamageTriage,
  ExitChannel,
  PriceEvidence,
  SalvageLot,
  SalvageReport,
} from '@/salvage/types';

export type AssessmentMode = 'fixture' | 'live';

/**
 * What the desk can be told happened after the sale. `lost_to_hammer` is a pass
 * the market answered: the owner did not buy and the winning bid is still the
 * price this lot made (SPEC 62).
 */
export const OUTCOME_KINDS = ['passed', 'purchased', 'sold', 'observed', 'lost_to_hammer'] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];
export type EvidenceSubject = { vin?: string; make: string; model: string; year: number };
export type EvidenceSource = {
  url: string;
  label: string;
  capturedBy: 'recorded_fixture' | 'synthetic_fixture' | 'provider' | 'user' | 'model';
  retrievedAt: string;
  basis?: 'source_observation' | 'model_inference';
  artifact?: {
    kind: 'provider_response' | 'listing_item' | 'image_manifest';
    mediaType: 'application/json';
    sha256: string;
    content: Record<string, unknown>;
  };
  extraction?: { method: 'deterministic' | 'model'; version: string };
  // Exact structured observation, not a URL reachability check or an entailment claim.
  observation?: Record<string, unknown>;
};
// How the bidder reaches the auction and leaves the car. Both move kernel
// money, so the kernel owns the vocabulary; the ceiling is a property of
// (lot, bidder), not of the lot (SPEC 50).
export type { BuyerAccess, ExitChannel };
export type BuyerPreset = 'hobbyist' | 'shop' | 'dealer' | 'custom';
export type BuyerProfile = {
  preset: BuyerPreset;
  jurisdiction: string;
  access: BuyerAccess;
  exit: ExitChannel;
  // Share of the low exit the all-in may reach; the kernel's own discipline
  // share stays the market persona's until calibration data exists.
  discipline: number;
  capabilities: {
    tools: boolean;
    workspace: boolean;
    lift: boolean;
    diagnostics: boolean;
    specialistAccess: boolean;
    structural: boolean; // frame rack or jig
    paint: boolean; // booth
    alignment: boolean; // alignment rack
    hv: boolean; // high-voltage isolation tooling and training
  };
  laborRatePerHour: number;
  availableDiyHours: number;
  holdingDays: number;
  holdingCostPerDay: number;
  maxAllIn: number;
  minSurplus: number;
};
export type InspectionSystem = 'structure' | 'srs' | 'powertrain' | 'hv' | 'water_fire';
export type PhysicalInspection = {
  inspector: string;
  inspectedAt: string;
  method: 'physical';
  systems: {
    system: InspectionSystem;
    status: 'clear' | 'repairable' | 'unsafe' | 'unknown' | 'not_applicable';
    finding: string;
  }[];
  repairScopeConfirmed: boolean;
};
type EvidencePayload =
  | { kind: 'triage'; value: DamageTriage }
  | { kind: 'identity'; value: VinCheck }
  | { kind: 'comp'; value: Comp }
  | { kind: 'repair_price'; value: PriceEvidence }
  | { kind: 'title'; value: { titleBrand: string; listingDiscrepancyResolution?: string } }
  | {
      kind: 'registration';
      value: {
        jurisdiction: string;
        eligible: boolean;
        requirements: string[];
        expiresAt?: string;
      };
    }
  | { kind: 'inspection'; value: PhysicalInspection };
export type EvidenceInput = EvidencePayload & { subject: EvidenceSubject; source: EvidenceSource };
export type AssessmentEvidence = EvidenceInput & {
  id: string;
  fingerprint: string;
  recordedAt: string;
  status: 'accepted' | 'rejected' | 'unverified';
  reason: string;
  review?: { ownerId: string; at: string; rationale: string; scopeFingerprint?: string };
  reviews?: { ownerId: string; at: string; rationale: string; scopeFingerprint?: string }[];
};
export type OfferedAction = {
  id: string;
  kind: 'photo_triage' | 'vin_identity' | 'market_comps' | 'repair_evidence';
  label: string;
  reason: string;
  maxCostCents: number;
  lineId?: string;
  priority?: number;
  impactDollars?: number;
  targetEvidenceIds?: string[];
};
export type Investigation = {
  id: string;
  action: OfferedAction;
  idempotencyKey: string;
  status: 'pending' | 'completed' | 'failed';
  startedAt: string;
  deadlineAt: string;
  finishedAt?: string;
  detail?: string;
  evidenceIds: string[];
  costCents: number;
  costBasis?: 'metered' | 'allowance_estimate';
};
/**
 * Which of a buyer's four arms produced their ceiling: their own discipline
 * share, their required surplus, the kernel's disciplined target clamping a
 * looser one, or the cash limit the acquisition has to fit inside (SPEC 58).
 */
export type BuyerCeilingBound = 'discipline' | 'surplus' | 'kernel' | 'cash';
export type AssessmentDecision = {
  revision: number;
  at: string;
  readiness: 'needs_evidence' | 'ready' | 'vetoed';
  verdict: 'build' | 'walk' | 'needs_evidence';
  ceiling: number | null;
  provisionalCeiling: number | null;
  unknowns: string[];
  reasons: string[];
  evidenceIds: string[];
  report?: SalvageReport;
  gates?: {
    id: string;
    label: string;
    status: 'met' | 'missing' | 'blocked';
    evidenceIds: string[];
    detail: string;
  }[];
  residualRisks?: string[];
  economicDominance?: { bestCaseMaxBid: number; observedBid: number; asOf: string };
  // The bidder's own arithmetic over the kernel's plan; `kernelMaxBid` is the
  // kernel's vehicle-relative ceiling for the same lot, `market` is the
  // marginal professional rebuilder's over the same plan and `edge` is the
  // difference between that ceiling and this buyer's, and `lines` carries every
  // buyer-side dollar with its basis (SPEC 59–60,
  // `src/assessments/buyer-ledger.ts`).
  buyerEconomics?: {
    laborOpportunityCost: number;
    holdingCost: number;
    fixedCost: number;
    maxBid: number;
    kernelMaxBid: number | null;
    market: { maxBid: number | null; basis: string; lines: CostLine[] };
    edge: number | null;
    maxAllIn: number;
    minSurplus: number;
    stressMaxBid: number;
    bestCaseMaxBid: number;
    cashAtCeiling: number;
    totalEconomicCostAtCeiling: number;
    exit: { low: number; typical: number; high: number; basis: string };
    // `share` is the share of the low exit the target actually held, whichever
    // of discipline, required surplus or the kernel's own target set it, and
    // `bound` names the arm that produced `maxBid`: `cash` when the acquisition
    // had to fit inside the stated limit, otherwise the arm that set the
    // target. A sentence that quotes the ceiling reads it, so it can name what
    // bound rather than a margin the ceiling merely kept (SPEC 58).
    discipline: { share: number; basis: string; bound: BuyerCeilingBound };
    lines: CostLine[];
  };
  lineage?: {
    id: string;
    kind: 'claim' | 'repair_hypothesis' | 'gate' | 'decision';
    evidenceIds: string[];
    dependsOn: string[];
    summary: string;
  }[];
};
export type Assessment = {
  id: string;
  ownerId: string;
  revision: number;
  epoch: number;
  lot: SalvageLot;
  // How a user-supplied lot was read: one chip per field, naming the pass
  // that filled it and why (SPEC 61). Absent on a seeded or fully stated lot.
  lotAssumptions?: Assumption[];
  mode: AssessmentMode;
  buyer?: BuyerProfile;
  refreshKinds?: OfferedAction['kind'][];
  refreshPending?: OfferedAction['kind'][];
  refreshRequestedAt?: string;
  fixtureCaseId?: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'investigating' | 'stopped';
  stopReason?: string;
  stopKind?: 'owner' | 'budget' | 'decision' | 'waiting';
  budget: {
    maxInvestigations: number;
    maxCostCents: number;
    usedInvestigations: number;
    reservedCostCents: number;
    spentCostCents: number;
  };
  evidence: AssessmentEvidence[];
  investigations: Investigation[];
  decision: AssessmentDecision;
  history: AssessmentDecision[];
  offeredActions: OfferedAction[];
  operations: { key: string; fingerprint: string }[];
  outcomes: {
    at: string;
    kind: OutcomeKind;
    note: string;
    amount?: number;
    // The winning bid, whoever won it. Records saved before the field existed
    // carry their hammer in `amount`.
    hammer?: number;
    repairCost?: number;
    holdingCost?: number;
    saleProceeds?: number;
    observedAt?: string;
    decisionRevision?: number;
    decisionCeiling?: number | null;
  }[];
};
export type CreateAssessmentInput = {
  seedLotId?: string;
  lot?: SalvageLot;
  intake?: {
    text: string;
    vin?: string;
    edits?: Partial<Record<IntakeField, string>>;
    photoUrls: string[];
    listingUrl?: string;
  };
  mode?: AssessmentMode;
  buyer?: BuyerProfile;
  fixtureCaseId?: string;
  budget?: { maxInvestigations?: number; maxCostCents?: number };
  idempotencyKey?: string;
};
export type RecordEvidenceInput = {
  evidence: EvidenceInput[];
  expectedRevision: number;
  idempotencyKey: string;
};
export type ReviewEvidenceInput = {
  evidenceIds: string[];
  expectedRevision: number;
  idempotencyKey: string;
  rationale: string;
};
export type UpdateBuyerInput = {
  buyer: BuyerProfile;
  expectedRevision: number;
  idempotencyKey: string;
};
export type InvestigationResult = { evidence: EvidenceInput[]; detail: string; costCents?: number };
export type AssessmentInvestigator = (
  assessment: Assessment,
  action: OfferedAction,
) => Promise<InvestigationResult>;
export interface AssessmentStore {
  create(
    assessment: Assessment,
    idempotencyKey?: string,
    fingerprint?: string,
  ): Promise<Assessment>;
  get(ownerId: string, id: string): Promise<Assessment | null>;
  list(ownerId: string): Promise<Assessment[]>;
  save(assessment: Assessment, expectedRevision: number): Promise<void>;
}
export class AssessmentError extends Error {
  constructor(
    public readonly code:
      | 'invalid_input'
      | 'not_found'
      | 'conflict'
      | 'not_offered'
      | 'budget_exhausted'
      | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'AssessmentError';
  }
}
