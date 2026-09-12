/**
 * Vehicle profiles: what a repair costs and what a rebuilt title does to
 * the price depend on the car. A marque tier (exotic / premium / mainstream)
 * sets the defaults — parts typicals, structural rates by chassis type,
 * paint, SRS, ADAS, HV, the rebuilt discount band, the selling channel —
 * and model overrides sharpen them for the cars the catalog actually
 * carries. Every number is a low/expected/high estimate, labeled as such
 * in the plan; the sources behind the bands are in
 * docs/salvage-economics.md §4. Unknown makes fall through to mainstream
 * and the plan says so.
 */

import type { MarqueTier, Range3, SalvageLot } from './types';

// The exit channel bands live in their own file; tiers stays the one import
// the money code reaches for (docs/salvage-economics.md §12).
export { EXIT_CHANNELS, type ExitChannelBand } from './exit-channels';

export type Chassis =
  | 'aluminum_spaceframe'
  | 'carbon_tub'
  | 'aluminum_carbon_hybrid'
  | 'aluminum_unibody'
  | 'steel_unibody';

export type Construction = { chassis: Chassis; note: string };

export type PartsTable = {
  headlamp: Range3; // each
  tailLamp: Range3; // each
  bumperCover: Range3;
  hood: Range3;
  fender: Range3; // each
  door: Range3; // each
  cooling: Range3; // the radiator/condenser/intercooler stack behind one end
  wheel: Range3; // each
  sensors: Range3; // radar, cameras, park sensors for one end
  glass: Range3; // windshield or a side glass set
  interiorLight: Range3;
  interiorHeavy: Range3;
};

export type VehicleProfile = {
  tier: MarqueTier;
  tierLabel: string;
  construction: Construction;
  hybrid: boolean;
  adas: boolean;
  midEngine: boolean;
  rebuiltDiscount: { low: number; high: number; basis: string };
  askHaircut: number;
  selling: { low: number; expected: number; high: number; channel: string; basis: string };
  titleProcess: { low: number; high: number; basis: string };
  transport: Range3 & { basis: string };
  contingencyFloor: number;
  parts: PartsTable;
  structural: Record<'light' | 'moderate' | 'heavy', Range3>;
  paint: { setup: Range3; zone: Record<'light' | 'moderate' | 'heavy', Range3> };
  mechanical: Record<'light' | 'moderate' | 'heavy', Range3>; // a suspension corner or an end's mechanicals
  harness: Range3; // 12V wiring/module work
  hv: { isolation: Range3; repair: Range3 };
  srs: Range3;
  adasCalibration: Range3;
  alignment: Range3;
  diagnostics: Range3; // module scan, keys, fault memory
  overrides: string[]; // which model overrides applied
  overriddenKeys: string[]; // profile keys (and parts sub-keys) an override changed; the evidence chip reads "override" for those
  modelNotes: string[]; // "what people miss" additions for this model
};

const r = (low: number, expected: number, high: number): Range3 => ({ low, expected, high });

// -- Shop labor rates ---------------------------------------------------------------

// What one hour of a body shop's time costs at each tier: the price of the
// labor a DIY line displaces. The rate is the posted body/refinish rate,
// because a DIY line is panel fit, lamps, cooling, interior and bolt-on
// mechanicals — the work a builder does in a driveway. Structural,
// refinish-booth and calibration work is already `who: 'pro'` and priced
// from its own tier table, and a shop's mechanical rate runs higher still,
// so a professional price on a drivetrain line is a floor
// (docs/salvage-economics.md §4.1).
export const SHOP_RATE: Record<MarqueTier, number> = {
  mainstream: 86,
  premium: 110,
  exotic: 193,
};

export const SHOP_RATE_BASIS =
  'posted body/refinish labor rates: US national average $86/h (NABR LaborRateHero, June 2026); a published tiered rate sheet runs non-luxury $86, luxury $110, exotic $193, with frame $91/$182/— and carbon or structural aluminum $233 (Formula First Collision, effective 2026-04-13); estimate (docs/salvage-economics.md §4.1)';

// -- Tier defaults ------------------------------------------------------------------

type TierDefaults = Omit<
  VehicleProfile,
  | 'construction'
  | 'hybrid'
  | 'adas'
  | 'midEngine'
  | 'overrides'
  | 'overriddenKeys'
  | 'modelNotes'
  | 'structural'
> & {
  structural: Record<Chassis, Record<'light' | 'moderate' | 'heavy', Range3>>;
  adasFromYear: number;
};

// Structural rates by chassis type: what one program's jig/section work
// costs at the worst zone's severity. Carbon heavy is priced but the
// dealbreaker rule (heavy structural on a carbon tub) fires first.
const STRUCTURAL: TierDefaults['structural'] = {
  carbon_tub: {
    light: r(1_500, 3_000, 6_000),
    moderate: r(8_000, 18_000, 40_000),
    heavy: r(25_000, 45_000, 80_000),
  },
  aluminum_spaceframe: {
    light: r(4_000, 7_000, 12_000),
    moderate: r(12_000, 20_000, 32_000),
    heavy: r(22_000, 35_000, 60_000),
  },
  aluminum_carbon_hybrid: {
    light: r(4_000, 7_500, 13_000),
    moderate: r(12_000, 22_000, 35_000),
    heavy: r(25_000, 40_000, 65_000),
  },
  aluminum_unibody: {
    light: r(2_000, 3_500, 6_000),
    moderate: r(6_000, 10_000, 16_000),
    heavy: r(12_000, 18_000, 30_000),
  },
  steel_unibody: {
    light: r(800, 1_500, 2_500),
    moderate: r(2_500, 4_000, 7_000),
    heavy: r(5_000, 8_000, 14_000),
  },
};

// Rebuilt-title retention vs clean SOLD money. The general rule is a 20–40%
// discount for an inspected rebuilt title; premium marques run 28–40% in
// owner-forum and specialist data (Porsche); for exotics no public dataset
// pairs rebuilt retail sales with clean comps, and the band is an inference
// from the thinner buyer pool, no financing, and collector aversion to
// branded VINs, shaded conservative (docs/salvage-economics.md §2).
const REBUILT_BASIS_EXOTIC =
  'rebuilt-title retention vs clean sold: 50–65% for exotics, an inference from the 20–40% general rule widened for the thin branded-title buyer pool (docs/salvage-economics.md §2)';
const REBUILT_BASIS_PREMIUM =
  'rebuilt-title retention vs clean sold: 60–72% for premium marques, from Porsche owner and specialist data (docs/salvage-economics.md §2)';
const REBUILT_BASIS_MAINSTREAM =
  'rebuilt-title retention vs clean sold: 70–80%, the KBB/AppraisalEngine 20–30% inspected-rebuilt discount (docs/salvage-economics.md §2)';

const TIERS: Record<MarqueTier, TierDefaults> = {
  exotic: {
    tier: 'exotic',
    tierLabel: 'exotic tier',
    rebuiltDiscount: { low: 0.5, high: 0.65, basis: REBUILT_BASIS_EXOTIC },
    askHaircut: 0.1, // exotic/specialty dealer asks sit 8–15% over transacted money
    selling: {
      low: 0.015,
      expected: 0.04,
      high: 0.09,
      channel: 'online enthusiast auction, else specialist consignment',
      basis:
        'seller-side costs on a six-figure rebuilt-title car: online auction listing + PPI + photography + transport to the buyer runs 1–2.5% of the sale, specialist consignment 5.5–11.5%; whether an auction house lists a branded-title exotic is not guaranteed, so the expectation sits between (docs/salvage-economics.md §3)',
    },
    titleProcess: {
      low: 150,
      high: 600,
      basis:
        'state rebuilt inspection, VIN verification, title fees; the band is national because the issuing state belongs to the buyer rather than to the car, and the tabulated per-state figures are in docs/salvage-economics.md §13; registration and use tax are separate and larger (docs/salvage-economics.md §7)',
    },
    transport: {
      ...r(1_000, 1_900, 3_400),
      basis:
        'enclosed carrier, non-running surcharge $100–300; $900–1,400 at 500 mi, $1,900–2,600 at 2,000 mi, $2,200–3,100 coast to coast for a true supercar (docs/salvage-economics.md §7)',
    },
    contingencyFloor: 5_000,
    parts: {
      headlamp: r(3_500, 6_000, 10_000), // 458 new OEM $3.1–4.1k/side, Huracán used pair $13.8k
      tailLamp: r(1_200, 2_000, 3_500),
      bumperCover: r(3_000, 5_500, 9_000),
      hood: r(4_000, 7_000, 12_000),
      fender: r(2_000, 3_500, 6_000),
      door: r(4_000, 7_000, 12_000),
      cooling: r(2_500, 5_000, 10_000),
      wheel: r(1_500, 2_500, 4_500),
      sensors: r(1_000, 2_500, 5_000),
      glass: r(1_500, 2_500, 4_500),
      interiorLight: r(500, 1_500, 3_000),
      interiorHeavy: r(5_000, 10_000, 20_000),
    },
    structural: STRUCTURAL,
    // A zone is one damage end; clear must cover whole panels, so a heavy
    // front hit is a four-panel refinish with blend ($6k–12k on an exotic)
    // and the exotic labor multiplier over a premium car is ~2.8×.
    paint: {
      setup: r(1_000, 1_500, 2_500),
      zone: {
        light: r(1_500, 2_200, 3_500),
        moderate: r(3_500, 5_500, 8_000),
        heavy: r(6_000, 9_000, 13_000),
      },
    },
    mechanical: {
      light: r(1_500, 3_000, 6_000),
      moderate: r(5_000, 9_000, 16_000),
      heavy: r(10_000, 18_000, 30_000),
    },
    harness: r(800, 2_000, 5_000),
    hv: { isolation: r(500, 1_000, 2_500), repair: r(3_000, 12_000, 35_000) },
    srs: r(6_000, 10_000, 18_000),
    adasCalibration: r(1_000, 1_800, 3_000), // radar + camera + surround view at a marque dealer
    adasFromYear: 2018,
    alignment: r(300, 450, 800), // marque four-wheel alignment; corner-weighting is quote-only
    diagnostics: r(300, 800, 2_000),
  },
  premium: {
    tier: 'premium',
    tierLabel: 'premium tier',
    rebuiltDiscount: { low: 0.6, high: 0.72, basis: REBUILT_BASIS_PREMIUM },
    askHaircut: 0.07,
    selling: {
      low: 0.01,
      expected: 0.03,
      high: 0.07,
      channel: 'online enthusiast auction or private sale',
      basis:
        'seller-side costs: listing, PPI, photography, transport to the buyer (1–2.5%); consignment 5–10% (docs/salvage-economics.md §3)',
    },
    titleProcess: {
      low: 150,
      high: 600,
      basis:
        'state rebuilt inspection, VIN verification, title fees; registration and use tax are separate (docs/salvage-economics.md §7)',
    },
    transport: {
      ...r(800, 1_500, 2_800),
      basis:
        'enclosed or flatbed, non-running surcharge; distance-dependent (docs/salvage-economics.md §7)',
    },
    contingencyFloor: 2_500,
    parts: {
      headlamp: r(1_200, 2_200, 4_000),
      tailLamp: r(500, 900, 1_600),
      bumperCover: r(800, 1_400, 2_500),
      hood: r(900, 1_600, 3_000),
      fender: r(500, 900, 1_800),
      door: r(1_200, 2_000, 3_500),
      cooling: r(800, 1_500, 3_000),
      wheel: r(600, 1_000, 2_000),
      sensors: r(600, 1_200, 2_500),
      glass: r(800, 1_200, 2_000),
      interiorLight: r(300, 800, 1_500),
      interiorHeavy: r(2_500, 5_000, 10_000),
    },
    structural: STRUCTURAL,
    paint: {
      setup: r(600, 900, 1_500),
      zone: {
        light: r(800, 1_200, 1_800),
        moderate: r(1_800, 2_800, 4_000),
        heavy: r(3_000, 4_500, 6_500),
      },
    },
    mechanical: {
      light: r(800, 1_500, 3_000),
      moderate: r(2_500, 4_500, 8_000),
      heavy: r(5_000, 9_000, 15_000),
    },
    harness: r(500, 1_200, 3_000),
    hv: { isolation: r(400, 800, 1_800), repair: r(2_000, 8_000, 25_000) },
    srs: r(3_000, 5_000, 9_000),
    adasCalibration: r(700, 1_200, 2_500), // radar + camera, independent to dealer
    adasFromYear: 2016,
    alignment: r(250, 400, 700),
    diagnostics: r(200, 500, 1_200),
  },
  mainstream: {
    tier: 'mainstream',
    tierLabel: 'mainstream tier',
    rebuiltDiscount: { low: 0.7, high: 0.8, basis: REBUILT_BASIS_MAINSTREAM },
    askHaircut: 0.05,
    selling: {
      low: 0.01,
      expected: 0.02,
      high: 0.05,
      channel: 'private sale',
      basis: 'seller-side costs: listing, detail, paperwork (docs/salvage-economics.md §3)',
    },
    titleProcess: {
      low: 130,
      high: 600,
      basis:
        'state rebuilt inspection, VIN verification, title fees; registration and use tax are separate (docs/salvage-economics.md §7)',
    },
    transport: {
      ...r(400, 800, 1_600),
      basis: 'flatbed, non-running surcharge; distance-dependent (docs/salvage-economics.md §7)',
    },
    contingencyFloor: 1_000,
    parts: {
      headlamp: r(300, 600, 1_200),
      tailLamp: r(150, 300, 600),
      bumperCover: r(250, 450, 900),
      hood: r(300, 550, 1_100),
      fender: r(150, 300, 600),
      door: r(400, 700, 1_300),
      cooling: r(300, 600, 1_200),
      wheel: r(150, 300, 600),
      sensors: r(300, 600, 1_200),
      glass: r(300, 450, 800),
      interiorLight: r(150, 400, 800),
      interiorHeavy: r(1_000, 2_500, 5_000),
    },
    structural: STRUCTURAL,
    paint: {
      setup: r(300, 500, 900),
      zone: {
        light: r(400, 600, 1_000),
        moderate: r(900, 1_400, 2_000),
        heavy: r(1_500, 2_200, 3_200),
      },
    },
    mechanical: {
      light: r(400, 800, 1_500),
      moderate: r(1_200, 2_200, 4_000),
      heavy: r(2_500, 4_500, 8_000),
    },
    harness: r(300, 700, 1_500),
    hv: { isolation: r(300, 600, 1_200), repair: r(1_500, 5_000, 15_000) },
    srs: r(1_500, 2_500, 4_500),
    adasCalibration: r(400, 700, 1_500), // CCC average $500 per calibrated repair
    adasFromYear: 2018,
    alignment: r(100, 150, 250),
    diagnostics: r(100, 250, 600),
  },
};

// -- Marque tables --------------------------------------------------------------------

const EXOTIC = /^(ferrari|lamborghini|mclaren|bugatti|pagani|koenigsegg|rolls[- ]?royce)$/i;
const PREMIUM =
  /^(porsche|aston[- ]?martin|bentley|maserati|lotus|alpine|mercedes[- ]?(benz|amg)?|bmw|audi|jaguar|land[- ]?rover|range[- ]?rover|lexus|tesla|rivian|lucid|cadillac|corvette|acura|genesis|alfa[- ]?romeo|polestar)$/i;

const CONSTRUCTION: { match: RegExp; construction: Construction; midEngine?: boolean }[] = [
  {
    match: /mclaren/i,
    construction: {
      chassis: 'carbon_tub',
      note: 'McLaren monocoques are a single carbon tub; any tub damage is factory-jig territory or a write-off.',
    },
    midEngine: true,
  },
  {
    match: /ferrari/i,
    construction: {
      chassis: 'aluminum_spaceframe',
      note: 'Modern Ferraris are bonded/welded aluminum spaceframes; structural sections are dealer-jig repairs with factory-approved bonding.',
    },
    midEngine: true,
  },
  {
    match: /lamborghini/i,
    construction: {
      chassis: 'aluminum_carbon_hybrid',
      note: 'Huracán/Aventador structures mix aluminum and carbon; front crash structures bolt on, but tub or firewall damage is not field-repairable.',
    },
    midEngine: true,
  },
  {
    match: /porsche|audi|jaguar|tesla|land rover|range rover|aston martin|lotus/i,
    construction: {
      chassis: 'aluminum_unibody',
      note: 'Aluminum-intensive unibody: structural sections need a certified aluminum shop, rivet-bonding equipment, and the marque procedure.',
    },
  },
];

const isHybrid = (lot: SalvageLot) =>
  /hybrid|plug-in|phev/i.test(`${lot.fuel ?? ''} ${lot.engine}`);

// -- Model overrides -------------------------------------------------------------------

type Override = {
  match: (lot: SalvageLot) => boolean;
  label: string;
  apply: (p: VehicleProfile) => void;
};

const OVERRIDES: Override[] = [
  {
    match: (lot) => /ferrari/i.test(lot.make) && /sf90/i.test(lot.model),
    label: 'SF90 Stradale',
    // Secondary-market OEM list prices (parts4usa, Eurospares, 2026-08):
    // front bumper $15k–38k new / $10k used, hood $10k, fenders $5k each,
    // headlamps $8k the pair, front frame complete $25k, HV pack ≈ £16k
    // (docs/salvage-economics.md §4).
    apply: (p) => {
      p.hybrid = true;
      p.adas = true;
      p.parts.headlamp = r(4_000, 6_000, 9_000);
      p.parts.bumperCover = r(10_000, 15_000, 25_000);
      p.parts.hood = r(6_000, 10_000, 14_000);
      p.parts.fender = r(4_000, 5_000, 7_000);
      p.parts.cooling = r(4_000, 8_000, 15_000);
      p.structural = {
        light: r(5_000, 9_000, 15_000),
        moderate: r(15_000, 25_000, 40_000),
        heavy: r(35_000, 50_000, 75_000), // the $25k front frame section plus certified-shop labor
      };
      p.hv = { isolation: r(800, 1_500, 3_000), repair: r(5_000, 20_000, 50_000) };
      p.mechanical.heavy = r(15_000, 25_000, 45_000); // the front e-axle lives in the corners
      p.modelNotes.push(
        'The SF90 front axle is two electric motors and their inverter behind the bumper: a front hit can total the e-axle before it touches the chassis, and no public price exists for the assembly. Price it before you bid.',
        'SF90 HV pack sits in the floor behind the seats; a car that has sat discharged for months in a yard may need pack service the photos cannot show.',
        'Ferrari has cut off factory parts supply to a branded-title 296 rebuild mid-project; assume the same posture toward an SF90 and source through the secondary OEM market.',
      );
    },
  },
  {
    match: (lot) => /ferrari/i.test(lot.make) && /296/i.test(lot.model),
    label: '296 GTB',
    // parts4usa 2026-08: front bumper $10k, hood $6k, headlamps $5k each;
    // no public price for the front structure, radiators, or the HV pack
    // (docs/salvage-economics.md §4).
    apply: (p) => {
      p.hybrid = true;
      p.adas = true;
      p.parts.headlamp = r(4_000, 5_000, 7_500);
      p.parts.bumperCover = r(7_000, 10_000, 15_000);
      p.parts.hood = r(4_500, 6_000, 9_000);
      p.hv = { isolation: r(800, 1_500, 3_000), repair: r(4_000, 15_000, 45_000) };
      p.modelNotes.push(
        'The 296 e-motor sits between the V6 and the gearbox and the HV pack under the cabin floor; a front hit rarely reaches them, a rear or underbody hit can.',
        'Ferrari stopped filling parts orders for a branded-title 296 rebuild mid-project (2025); a factory parts embargo makes the schedule and budget unbounded, so plan on the secondary OEM market.',
      );
    },
  },
  {
    match: (lot) => /ferrari/i.test(lot.make) && /458/i.test(lot.model),
    label: '458 Italia',
    // Scuderia Car Parts / parts4usa 2026-08: headlamp $3,109–4,051 new;
    // rear bumper $8,923–15,279 new / $5,500 used; carbon diffuser $16,353
    // new / $8,000 used; tail lamp $1,472 new / $899 used; rear subframe
    // $13,050 new; used F136 V8 $24,250 (docs/salvage-economics.md §4).
    apply: (p) => {
      p.hybrid = false;
      p.adas = false;
      p.parts.headlamp = r(3_100, 3_800, 5_000);
      p.parts.tailLamp = r(900, 1_500, 2_000);
      p.parts.bumperCover = r(5_500, 9_000, 16_000); // rear covers with the diffuser in play
      p.mechanical.heavy = r(15_000, 30_000, 55_000); // a rear hit reaches the F136 and the DCT
      p.modelNotes.push(
        'On a 458 the rear clip is the engine bay: rear structure damage means the F136 V8, the DCT, and the rear subframe are all in play. A used engine alone is a five-figure line.',
      );
    },
  },
  {
    match: (lot) => /lamborghini/i.test(lot.make) && /hurac/i.test(lot.model),
    label: 'Huracán EVO',
    // parts4usa / Scuderia / eBay 2026-08 (used OEM unless noted): front
    // bumper $5,500, hood $5,999, fenders $4,899 each, headlamp pair
    // $13,800, radiators $349–699, front bumper reinforcement $1,799,
    // bolt-on front-frame structure parts $102–4,102 new, complete front
    // frame assembly $4,400–13,700 used (docs/salvage-economics.md §4).
    apply: (p) => {
      p.hybrid = false;
      p.adas = true;
      p.parts.headlamp = r(5_000, 6_900, 9_000);
      p.parts.bumperCover = r(5_000, 6_500, 9_000);
      p.parts.hood = r(5_000, 6_000, 9_000);
      p.parts.fender = r(4_000, 4_900, 6_000);
      p.parts.cooling = r(1_000, 2_000, 4_000);
      p.structural = {
        light: r(3_000, 5_000, 9_000),
        moderate: r(8_000, 14_000, 25_000), // the bolt-on frame assembly plus certified labor
        heavy: r(20_000, 32_000, 55_000),
      };
      p.modelNotes.push(
        'The Huracán front crash structure and frame legs bolt to the aluminum front section; a hit that stops at the bolt-on structure is a parts job, one that reaches the tub is not.',
      );
    },
  },
  {
    match: (lot) => /mclaren/i.test(lot.make) && /artura/i.test(lot.model),
    label: 'Artura',
    // McLaren: the 7.4 kWh pack is $6–7k to replace and its modules are
    // serviceable; infotainment ECU $3,150–6,308 new; front bumper
    // assemblies $989–1,619 new; radiators ~$400–450; carbon panel work
    // $5–15k typical, £16k factory for a 600LT set; the MonoCell is
    // replaced, not repaired, when in doubt (docs/salvage-economics.md §4).
    apply: (p) => {
      p.hybrid = true;
      p.adas = true;
      p.hv = { isolation: r(800, 1_500, 3_000), repair: r(3_000, 8_000, 25_000) };
      p.parts.headlamp = r(4_500, 7_000, 11_000);
      p.parts.bumperCover = r(2_500, 4_500, 8_000);
      p.parts.cooling = r(1_000, 2_000, 4_000);
      p.parts.interiorHeavy = r(8_000, 15_000, 30_000); // seats and the infotainment ECU are what a strip job takes
      p.modelNotes.push(
        'Artura vandalism and theft-recovery lots are strip jobs: check for the infotainment ECU ($3–6k new), seats, wheels, and the HV service disconnect before pricing anything cosmetic.',
        'McLaren replaces a MonoCell rather than repair it when there is any doubt; tub damage is a factory decision and a write-off risk, not a shop quote.',
      );
    },
  },
];

// -- Public ------------------------------------------------------------------------------

export function tierFor(make: string): MarqueTier {
  const m = make.trim();
  if (EXOTIC.test(m)) return 'exotic';
  if (PREMIUM.test(m)) return 'premium';
  return 'mainstream';
}

export function constructionFor(make: string, model: string): Construction {
  const text = `${make} ${model}`;
  for (const entry of CONSTRUCTION) {
    if (entry.match.test(text)) return entry.construction;
  }
  return {
    chassis: 'steel_unibody',
    note: 'Conventional steel unibody; frame pulls are shop work, panels are workable at home.',
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Numeric tables as comparable strings, one entry per top-level key and one
// per parts sub-key, so an override's footprint can be recorded.
function snapshot(p: VehicleProfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(p)) {
    if (key === 'parts') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>))
        out[k] = JSON.stringify(v);
    } else if (!['overrides', 'overriddenKeys', 'modelNotes', 'tierLabel'].includes(key)) {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

export function profileFor(lot: SalvageLot): VehicleProfile {
  const tier = tierFor(lot.make);
  const d = TIERS[tier];
  const construction = constructionFor(lot.make, lot.model);
  const midEngine =
    CONSTRUCTION.find((c) => c.match.test(`${lot.make} ${lot.model}`))?.midEngine ?? false;
  const profile: VehicleProfile = {
    tier,
    tierLabel:
      tier === 'mainstream' && !PREMIUM.test(lot.make) && !EXOTIC.test(lot.make)
        ? `${d.tierLabel} (default for ${lot.make})`
        : d.tierLabel,
    construction,
    hybrid: isHybrid(lot),
    adas: lot.year >= d.adasFromYear,
    midEngine,
    rebuiltDiscount: clone(d.rebuiltDiscount),
    askHaircut: d.askHaircut,
    selling: clone(d.selling),
    titleProcess: clone(d.titleProcess),
    transport: clone(d.transport),
    contingencyFloor: d.contingencyFloor,
    parts: clone(d.parts),
    structural: clone(d.structural[construction.chassis]),
    paint: clone(d.paint),
    mechanical: clone(d.mechanical),
    harness: clone(d.harness),
    hv: clone(d.hv),
    srs: clone(d.srs),
    adasCalibration: clone(d.adasCalibration),
    alignment: clone(d.alignment),
    diagnostics: clone(d.diagnostics),
    overrides: [],
    overriddenKeys: [],
    modelNotes: [],
  };
  for (const o of OVERRIDES) {
    if (!o.match(lot)) continue;
    const before = snapshot(profile);
    o.apply(profile);
    profile.overrides.push(o.label);
    for (const [key, value] of Object.entries(snapshot(profile))) {
      if (before[key] !== value && !profile.overriddenKeys.includes(key)) {
        profile.overriddenKeys.push(key);
      }
    }
  }
  if (profile.overrides.length > 0) {
    profile.tierLabel = `${profile.tierLabel} · ${profile.overrides.join(', ')} overrides`;
  }
  return profile;
}
