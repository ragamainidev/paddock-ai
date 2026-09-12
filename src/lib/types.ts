import type { Aspiration, BlockType, Drive, Fuel } from './normalize';

// A Constraint is everything the interpreter managed to pin down. Fields the
// data cannot filter on (transmission, color, weight…) never become columns —
// they land in `unfilterable` and are forwarded to listing search instead.
export type Constraint = {
  make?: string;
  models?: string[]; // SQL LIKE patterns against vehicles.model, ANY-match
  yearMin?: number;
  yearMax?: number;
  // AND of OR-groups against trim/submodel/model: [['GT3'], ['Touring']]
  // requires both; [['ZR1', 'ZR-1']] accepts either spelling of one concept.
  trimContains?: string[][];
  cylinders?: number;
  displacement?: number; // liters, when known from a requested engine definition
  blockType?: BlockType;
  aspiration?: Aspiration;
  drive?: Drive;
  body?: string; // substring match against vehicles.body
  doors?: number;
  fuel?: Fuel;
  exclude?: {
    trimContains?: string[]; // NONE may match trim/submodel/model
    aspiration?: Aspiration[]; // rows explicitly marked with these are dropped
  };
  // Union of alternatives, ORed together and ANDed with the fields above.
  // Engine codes produce these: "2JZ" = (Supra 93–98) OR (SC300 92–97) OR
  // (IS300 01–05). This is a union result, not an ambiguity fork.
  anyOf?: FitmentFilter[];
  unfilterable?: Unfilterable[];
};

export type FitmentFilter = {
  make?: string;
  models?: string[];
  yearMin?: number;
  yearMax?: number;
  trimContains?: string[]; // one OR-group: any of these trims qualifies
  label?: string; // human-readable match reason, e.g. 'ships with the 2JZ'
};

export type Unfilterable = {
  term: string; // what the user said: 'manual', 'brown'
  reason: string; // why we can't filter: 'no transmission data'
  forwardedToListings: boolean;
};

export type Assumption = {
  source: 'chassis' | 'engine' | 'variant' | 'keyword' | 'model' | 'generation' | 'llm';
  input: string; // the token: '992'
  meaning: string; // what it became: 'Porsche 911, 2019+'
  reason: string; // why: knowledge-table note or model rationale
};

// One reading of the query. Ambiguous queries produce several branches;
// the UI renders them side by side and never auto-picks.
export type Branch = {
  label: string; // 'Corvette C7, 2014–2019'
  constraint: Constraint;
  assumptions: Assumption[];
};

export type Interpretation = {
  branches: Branch[];
  unparsed: string[]; // tokens nothing could interpret — flagged, not fatal
  // Readings killed by internal contradiction ('porsche civic'), explained.
  conflicts: string[];
};

export type EngineSummary = {
  engine: string | null; // full display string from the data
  count: number;
};

export type ResolvedVehicle = {
  make: string;
  model: string;
  yearMin: number;
  yearMax: number;
  trims: string[];
  engines: EngineSummary[];
  drive: string[];
  body: string[];
  score: number;
  reasons: string[]; // human-readable match reasons
  rowCount: number;
  unresolved?: string[]; // requested facts absent from these catalog rows
  catalogYears?: number[]; // observed years, never production boundaries
};

export type StageStatus = {
  stage: 'interpret' | 'resolve' | 'nhtsa' | 'ebay' | 'themes';
  ok: boolean;
  detail?: string; // shown in the UI when a stage degrades
};
