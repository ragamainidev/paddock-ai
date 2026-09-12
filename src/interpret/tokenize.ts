import {
  lookupChassis,
  lookupEngine,
  lookupMake,
  lookupModelWord,
  lookupVariant,
} from '@/knowledge';
import type { ChassisEntry, EngineEntry, ModelWord, VariantEntry } from '@/knowledge';
import {
  familyForConstraint,
  lookupGenerationFamily,
  type GenerationPhase,
} from '@/knowledge/generation-catalog';
import { likeToRegex } from '@/lib/like';
import type { Aspiration, BlockType, Drive, Fuel } from '@/lib/normalize';
import type { Assumption, Branch, Constraint, Interpretation } from '@/lib/types';

// Deterministic interpreter: query text → Interpretation, no model call.
// Two passes over the scanned units. Pass A applies identity units (chassis,
// engine, variant, model, make, year) — these can fork a branch (ambiguous
// chassis code), kill it (make contradiction), or union fitments (engine
// codes). Pass B applies spec keywords and negations per surviving branch,
// because their meaning depends on identity context ('turbo' is a trim on a
// 911, an aspiration on a Miata).

// ── Scanner vocabulary ───────────────────────────────────────────────────

const NEGATION_TRIGGERS = new Set(['no', 'not', 'without']);
const ARTICLES = new Set(['the', 'a', 'an']);
const STOPWORDS = new Set([
  ...ARTICLES,
  'and',
  'or',
  'with',
  'for',
  'me',
  'i',
  'my',
  'in',
  'any',
  'anything',
  'some',
  'car',
  'cars',
  'want',
  'looking',
  'find',
  'show',
  'please',
]);

const BODY: Record<string, string> = {
  coupe: 'Coupe',
  convertible: 'Convertible',
  cabriolet: 'Convertible',
  cabrio: 'Convertible',
  vert: 'Convertible',
  roadster: 'Convertible',
  hatchback: 'Hatchback',
  hatch: 'Hatchback',
  sedan: 'Sedan',
  saloon: 'Sedan',
  wagon: 'Wagon',
  estate: 'Wagon',
  pickup: 'Pickup',
  truck: 'Pickup',
  van: 'Van',
  suv: 'SUV',
};

const DRIVE: Record<string, Drive> = {
  rwd: 'RWD',
  fwd: 'FWD',
  awd: 'AWD',
  '4wd': '4WD',
  '4x4': '4WD',
};

const FUEL: Record<string, Fuel> = {
  diesel: 'DIESEL',
  gas: 'GAS',
  gasoline: 'GAS',
  petrol: 'GAS',
  electric: 'ELECTRIC',
  ev: 'ELECTRIC',
  hybrid: 'HYBRID',
};

// 'turbo' and 'tt' are deliberately absent: they need branch context.
const ASPIRATION: Record<string, Aspiration> = {
  turbocharged: 'Turbo',
  supercharged: 'Supercharged',
  'naturally aspirated': 'NA',
  'n/a': 'NA',
};

const TURBO_WORDS = new Set(['turbo', 'tt', 'twin turbo', 'twin-turbo', 'turbocharged']);

type EngineConfig = { blockType?: BlockType; cylinders?: number };
const ENGINE_CONFIG: Record<string, EngineConfig> = {
  v6: { blockType: 'V', cylinders: 6 },
  v8: { blockType: 'V', cylinders: 8 },
  v10: { blockType: 'V', cylinders: 10 },
  v12: { blockType: 'V', cylinders: 12 },
  i4: { blockType: 'L', cylinders: 4 },
  i6: { blockType: 'L', cylinders: 6 },
  'inline four': { blockType: 'L', cylinders: 4 },
  'inline-four': { blockType: 'L', cylinders: 4 },
  'inline six': { blockType: 'L', cylinders: 6 },
  'inline-six': { blockType: 'L', cylinders: 6 },
  'straight six': { blockType: 'L', cylinders: 6 },
  'straight-six': { blockType: 'L', cylinders: 6 },
  'flat four': { blockType: 'H', cylinders: 4 },
  'flat-four': { blockType: 'H', cylinders: 4 },
  'flat six': { blockType: 'H', cylinders: 6 },
  'flat-six': { blockType: 'H', cylinders: 6 },
  'boxer four': { blockType: 'H', cylinders: 4 },
  'boxer six': { blockType: 'H', cylinders: 6 },
  boxer: { blockType: 'H' },
  rotary: { blockType: 'R' },
  wankel: { blockType: 'R' },
};

const TRANSMISSION = new Set([
  'manual',
  'stick',
  'stick shift',
  'stickshift',
  'automatic',
  'auto',
  'pdk',
  'dct',
  'dsg',
  'cvt',
  'tiptronic',
  '6mt',
  '5mt',
  '6-speed',
  '5-speed',
]);

const COLORS = new Set([
  'black',
  'white',
  'red',
  'blue',
  'green',
  'brown',
  'tan',
  'beige',
  'silver',
  'gray',
  'grey',
  'yellow',
  'orange',
  'purple',
  'gold',
  'burgundy',
  'maroon',
]);

const WEIGHT_WORDS = new Set(['light', 'lightweight']);

// ── Units ────────────────────────────────────────────────────────────────

type Spec =
  | { type: 'body'; value: string }
  | { type: 'drive'; value: Drive }
  | { type: 'fuel'; value: Fuel }
  | { type: 'aspiration'; value: Aspiration }
  | { type: 'turbo' } // trim vs aspiration vs Audi TT — branch decides
  | { type: 'engineConfig'; config: EngineConfig }
  | { type: 'doors'; value: number }
  | { type: 'unfilterable'; reason: string; forwarded: boolean };

type Unit =
  | { kind: 'chassis'; raw: string; entries: ChassisEntry[] }
  | { kind: 'engine'; raw: string; entry: EngineEntry }
  | { kind: 'variant'; raw: string; entry: VariantEntry }
  | { kind: 'model'; raw: string; entry: ModelWord }
  | { kind: 'make'; raw: string; make: string }
  | { kind: 'year'; raw: string; yearMin?: number; yearMax?: number }
  | { kind: 'genOrdinal'; raw: string; n: number }
  | { kind: 'genPhase'; raw: string; phase: GenerationPhase['kind'] }
  | { kind: 'spec'; raw: string; spec: Spec }
  | { kind: 'negation'; raw: string; target: string }
  | { kind: 'unknown'; raw: string };

// ── Normalization ────────────────────────────────────────────────────────

function normalizeQuery(raw: string): string[] {
  let s = raw.toLowerCase();
  s = s.replace(/[^a-z0-9%+'/\- ]+/g, ' ');
  // glued chassis+variant: '992gt3' → '992 gt3' ('gt3rs' stays whole — it's
  // a variant alias in its own right, so '992gt3rs' → '992 gt3rs')
  s = s.replace(/\b(\d{3})(gt\d\w*)/g, '$1 $2');
  // glued generation prefix: 'mk4supra' → 'mk4 supra'
  s = s.replace(/\b(mk\d)([a-z]+)/g, '$1 $2');
  return s.split(/\s+/).filter(Boolean);
}

// Makes named anywhere in the query, used to unlock context-required chassis
// codes ('na' only means the Miata chassis when something says Mazda).
function scanContextMakes(tokens: string[]): Set<string> {
  const makes = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    for (const w of [2, 1]) {
      if (i + w > tokens.length) continue;
      const phrase = tokens.slice(i, i + w).join(' ');
      const make = lookupMake(phrase);
      if (make) makes.add(make);
      const model = lookupModelWord(phrase);
      if (model) makes.add(model.make);
      for (const c of lookupChassis(phrase)) {
        if (!c.contextRequired) makes.add(c.make);
      }
    }
  }
  return makes;
}

// ── Scanner ──────────────────────────────────────────────────────────────

function matchYear(t: string): Unit | undefined {
  let m: RegExpExecArray | null;
  if (/^(19|20)\d{2}$/.test(t)) return { kind: 'year', raw: t, yearMin: +t, yearMax: +t };
  if ((m = /^((?:19|20)\d{2})-((?:19|20)\d{2})$/.exec(t)))
    return { kind: 'year', raw: t, yearMin: +m[1], yearMax: +m[2] };
  if ((m = /^((?:19|20)\d{2})\+$/.exec(t))) return { kind: 'year', raw: t, yearMin: +m[1] };
  if ((m = /^pre-?((?:19|20)\d{2})$/.exec(t))) return { kind: 'year', raw: t, yearMax: +m[1] - 1 };
  if ((m = /^post-?((?:19|20)\d{2})$/.exec(t))) return { kind: 'year', raw: t, yearMin: +m[1] + 1 };
  if ((m = /^'(\d{2})$/.exec(t))) {
    const y = +m[1] >= 30 ? 1900 + +m[1] : 2000 + +m[1];
    return { kind: 'year', raw: t, yearMin: y, yearMax: y };
  }
  if ((m = /^((?:19|20)\d{2})s$/.exec(t)) && +m[1] % 10 === 0)
    return { kind: 'year', raw: t, yearMin: +m[1], yearMax: +m[1] + 9 };
  if ((m = /^(\d{2})s$/.exec(t)) && +m[1] % 10 === 0) {
    const base = +m[1] >= 30 ? 1900 + +m[1] : 2000 + +m[1];
    return { kind: 'year', raw: t, yearMin: base, yearMax: base + 9 };
  }
  return undefined;
}

function matchSpec(phrase: string): Spec | undefined {
  if (TURBO_WORDS.has(phrase) || phrase === 'tt') return { type: 'turbo' };
  if (phrase === 'na') return { type: 'aspiration', value: 'NA' };
  if (phrase in ASPIRATION) return { type: 'aspiration', value: ASPIRATION[phrase] };
  if (phrase in BODY) return { type: 'body', value: BODY[phrase] };
  if (phrase in DRIVE) return { type: 'drive', value: DRIVE[phrase] };
  if (phrase in FUEL) return { type: 'fuel', value: FUEL[phrase] };
  if (phrase in ENGINE_CONFIG) return { type: 'engineConfig', config: ENGINE_CONFIG[phrase] };
  const doors = /^([24])-?(?:door|doors|dr)$/.exec(phrase) ?? /^(two|four) door$/.exec(phrase);
  if (doors) {
    const n = doors[1] === 'two' ? 2 : doors[1] === 'four' ? 4 : +doors[1];
    return { type: 'doors', value: n };
  }
  if (TRANSMISSION.has(phrase))
    return {
      type: 'unfilterable',
      reason: 'transmission is not in the vehicle data',
      forwarded: true,
    };
  if (COLORS.has(phrase))
    return { type: 'unfilterable', reason: 'color is not in the vehicle data', forwarded: true };
  if (WEIGHT_WORDS.has(phrase))
    return {
      type: 'unfilterable',
      reason: 'curb weight is not in the vehicle data',
      forwarded: false,
    };
  return undefined;
}

function matchPhrase(phrase: string, contextMakes: Set<string>): Unit | undefined {
  const variant = lookupVariant(phrase);
  if (variant) return { kind: 'variant', raw: phrase, entry: variant };

  const chassisHits = lookupChassis(phrase).filter(
    (c) => !c.contextRequired || contextMakes.has(c.make),
  );
  if (chassisHits.length > 0) return { kind: 'chassis', raw: phrase, entries: chassisHits };

  const engine = lookupEngine(phrase);
  if (engine) return { kind: 'engine', raw: phrase, entry: engine };

  const model = lookupModelWord(phrase);
  if (model) return { kind: 'model', raw: phrase, entry: model };

  // Compiled generation catalog: model tokens the hand tables don't cover
  // resolve deterministically here — the catalog was validated against the
  // DB at compile time, so this is data, not lore.
  const catalogFamily = lookupGenerationFamily(phrase);
  if (catalogFamily) {
    return {
      kind: 'model',
      raw: phrase,
      entry: {
        token: phrase,
        make: catalogFamily.make,
        models: [...catalogFamily.modelLike],
        note: `${catalogFamily.make} ${catalogFamily.family} (public family catalog, recorded ${catalogFamily.compiledOn})`,
      },
    };
  }

  const make = lookupMake(phrase);
  if (make) return { kind: 'make', raw: phrase, make };

  const year = matchYear(phrase) ?? matchYearPhrase(phrase);
  if (year) return year;

  // Generation ordinals and facelift phases attach to a family at finalize,
  // once the rest of the query has said which family. 'mkN' only lands here
  // when no chassis entry claimed it above.
  let m: RegExpExecArray | null;
  if ((m = /^(?:gen|generation|mk|mark)\s?(\d{1,2})$/.exec(phrase))) {
    return { kind: 'genOrdinal', raw: phrase, n: +m[1] };
  }
  if (/^(?:facelift|lci|refresh(?:ed)?)$/.test(phrase)) {
    return { kind: 'genPhase', raw: phrase, phase: 'facelift' };
  }
  if (/^(?:pre-?facelift|pre-?lci|pre-?refresh)$/.test(phrase)) {
    return { kind: 'genPhase', raw: phrase, phase: 'pre-facelift' };
  }

  const spec = matchSpec(phrase);
  if (spec) return { kind: 'spec', raw: phrase, spec };

  return undefined;
}

function matchYearPhrase(phrase: string): Unit | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^(?:pre|before) ((?:19|20)\d{2})$/.exec(phrase)))
    return { kind: 'year', raw: phrase, yearMax: +m[1] - 1 };
  if ((m = /^(?:post|after|since) ((?:19|20)\d{2})$/.exec(phrase)))
    return { kind: 'year', raw: phrase, yearMin: +m[1] + 1 };
  return undefined;
}

// Negation targets we know how to handle; anything else stays unparsed.
function isNegatable(phrase: string): boolean {
  return (
    TURBO_WORDS.has(phrase) ||
    phrase === 'na' ||
    phrase in ASPIRATION ||
    TRANSMISSION.has(phrase) ||
    COLORS.has(phrase) ||
    lookupVariant(phrase) !== undefined
  );
}

function scan(tokens: string[]): Unit[] {
  const contextMakes = scanContextMakes(tokens);
  const units: Unit[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (NEGATION_TRIGGERS.has(t) && i + 1 < tokens.length) {
      let j = i + 1;
      if (ARTICLES.has(tokens[j]) && j + 1 < tokens.length) j++;
      const two = j + 1 < tokens.length ? `${tokens[j]} ${tokens[j + 1]}` : undefined;
      if (two && isNegatable(two)) {
        units.push({ kind: 'negation', raw: `${t} ${two}`, target: two });
        i = j + 2;
        continue;
      }
      units.push({ kind: 'negation', raw: `${t} ${tokens[j]}`, target: tokens[j] });
      i = j + 1;
      continue;
    }
    let matched: { unit: Unit; width: number } | undefined;
    for (const w of [3, 2, 1]) {
      if (i + w > tokens.length) continue;
      const unit = matchPhrase(tokens.slice(i, i + w).join(' '), contextMakes);
      if (unit) {
        matched = { unit, width: w };
        break;
      }
    }
    if (matched) {
      units.push(matched.unit);
      i += matched.width;
    } else if (STOPWORDS.has(t)) {
      i++;
    } else {
      units.push({ kind: 'unknown', raw: t });
      i++;
    }
  }
  return units;
}

// ── Pass A: identity units build, fork, prune ────────────────────────────

type Working = {
  constraint: Constraint;
  assumptions: Assumption[];
  dead?: string; // conflict explanation once the branch is impossible
  chassisCode?: string; // set when a chassis code applied — generation refinement
  variantRefs?: { entry: VariantEntry; raw: string }[]; // variants applied to this branch
  genOrdinal?: { n: number; raw: string }; // "gen 1" / "mk2", attached at finalize
  genPhase?: { kind: GenerationPhase['kind']; raw: string }; // "facelift" / "pre-facelift"
};

function cloneWorking(b: Working): Working {
  return {
    constraint: structuredClone(b.constraint),
    assumptions: [...b.assumptions],
    chassisCode: b.chassisCode,
    variantRefs: b.variantRefs ? [...b.variantRefs] : undefined,
    genOrdinal: b.genOrdinal,
    genPhase: b.genPhase,
  };
}

function stripPct(p: string): string {
  return p.replace(/%/g, '');
}

// Intersect two LIKE-pattern lists: a pattern survives if the other side has
// the same pattern, or a pattern that subsumes it (literal 'M3' survives
// against ['323%', 'M3']; '323%' dies against ['M3']).
function intersectModels(a: string[], b: string[]): string[] {
  const covered = (p: string, other: string[]) =>
    other.some((q) => q === p || (!p.includes('%') && likeToRegex(q).test(p)));
  const out: string[] = [];
  for (const p of a) if (covered(p, b) && !out.includes(p)) out.push(p);
  for (const p of b) if (covered(p, a) && !out.includes(p)) out.push(p);
  return out;
}

function intersectYears(c: Constraint, yearMin?: number, yearMax?: number): void {
  // Impossible windows (min > max) are preserved: resolve then returns zero
  // rows and the UI can say why, instead of silently widening the query.
  if (yearMin !== undefined)
    c.yearMin = c.yearMin === undefined ? yearMin : Math.max(c.yearMin, yearMin);
  if (yearMax !== undefined)
    c.yearMax = c.yearMax === undefined ? yearMax : Math.min(c.yearMax, yearMax);
}

function setMake(b: Working, make: string, raw: string): boolean {
  if (b.constraint.make && b.constraint.make !== make) {
    b.dead = `"${raw}" is a ${make}, but the query already pins ${b.constraint.make}`;
    return false;
  }
  b.constraint.make = make;
  return true;
}

function narrowModels(b: Working, models: string[], raw: string): boolean {
  if (!b.constraint.models) {
    b.constraint.models = [...models];
    return true;
  }
  const next = intersectModels(b.constraint.models, models);
  if (next.length === 0) {
    const had = b.constraint.models.map(stripPct).join('/');
    b.dead = `"${raw}" names ${models.map(stripPct).join('/')}, which is not a ${had}`;
    return false;
  }
  b.constraint.models = next;
  return true;
}

function pushTrimGroup(c: Constraint, group: string[]): void {
  c.trimContains ??= [];
  c.trimContains.push(group);
}

function applyChassis(b: Working, e: ChassisEntry, raw: string): Working {
  if (!setMake(b, e.make, raw)) return b;
  if (!narrowModels(b, e.modelLike, raw)) return b;
  intersectYears(b.constraint, e.yearMin, e.yearMax);
  b.chassisCode = e.code;
  b.assumptions.push({
    source: 'chassis',
    input: raw,
    meaning: `${e.make} ${e.family}, ${e.yearMin}–${e.yearMax}`,
    reason: e.note,
  });
  return b;
}

function applyEngine(b: Working, e: EngineEntry, raw: string): void {
  if (e.jdmOnly || e.fitments.length === 0) {
    b.assumptions.push({
      source: 'engine',
      input: raw,
      meaning: `${e.code}: no US-market car shipped with it`,
      reason: e.note,
    });
    return;
  }
  // An engine's known mechanical attributes constrain candidates, but its
  // broad model/year fitments do not certify the exact installed engine.
  if (e.cylinders !== undefined) b.constraint.cylinders = e.cylinders;
  if (e.blockType !== undefined) b.constraint.blockType = e.blockType;
  if (e.displacement !== undefined) b.constraint.displacement = e.displacement;
  addUnfilterable(b.constraint, e.code, 'catalog does not verify exact engine codes', true);
  const applicable = b.constraint.make
    ? e.fitments.filter((f) => f.make === b.constraint.make)
    : e.fitments;
  if (applicable.length === 0) {
    b.dead = `no ${b.constraint.make} ever shipped with the ${e.code}`;
    return;
  }
  if (applicable.length === 1 && b.constraint.make) {
    const f = applicable[0];
    if (!narrowModels(b, f.modelLike, raw)) return;
    intersectYears(b.constraint, f.yearMin, f.yearMax);
    if (f.trimContains) pushTrimGroup(b.constraint, f.trimContains);
  } else {
    b.constraint.anyOf = applicable.map((f) => ({
      make: f.make,
      models: [...f.modelLike],
      yearMin: f.yearMin,
      yearMax: f.yearMax,
      ...(f.trimContains ? { trimContains: [...f.trimContains] } : {}),
      label: `${f.make} ${f.modelLike.map(stripPct).join('/')} model/year candidate for ${e.code}`,
    }));
  }
  b.assumptions.push({
    source: 'engine',
    input: raw,
    meaning: `${e.code} → ${applicable.map((f) => `${f.make} ${f.modelLike.map(stripPct).join('/')}`).join(', ')}`,
    reason: e.note,
  });
}

function applyVariant(b: Working, v: VariantEntry, raw: string): void {
  const applicable = b.constraint.make
    ? v.fitments.filter((f) => f.make === b.constraint.make)
    : v.fitments;
  if (applicable.length === 0) {
    b.dead = `${v.term} does not exist on a ${b.constraint.make}`;
    return;
  }
  if (applicable.length === 1) {
    const f = applicable[0];
    if (!setMake(b, f.make, raw)) return;
    if (!narrowModels(b, f.modelLike, raw)) return;
    pushTrimGroup(b.constraint, [...v.trimContains]);
    (b.variantRefs ??= []).push({ entry: v, raw });
  } else {
    b.constraint.anyOf = applicable.map((f) => ({
      make: f.make,
      models: [...f.modelLike],
      trimContains: [...v.trimContains],
      label: `${v.term}: ${f.make} ${f.modelLike.map(stripPct).join('/')}`,
    }));
  }
  b.assumptions.push({
    source: 'variant',
    input: raw,
    meaning: `${v.term} trim on ${applicable.map((f) => `${f.make} ${f.modelLike.map(stripPct).join('/')}`).join(' or ')}`,
    reason: v.note,
  });
}

function refineVariantGenerations(b: Working): void {
  if (!b.chassisCode || !b.variantRefs) return;
  for (const { entry, raw } of b.variantRefs) {
    const fitment = entry.fitments.find(
      (f) =>
        f.make === b.constraint.make && f.generations?.some((g) => g.chassis === b.chassisCode),
    );
    const gen = fitment?.generations?.find((g) => g.chassis === b.chassisCode);
    if (!gen) continue;
    intersectYears(b.constraint, gen.yearMin, gen.yearMax);
    // Enrich the variant's existing chip rather than adding a second one for
    // the same token — the inference stays visible and dismissible (SPEC 2).
    const chip = b.assumptions.find((a) => a.source === 'variant' && a.input === raw);
    if (chip) {
      chip.meaning = `${entry.term} on the ${b.chassisCode} → ${gen.yearMin}–${gen.yearMax}`;
      chip.reason = `${chip.reason}; ${b.chassisCode}-generation ${entry.term} model years (the chassis window's boundary years belong to the neighboring generation)`;
    }
  }
}

// Attach "gen N" / "facelift" to the resolved family via the compiled
// catalog. Honesty rules: an ordinal the catalog doesn't have, or a phase
// the generation never split into, becomes a visible chip saying exactly
// that — never a silent guess, never a silent drop (SPEC 2).
function refineCatalogGeneration(b: Working): void {
  if (!b.genOrdinal && !b.genPhase) return;
  const family = familyForConstraint(b.constraint.make, b.constraint.models);
  const said = [b.genOrdinal?.raw, b.genPhase?.raw].filter(Boolean).join(' ');
  if (!family || family.generations.length === 0) {
    addUnfilterable(b.constraint, said, 'independent generation boundaries are unavailable', false);
    b.assumptions.push({
      source: 'generation',
      input: said,
      meaning: 'no generation data for this vehicle yet',
      reason:
        'independently sourced generation boundaries are unavailable for this family; years were not narrowed',
    });
    return;
  }

  let gen;
  if (b.genOrdinal) {
    gen = family.generations.find((g) => g.ordinal === b.genOrdinal!.n);
    if (!gen) {
      b.assumptions.push({
        source: 'generation',
        input: b.genOrdinal.raw,
        meaning: `${family.family} has ${family.generations.length} generation(s) on record`,
        reason: `no generation ${b.genOrdinal.n} in the compiled catalog; years were not narrowed`,
      });
      return;
    }
  } else if (family.generations.length === 1) {
    gen = family.generations[0];
  } else {
    const withPhases = family.generations.filter((g) => g.phases && g.phases.length > 0);
    if (withPhases.length === 1) gen = withPhases[0];
  }
  if (!gen) {
    b.assumptions.push({
      source: 'generation',
      input: b.genPhase!.raw,
      meaning: `which generation? ${family.family} has ${family.generations.length}`,
      reason: 'a facelift needs a generation; add one (e.g. "gen 2") to narrow years',
    });
    return;
  }

  if (b.genOrdinal) {
    intersectYears(b.constraint, gen.yearMin, gen.yearMax);
    b.assumptions.push({
      source: 'generation',
      input: b.genOrdinal.raw,
      meaning: `${family.make} ${family.family} ${gen.name}, ${gen.yearMin}–${gen.yearMax}`,
      reason: `generation catalog, compiled ${family.compiledOn} from the vehicle data with cited research`,
    });
  }

  if (b.genPhase) {
    const phase = gen.phases?.find((p) => p.kind === b.genPhase!.kind);
    if (phase) {
      intersectYears(b.constraint, phase.yearMin, phase.yearMax);
      b.assumptions.push({
        source: 'generation',
        input: b.genPhase.raw,
        meaning: `${gen.name} ${b.genPhase.kind}, ${phase.yearMin}–${phase.yearMax}`,
        reason: `generation catalog, compiled ${family.compiledOn} from the vehicle data with cited research`,
      });
    } else {
      b.assumptions.push({
        source: 'generation',
        input: b.genPhase.raw,
        meaning: `${gen.name} has no ${b.genPhase.kind} split on record`,
        reason: 'the compiled catalog shows no facelift boundary inside this generation',
      });
    }
  }
}

function applyModelWord(b: Working, m: ModelWord, raw: string): void {
  if (!setMake(b, m.make, raw)) return;
  if (!narrowModels(b, m.models, raw)) return;
  intersectYears(b.constraint, m.yearMin, m.yearMax);
  if (m.note) {
    b.assumptions.push({
      source: 'model',
      input: raw,
      meaning: `${m.make} ${m.models.map(stripPct).join('/')}`,
      reason: m.note,
    });
  }
}

// ── Pass B: context-dependent specs and negations ────────────────────────

// 'turbo' names a trim where the Turbo badge is a distinct model line.
function isTurboTrimContext(c: Constraint): boolean {
  const models = c.models ?? [];
  return (
    (c.make === 'Porsche' && models.includes('911')) ||
    (c.make === 'Toyota' && models.some((m) => m === 'Supra' || m === 'GR Supra'))
  );
}

function applyTurboWord(b: Working, raw: string): void {
  if (isTurboTrimContext(b.constraint)) {
    pushTrimGroup(b.constraint, ['Turbo']);
    b.assumptions.push({
      source: 'keyword',
      input: raw,
      meaning: `the Turbo trim of the ${b.constraint.make} ${(b.constraint.models ?? []).map(stripPct).join('/')}`,
      reason: 'here "turbo" names a distinct model line, not turbocharging in general',
    });
    return;
  }
  if (raw === 'tt' && (b.constraint.make === 'Audi' || !b.constraint.make)) {
    if (!setMake(b, 'Audi', raw)) return;
    if (!narrowModels(b, ['TT%'], raw)) return;
    b.assumptions.push({
      source: 'keyword',
      input: raw,
      meaning: 'Audi TT (the model)',
      reason: 'with Audi context, TT is the model, not twin-turbo',
    });
    return;
  }
  b.constraint.aspiration = 'Turbo';
  if (raw !== 'turbo') {
    b.assumptions.push({
      source: 'keyword',
      input: raw,
      meaning: 'turbocharged',
      reason: 'read as forced induction',
    });
  }
}

function addUnfilterable(c: Constraint, term: string, reason: string, forwarded: boolean): void {
  c.unfilterable ??= [];
  c.unfilterable.push({ term, reason, forwardedToListings: forwarded });
}

function applyNegation(b: Working, target: string, raw: string): boolean {
  const c = b.constraint;
  if (TURBO_WORDS.has(target)) {
    c.exclude ??= {};
    if (isTurboTrimContext(c)) {
      (c.exclude.trimContains ??= []).push('Turbo');
    } else {
      (c.exclude.aspiration ??= []).push('Turbo');
    }
    return true;
  }
  if (target === 'na' || target === 'naturally aspirated') {
    c.exclude ??= {};
    (c.exclude.aspiration ??= []).push('NA');
    return true;
  }
  if (target === 'supercharged') {
    c.exclude ??= {};
    (c.exclude.aspiration ??= []).push('Supercharged');
    return true;
  }
  const variant = lookupVariant(target);
  if (variant) {
    c.exclude ??= {};
    (c.exclude.trimContains ??= []).push(...variant.trimContains);
    return true;
  }
  if (TRANSMISSION.has(target)) {
    addUnfilterable(c, raw, 'transmission is not in the vehicle data', false);
    return true;
  }
  if (COLORS.has(target)) {
    addUnfilterable(c, raw, 'color is not in the vehicle data', false);
    return true;
  }
  return false; // unknown negation target → caller sends it to unparsed
}

function applySpec(b: Working, unit: Extract<Unit, { kind: 'spec' }>): void {
  const c = b.constraint;
  const s = unit.spec;
  switch (s.type) {
    case 'body':
      c.body = s.value;
      break;
    case 'drive':
      c.drive = s.value;
      break;
    case 'fuel':
      c.fuel = s.value;
      break;
    case 'aspiration':
      c.aspiration = s.value;
      break;
    case 'turbo':
      applyTurboWord(b, unit.raw);
      break;
    case 'engineConfig':
      if (
        b.assumptions.some((a) => a.source === 'engine') &&
        ((c.blockType !== undefined &&
          s.config.blockType !== undefined &&
          c.blockType !== s.config.blockType) ||
          (c.cylinders !== undefined &&
            s.config.cylinders !== undefined &&
            c.cylinders !== s.config.cylinders))
      ) {
        b.dead = `${unit.raw} contradicts the requested engine configuration`;
        break;
      }
      if (s.config.blockType) c.blockType = s.config.blockType;
      if (s.config.cylinders !== undefined) c.cylinders = s.config.cylinders;
      break;
    case 'doors':
      c.doors = s.value;
      break;
    case 'unfilterable':
      addUnfilterable(c, unit.raw, s.reason, s.forwarded);
      break;
  }
}

// ── Labels ───────────────────────────────────────────────────────────────

function composeLabel(c: Constraint, fallback: string): string {
  const parts: string[] = [];
  if (c.make) parts.push(c.make);
  if (c.models?.length) parts.push(c.models.map(stripPct).join('/'));
  for (const group of c.trimContains ?? []) parts.push(group[0]);
  if (c.yearMin !== undefined && c.yearMax !== undefined) parts.push(`${c.yearMin}–${c.yearMax}`);
  else if (c.yearMin !== undefined) parts.push(`${c.yearMin}+`);
  else if (c.yearMax !== undefined) parts.push(`through ${c.yearMax}`);
  return parts.join(' ') || fallback;
}

// ── Entry point ──────────────────────────────────────────────────────────

export function tokenize(raw: string): Interpretation {
  const tokens = normalizeQuery(raw);
  if (tokens.length === 0) return { branches: [], unparsed: [], conflicts: [] };

  const units = scan(tokens);
  const unparsed: string[] = [];
  const conflicts: string[] = [];

  let branches: Working[] = [{ constraint: {}, assumptions: [] }];

  // Pass A — identity units, in query order.
  for (const unit of units) {
    switch (unit.kind) {
      case 'chassis': {
        const next: Working[] = [];
        for (const b of branches) {
          if (b.dead) continue;
          for (const entry of unit.entries) {
            next.push(applyChassis(cloneWorking(b), entry, unit.raw));
          }
        }
        branches = next;
        break;
      }
      case 'engine':
        for (const b of branches) if (!b.dead) applyEngine(b, unit.entry, unit.raw);
        break;
      case 'variant':
        for (const b of branches) if (!b.dead) applyVariant(b, unit.entry, unit.raw);
        break;
      case 'model':
        for (const b of branches) if (!b.dead) applyModelWord(b, unit.entry, unit.raw);
        break;
      case 'make':
        for (const b of branches) if (!b.dead) setMake(b, unit.make, unit.raw);
        break;
      case 'year':
        for (const b of branches)
          if (!b.dead) intersectYears(b.constraint, unit.yearMin, unit.yearMax);
        break;
      case 'genOrdinal':
        for (const b of branches) if (!b.dead) b.genOrdinal = { n: unit.n, raw: unit.raw };
        break;
      case 'genPhase':
        for (const b of branches) if (!b.dead) b.genPhase = { kind: unit.phase, raw: unit.raw };
        break;
      case 'unknown':
        if (!unparsed.includes(unit.raw)) unparsed.push(unit.raw);
        break;
      default:
        break; // spec/negation wait for pass B
    }
  }

  // Pass B — spec keywords and negations, per surviving branch.
  for (const unit of units) {
    if (unit.kind === 'spec') {
      for (const b of branches) if (!b.dead) applySpec(b, unit);
    } else if (unit.kind === 'negation') {
      let handledSomewhere = false;
      for (const b of branches) {
        if (!b.dead && applyNegation(b, unit.target, unit.raw)) handledSomewhere = true;
      }
      if (!handledSomewhere && !unparsed.includes(unit.raw)) unparsed.push(unit.raw);
    }
  }

  // Generation refinement: a chassis code plus a trim family whose entry
  // knows that generation's real model years tightens the window — the
  // boundary years of a chassis calendar window belong to the neighboring
  // generation (a MY2012 GT3 RS is a 997, never a 991). Runs at the end so
  // token order ("991 gt3rs" vs "gt3rs 991") doesn't matter.
  for (const b of branches) {
    if (!b.dead) refineVariantGenerations(b);
  }
  // Catalog refinement: "gen 1" / "facelift" attach to whichever family the
  // rest of the query resolved, using the compiled, DB-validated catalog.
  for (const b of branches) {
    if (!b.dead) refineCatalogGeneration(b);
  }

  for (const b of branches) {
    if (b.dead && !conflicts.includes(b.dead)) conflicts.push(b.dead);
  }

  const seen = new Set<string>();
  const out: Branch[] = [];
  for (const b of branches) {
    if (b.dead) continue;
    if (Object.keys(b.constraint).length === 0 && b.assumptions.length === 0) continue;
    const key = JSON.stringify(b.constraint);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: composeLabel(b.constraint, tokens.join(' ')),
      constraint: b.constraint,
      assumptions: b.assumptions,
    });
  }

  return { branches: out, unparsed, conflicts };
}
