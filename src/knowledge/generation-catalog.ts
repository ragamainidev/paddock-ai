import catalogJson from '../../data/public-generations.json';

// Public family identities come from cited EPA source records. Generation and
// facelift boundaries are deliberately absent until independently researched
// from manufacturer references: catalog coverage cannot establish production
// boundaries. Curated tokenizer entries retain precedence over this fallback.

export type GenerationPhase = {
  kind: 'pre-facelift' | 'facelift';
  yearMin: number;
  yearMax: number;
};

export type FamilyGeneration = {
  name: string; // "Type 42", "C6", "AP2", "S550"
  ordinal: number; // 1-based: "gen 1", "mk2"
  aliases: string[]; // lowercase: chassis codes, "gen 1", platform names
  yearMin: number;
  yearMax: number;
  phases?: GenerationPhase[]; // independently cited model-year boundary
  citations: string[]; // http(s) sources the compiler used
};

export type GenerationFamily = {
  make: string;
  family: string; // display name: "R8"
  modelLike: string[]; // SQL LIKE patterns against vehicles.model
  modelTokens: string[]; // lowercase query tokens that name this family
  generations: FamilyGeneration[];
  compiledOn: string;
  identitySourceIds?: string[];
  identityCitations?: string[];
};

export type GenerationCatalog = { families: GenerationFamily[] };

export const GENERATION_CATALOG: GenerationCatalog = catalogJson as GenerationCatalog;

// Token → family, for resolving model words the hand tables don't cover.
// Only consulted for tokens every other lookup left unknown.
const byToken = new Map<string, GenerationFamily>();
for (const family of GENERATION_CATALOG.families) {
  for (const token of family.modelTokens) byToken.set(token, family);
}

export function lookupGenerationFamily(token: string): GenerationFamily | undefined {
  return byToken.get(token.toLowerCase());
}

// Family for an already-resolved constraint (make + models), so ordinal and
// facelift words can attach to it regardless of token order.
export function familyForConstraint(
  make: string | undefined,
  models: string[] | undefined,
): GenerationFamily | undefined {
  if (!make || !models || models.length === 0) return undefined;
  return GENERATION_CATALOG.families.find(
    (f) =>
      f.make === make &&
      models.every((m) =>
        f.modelLike.some(
          (pattern) =>
            pattern.replace(/%/g, '').toLowerCase() === m.replace(/%/g, '').toLowerCase() ||
            m.replace(/%/g, '').toLowerCase().startsWith(pattern.replace(/%/g, '').toLowerCase()),
        ),
      ),
  );
}
