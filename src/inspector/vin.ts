import type { VinCheck } from './types';

// Structural VIN decode with claimed-vs-decoded mismatch detection. This is
// deliberately scoped to what can be verified offline from the VIN string
// itself: check digit, country, manufacturer, model-year code. We do not
// query title/theft/accident databases, so no history verdict is ever
// printed — the `note` says exactly what was not checked.

const COUNTRY_BY_FIRST: Record<string, string> = {
  '1': 'United States',
  '4': 'United States',
  '5': 'United States',
  '2': 'Canada',
  '3': 'Mexico',
  '9': 'Brazil',
  J: 'Japan',
  K: 'South Korea',
  L: 'China',
  S: 'United Kingdom',
  T: 'Czech Republic / Switzerland',
  V: 'France / Spain',
  W: 'Germany',
  Y: 'Sweden / Finland',
  Z: 'Italy',
};

// Real-world WMI prefixes for makes this app is likely to see. Longest
// prefix wins; unknown WMIs decode no make and can never create a mismatch.
const MAKE_BY_WMI: [string, string][] = [
  ['WBS', 'BMW M'],
  ['WBA', 'BMW'],
  ['WBY', 'BMW'],
  ['4US', 'BMW'],
  ['5UX', 'BMW'],
  ['WP0', 'Porsche'],
  ['WP1', 'Porsche'],
  ['WAU', 'Audi'],
  ['WA1', 'Audi'],
  ['WUA', 'Audi'],
  ['TRU', 'Audi'],
  ['WVW', 'Volkswagen'],
  ['3VW', 'Volkswagen'],
  ['WDB', 'Mercedes-Benz'],
  ['WDD', 'Mercedes-Benz'],
  ['W1K', 'Mercedes-Benz'],
  ['JF1', 'Subaru'],
  ['JF2', 'Subaru'],
  // Subaru-built twins: FR-S/86/BRZ share Fuji Heavy's plant and WMI.
  ['JF1ZN', 'Scion / Toyota (Subaru-built)'],
  ['JF1ZC', 'Subaru BRZ'],
  ['JF1ZD', 'Subaru BRZ'],
  ['4S3', 'Subaru'],
  ['JT', 'Toyota'],
  ['4T1', 'Toyota'],
  ['5TD', 'Toyota'],
  ['JHM', 'Honda'],
  ['JH4', 'Acura'],
  ['1HG', 'Honda'],
  ['2HG', 'Honda'],
  ['19U', 'Acura'],
  ['JM1', 'Mazda'],
  ['4F', 'Mazda'],
  ['JN1', 'Nissan'],
  ['JN8', 'Nissan'],
  ['JNK', 'Infiniti'],
  ['JNR', 'Infiniti'],
  ['JA', 'Mitsubishi'],
  ['KMH', 'Hyundai'],
  ['KNA', 'Kia'],
  ['KND', 'Kia'],
  ['1FA', 'Ford'],
  ['1FT', 'Ford'],
  ['1FM', 'Ford'],
  ['1G1', 'Chevrolet'],
  ['1GC', 'Chevrolet'],
  ['1G6', 'Cadillac'],
  ['1C3', 'Chrysler'],
  ['1C4', 'Jeep'],
  ['2C3', 'Dodge / Chrysler'],
  ['1B3', 'Dodge'],
  ['5YJ', 'Tesla'],
  ['SAL', 'Land Rover'],
  ['SAJ', 'Jaguar'],
  ['SCC', 'Lotus'],
  ['SBM', 'McLaren'],
  ['ZFF', 'Ferrari'],
  ['ZAM', 'Maserati'],
  ['ZAR', 'Alfa Romeo'],
  ['ZHW', 'Lamborghini'],
];

// Model-year codes (position 10) repeat on a 30-year cycle; both candidates
// are computed and the one nearest the claimed year wins.
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
const CYCLE_START = 1980;
const CYCLE = 30;

// Standard VIN check-digit transliteration and weights (49 CFR 565).
const TRANSLIT: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(vin: string): string {
  return vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isWellFormedVin(vin: string): boolean {
  return vin.length === 17 && !/[IOQ]/.test(vin);
}

export function checkDigitValid(vin: string): boolean {
  if (!isWellFormedVin(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const value = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
    if (value === undefined) return false;
    sum += value * WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return vin[8] === expected;
}

export function decodeYearCandidates(code: string): number[] {
  const idx = YEAR_CODES.indexOf(code);
  if (idx === -1) return [];
  const base = CYCLE_START + idx;
  return [base, base + CYCLE, base + 2 * CYCLE].filter((y) => y <= new Date().getFullYear() + 1);
}

// Longest prefix wins against the whole VIN: 'JF1ZN' (Subaru-built 86/FR-S)
// must beat 'JF1' (Subaru) even though both live in the first five chars.
function decodeMake(vin: string): string | undefined {
  let best: string | undefined;
  let bestLen = 0;
  for (const [prefix, make] of MAKE_BY_WMI) {
    if (vin.startsWith(prefix) && prefix.length > bestLen) {
      best = make;
      bestLen = prefix.length;
    }
  }
  return best;
}

function makesAgree(decoded: string, claimed: string): boolean {
  const d = decoded.toLowerCase();
  const c = claimed.toLowerCase().trim();
  // "BMW M" agrees with "BMW"; "Dodge / Chrysler" agrees with either.
  return d.includes(c) || c.includes(d.split(/[\s/]/)[0]);
}

// History services the buyer can actually use, pre-filled. We link, we never
// claim to have checked — SPEC 26 forbids printing a history verdict.
export function vinLinks(vin: string): { label: string; url: string }[] {
  const clean = normalizeVin(vin);
  return [
    { label: 'Carfax report (paid)', url: `https://www.carfax.com/vehicle/${clean}` },
    { label: 'NICB VINCheck — theft & salvage (free)', url: 'https://www.nicb.org/vincheck' },
    {
      label: 'NHTSA recalls by VIN (free)',
      url: `https://www.nhtsa.gov/recalls?vin=${clean}`,
    },
  ];
}

export function checkVin(vin: string, claimed: { make: string; year: number }): VinCheck {
  const clean = normalizeVin(vin);
  const note =
    'Structural decode only: title, theft, odometer, and accident history were not checked (no NMVTIS/Carfax integration).';

  if (!isWellFormedVin(clean)) {
    return {
      vin: clean,
      valid: false,
      mismatches:
        clean.length === 17
          ? ['VIN contains I, O, or Q, never valid in a real VIN']
          : [`VIN is ${clean.length} characters; a VIN is exactly 17`],
      note,
      links: vinLinks(clean),
    };
  }

  const mismatches: string[] = [];
  const wmi = clean.slice(0, 3);
  const country = COUNTRY_BY_FIRST[clean[0]];
  const make = decodeMake(clean);

  if (make && !makesAgree(make, claimed.make)) {
    mismatches.push(`VIN decodes to ${make} (${wmi}); listing claims ${claimed.make}`);
  }

  const candidates = decodeYearCandidates(clean[9]);
  let year: number | undefined;
  if (candidates.length > 0) {
    year = candidates.reduce((best, y) =>
      Math.abs(y - claimed.year) < Math.abs(best - claimed.year) ? y : best,
    );
    if (Math.abs(year - claimed.year) > 1) {
      mismatches.push(`VIN model-year code reads ${year}; listing claims ${claimed.year}`);
    }
  }

  // The check digit is mandatory for North-American-market VINs; elsewhere
  // it is often unused, so a failure there is not evidence of anything.
  const northAmerican = /[1-5]/.test(clean[0]);
  if (northAmerican && !checkDigitValid(clean)) {
    mismatches.push('VIN check digit fails: mistyped VIN or a re-stamped plate');
  }

  return {
    vin: clean,
    valid: true,
    decoded: { country, make, year, wmi, serial: clean.slice(11) },
    mismatches,
    note,
    links: vinLinks(clean),
  };
}

// -- Federal decode (NHTSA vPIC) ----------------------------------------------

// The real thing: the same database NHTSA uses, free, no key. The fetcher is
// injected so everything below tests offline; the live default has a hard
// timeout because the VIN stage must never hang an inspection.

export type VpicDecoded = {
  make?: string;
  model?: string;
  year?: number;
  trim?: string;
  bodyClass?: string;
  engine?: string;
  plant?: string;
};

export type VpicFetcher = (url: string) => Promise<unknown>;

export const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

export const defaultVpicFetcher: VpicFetcher = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`vPIC responded ${res.status}`);
  return res.json();
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

export function parseVpicResponse(raw: unknown): VpicDecoded {
  const results = (raw as { Results?: unknown[] } | null)?.Results;
  const row = Array.isArray(results) ? (results[0] as Record<string, unknown>) : undefined;
  if (!row) throw new Error('vPIC returned no results');

  const displacement = str(row.DisplacementL);
  const cylinders = str(row.EngineCylinders);
  const engine =
    displacement || cylinders
      ? [displacement && `${Number(displacement).toFixed(1)}L`, cylinders && `${cylinders}cyl`]
          .filter(Boolean)
          .join(' ')
      : undefined;

  const plantCity = str(row.PlantCity);
  const plantCountry = str(row.PlantCountry);
  const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

  return {
    make: str(row.Make) && titleCase(str(row.Make) as string),
    model: str(row.Model),
    year: str(row.ModelYear) ? Number(row.ModelYear) : undefined,
    trim: str(row.Trim),
    bodyClass: str(row.BodyClass),
    engine,
    plant:
      plantCity || plantCountry
        ? [plantCity && titleCase(plantCity), plantCountry && titleCase(plantCountry)]
            .filter(Boolean)
            .join(', ')
        : undefined,
  };
}

export async function decodeVinVpic(vin: string, fetcher: VpicFetcher): Promise<VpicDecoded> {
  const clean = normalizeVin(vin);
  const raw = await fetcher(`${VPIC_BASE}/${encodeURIComponent(clean)}?format=json`);
  return parseVpicResponse(raw);
}
