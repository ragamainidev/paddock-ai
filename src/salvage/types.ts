/**
 * Salvage-rebuild assessment types. The assessor answers one question — the
 * highest bid a disciplined rebuilder can place on this lot — and every
 * type here exists to make that number auditable: typed comps behind the
 * exit, typed price evidence behind the repair lines, cost lines with a
 * basis, and a ledger that records how the ceiling was solved and what
 * would change it. Money never enters as prose (SPEC 44).
 */

import type { VinCheck, VinSighting, WebFinding } from '@/inspector/types';
import type { Span } from '@/trace/tracer';

// -- The lot --------------------------------------------------------------------

export type SalvageLot = {
  id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  lotNumber: string; // as embedded by the source page (public pages mask a digit)
  source: string; // e.g. 'Copart via A Better Bid (licensed broker)' or 'user-supplied listing'
  // Provenance: the listing this data came from. Absent on a lot the user
  // brought without one; the server never fetches it either way (SPEC 61).
  url?: string;
  collectedOn: string;
  damage: { primary: string; secondary?: string };
  titleBrand: string; // honest: 'masked on public listing' when unknown
  odometer?: number; // miles; undefined when the listing says Unknown
  odometerNote?: string;
  location: string;
  saleDate?: string; // 'Future Sale' lots have none
  currentBid?: number; // at collection time — stale by design, labeled
  estRetailValue?: number; // ACV when a source stated it
  engine: string;
  drive?: string;
  fuel?: string;
  color?: string;
  photos: string[];
  notes?: string; // cross-source facts worth surfacing, with their source
};

// -- Damage triage (vision) -------------------------------------------------------

export type DamageKind = 'structural' | 'cosmetic' | 'mechanical' | 'electrical';
export type Severity = 'light' | 'moderate' | 'heavy';

export type DamageArea = {
  area: string; // e.g. "front clip", "left rocker", "rear subframe"
  kind: DamageKind;
  severity: Severity;
  description: string;
  photos: number[]; // validated indices, SPEC 21 discipline
};

export type DamageTriage = {
  overall: 'rebuildable' | 'borderline' | 'parts_car';
  areas: DamageArea[];
  airbagsDeployed: 'yes' | 'no' | 'unknown';
  floodEvidence: boolean;
  fireEvidence: boolean;
  drivetrainRisk: string; // what the photos suggest about engine/gearbox
  observations: { photo: number; note: string }[];
  confidence: number;
};

// -- Structured evidence (research) ------------------------------------------------

// A comparable sale or listing. The lane says which question it answers,
// the outcome says how real the price is. Raw evidence: selection
// annotations live on CompUse, never here.
export type CompLane = 'clean' | 'rebuilt' | 'wreck';
export type CompOutcome = 'sold' | 'ask' | 'bid_no_sale';
export type Comp = {
  lane: CompLane;
  outcome: CompOutcome;
  price: number; // USD, as the source states it
  year?: number;
  // Actual comparable identity, separate from the assessment subject (SPEC 53).
  vehicle?: { make: string; model: string; year: number };
  mileage?: number;
  date?: string; // as the source states it; ISO when the source gives one
  title?: 'clean' | 'rebuilt' | 'salvage' | 'unknown';
  variant?: string; // "Assetto Fiorano", "Spider": off-spec comps are struck, not averaged
  damage?: string; // wreck lane: the listed damage
  url: string;
  source: string; // hostname
  note?: string;
};

// A comp after selection: used or struck, and the price the math ran on
// (asks are haircut to transacted money before they anchor anything).
export type CompUse = {
  comp: Comp;
  used: boolean;
  adjusted: number;
  reason?: string; // why struck, or how adjusted
};

// A cited price for one repair line: a part, a labor figure, or a whole
// job quote. Line ids tie evidence to the plan (`front.structure`).
export type PriceKind = 'part_new' | 'part_used' | 'labor' | 'job_quote';
export type PriceEvidence = {
  line: string;
  item: string;
  kind: PriceKind;
  low: number;
  high: number;
  url: string;
  source: string;
  note?: string;
};

export type SalvageEvidence = { comps: Comp[]; prices: PriceEvidence[] };

// -- Repair programs (deterministic from triage + tiers) ---------------------------

// One damage event is one program (SPEC 43): a front hit is priced once
// however many triage zones describe it. Paint and the platform baseline
// (HV isolation, ADAS calibration, alignment) are programs of their own.
export type ProgramId =
  | 'front'
  | 'rear'
  | 'side_left'
  | 'side_right'
  | 'side'
  | 'roof_glass'
  | 'interior'
  | 'underbody'
  | 'wheels_suspension'
  | 'electrical'
  | 'srs'
  | 'flood'
  | 'paint'
  | 'baseline';

// Where a number came from. Rendered as the evidence chip.
export type LineEvidence = 'curated' | 'override' | 'cited' | 'schedule' | 'derived';

export type Range3 = { low: number; expected: number; high: number };

// Shop equipment a task cannot be done without: a frame rack or jig, a
// booth, an alignment rack, high-voltage isolation tooling. A bidder who
// lacks one buys that line professionally (docs/salvage-economics.md §4.1).
export type Equipment = 'structural' | 'paint' | 'alignment' | 'hv';

export type RepairLine = Range3 & {
  id: string; // stable: `${program}.${slug}`
  program: ProgramId;
  task: string;
  who: 'diy' | 'pro';
  reason: string; // why this split — shown, always
  diyHours?: number; // when who === 'diy'
  // What the same task costs bought from a shop. A DIY line's own range is
  // parts and materials with the builder's hours at $0, so its professional
  // price is that range plus those hours at the tier's shop rate; a line
  // already professional prices at its own range.
  pro: Range3;
  requires: Equipment[]; // empty when hand tools and a driveway suffice
  evidence: LineEvidence;
  basis: string; // "curated: exotic tier" | "override: SF90 Stradale" | "cited: eurospares.co.uk"
  citations?: { url: string; title: string }[];
  researchTopic?: string; // how a worker would price this line, when it is worth a worker
};

export type RepairProgram = {
  id: ProgramId;
  label: string;
  zones: string[]; // triage areas folded into this program
  photos: number[];
  severity: Severity;
  structural: boolean;
  lines: RepairLine[];
};

export type RepairPlan = Range3 & {
  programs: RepairProgram[];
  lines: RepairLine[]; // flattened, program order
  diyHoursTotal: number;
  tier: MarqueTier;
  tierLabel: string; // "exotic tier · SF90 Stradale overrides"
  missed: string[]; // "what people miss" for this damage + construction
};

export type MarqueTier = 'exotic' | 'premium' | 'mainstream';

// How a bidder reaches the auction and leaves the car. Both change kernel
// money — the broker's cut, the selling band and the rebuilt exit — so they
// are kernel vocabulary; `src/assessments/types.ts` re-exports them for the
// buyer profile that carries them (SPEC 50).
export type BuyerAccess = 'broker' | 'direct';
export type ExitChannel = 'private_party' | 'wholesale' | 'retail' | 'keep';

// -- Ledger / ceiling ---------------------------------------------------------------

export type ExitLane = 'rebuilt_sold' | 'clean_sold_derived' | 'clean_ask_derived' | 'acv_derived';

export type ExitEstimate = {
  low: number;
  typical: number;
  high: number;
  lane: ExitLane;
  basis: string;
  n: number; // comps the numbers were computed from
  discount?: { low: number; high: number; basis: string }; // derived lanes only
  comps: CompUse[]; // every exit-lane comp, used or struck
  thin: boolean; // fewer than three comps: the band was widened and says so
};

export type WreckMarket = {
  low: number;
  median: number;
  high: number;
  n: number;
  nSold: number;
  basis: string;
  comps: CompUse[];
};

// `labor` and `holding` are the bidder's own money and time; the kernel
// ledger is vehicle-relative and never emits them (SPEC 59,
// `src/assessments/buyer-ledger.ts`).
export type CostGroup =
  'fees' | 'transport' | 'repair' | 'contingency' | 'title' | 'selling' | 'labor' | 'holding';

export type CostLine = Range3 & {
  id: string;
  label: string;
  group: CostGroup;
  basis: string;
  evidence: LineEvidence;
  program?: ProgramId;
  bidDependent?: boolean; // buyer fee: shown at the ceiling
};

export type LadderStep = {
  id: string;
  label: string;
  amount: number; // dollars removed from the exit at this step; the ceiling row carries what is left
  kind: 'exit' | 'margin' | 'cost' | 'bid_fee' | 'ceiling';
  group?: CostGroup;
  killer?: boolean;
};

export type SensitivityRow = {
  id: string;
  label: string;
  ceiling: number | null;
  delta: number | null; // vs the headline ceiling
  note: string;
};

// What would have to be true for a zero ceiling to turn positive: the
// required value of one input holding everything else at expected.
export type Unlock = {
  id: string;
  label: string;
  required: number;
  evidence: number; // what the evidence currently says that input is
  feasible: boolean; // the evidence leaves room for it (a line above its low, an exit under its high)
  note: string; // a clause completing "it turns positive only if …"
};

export type SalvageLedger = {
  exit: ExitEstimate | null;
  wreck: WreckMarket | null;
  costs: CostLine[]; // fee lines rendered at the ceiling (or at $0 when none)
  discipline: { share: number; basis: string };
  ceiling: number | null; // null: no exit to solve against; 0: nothing clears
  breakEven: number | null;
  stress: number | null; // every repair line at its high
  allInAtCeiling: number | null;
  ladder: LadderStep[];
  killers: { id: string; label: string; expected: number }[];
  unlocks: Unlock[];
  sensitivity: SensitivityRow[];
  diyHours: number; // the builder's own time, priced at $0 but never hidden
  feesScheduleDate: string;
};

// -- Assessment ---------------------------------------------------------------------

// The verdict is the bid decision. `part_out`, `parts_car`, and `watch`
// survive only for replaying reports persisted before the ceiling model.
export type SalvagePlay = 'build' | 'walk' | 'part_out' | 'parts_car' | 'watch';

export type SalvageAssessment = {
  verdict: SalvagePlay;
  confidence: number;
  // The audit trail behind the number: base photo-triage confidence plus a
  // delta per corroborating (or missing) piece of evidence.
  confidenceFactors: { label: string; delta: number }[];
  summary: string;
  dealbreakers: string[];
  watchItems: string[];
};

export type SalvageReport = {
  lot: SalvageLot;
  triage: DamageTriage;
  plan: RepairPlan;
  evidence: SalvageEvidence;
  research: WebFinding[]; // cited narrative notes from the workers
  sightings: VinSighting[];
  vinCheck?: VinCheck;
  ledger?: SalvageLedger;
  assessment: SalvageAssessment;
  stages: { stage: SalvageStage; ok: boolean; detail?: string }[];
  generatedAt: string;
  legacy?: true; // persisted by the pre-ceiling model; rendered as a summary only
};

// -- Stages and events ----------------------------------------------------------------

export type SalvageStage = 'triage' | 'plan' | 'research' | 'vin' | 'ledger' | 'synthesis';

export type SalvageStageStatus = { stage: SalvageStage; ok: boolean; detail?: string };

export type SalvageEvent =
  | { type: 'begin'; stage: SalvageStage }
  | { type: 'span'; span: Span }
  | { type: 'stage'; status: SalvageStageStatus }
  | { type: 'thought'; stage: SalvageStage; text: string }
  | { type: 'photo'; index: number; note: string }
  | { type: 'triage'; triage: DamageTriage }
  | { type: 'repair-plan'; plan: RepairPlan }
  | { type: 'comps'; comps: Comp[] }
  | { type: 'prices'; prices: PriceEvidence[] }
  | { type: 'web'; finding: WebFinding }
  | { type: 'sightings'; sightings: VinSighting[] }
  | { type: 'vin'; check: VinCheck }
  | { type: 'ledger'; ledger: SalvageLedger }
  | { type: 'report'; report: SalvageReport }
  | { type: 'fatal'; message: string };
