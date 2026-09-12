// The knowledge table is the bridge between how enthusiasts talk and how the
// database names things. Codes here are curated and validated against the eval
// DB by knowledge.test.ts — the model never recalls these from scratch.

export type ChassisEntry = {
  code: string; // canonical form, e.g. 'E46'
  aliases?: string[]; // lowercase alternates, e.g. ['e92', 'e93'] on the E90 entry
  make: string;
  family: string; // human name: '3 Series', '911', 'Corvette'
  modelLike: string[]; // SQL LIKE patterns against vehicles.model
  yearMin: number;
  yearMax: number;
  note: string; // shown to the user as the assumption reason
  jdmOnly?: boolean; // true → documents absence; must match ZERO US rows
  contextRequired?: boolean; // token collides with common words (NA, NB…);
  // only decode when query context names the family
};

export type EngineFitment = {
  make: string;
  modelLike: string[];
  yearMin: number;
  yearMax: number;
  trimContains?: string[]; // narrow to trims, e.g. LS6 → Z06
};

export type EngineEntry = {
  code: string; // canonical form, e.g. '2JZ'
  aliases?: string[];
  note: string;
  cylinders?: number;
  blockType?: 'L' | 'V' | 'H' | 'W' | 'R';
  displacement?: number;
  jdmOnly?: boolean;
  fitments: EngineFitment[];
};

export type ModelWord = {
  token: string; // 'supra'
  aliases?: string[];
  make: string;
  models: string[]; // SQL LIKE patterns against vehicles.model
  yearMin?: number;
  yearMax?: number;
  note?: string;
  jdmOnly?: boolean; // must match zero rows: documents absence
};

// A trim family's model years within one chassis generation. Chassis
// calendar windows overlap at their boundaries (a MY2012 GT3 RS is a 997,
// not a 991); when a query names both the chassis and the trim, the
// generation window wins over the raw chassis window. Validated against the
// eval DB like everything else in this table.
export type VariantGeneration = { chassis: string; yearMin: number; yearMax: number };

export type VariantEntry = {
  term: string; // canonical form, e.g. 'GT3 RS'
  aliases?: string[];
  trimContains: string[]; // ANY-match against trim/submodel
  note: string;
  // where this trim really exists, optionally with per-chassis year windows
  fitments: { make: string; modelLike: string[]; generations?: VariantGeneration[] }[];
};
