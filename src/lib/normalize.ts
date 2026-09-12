// Normalizers from the source CSV's raw value domains to the enums the app
// filters on. Anything unrecognized becomes null — a null never matches a
// constraint, so unknown data can only widen "no match", never fabricate one.

export type Aspiration = 'NA' | 'Turbo' | 'Supercharged' | 'Twincharged';
export type Drive = 'RWD' | 'FWD' | 'AWD' | '4WD';
export type Fuel = 'GAS' | 'DIESEL' | 'FLEX' | 'HYBRID' | 'ELECTRIC';
export type BlockType = 'L' | 'V' | 'H' | 'W' | 'R';

export function normalizeAspiration(raw: string): Aspiration | null {
  if (raw === 'Naturally Aspirated') return 'NA';
  if (raw === 'Turbo/Supercharged') return 'Twincharged';
  if (raw.startsWith('Turbo')) return 'Turbo';
  if (raw === 'Supercharged') return 'Supercharged';
  return null;
}

export function normalizeDrive(raw: string): Drive | null {
  switch (raw) {
    case 'RWD':
    case 'FWD':
    case 'AWD':
    case '4WD':
      return raw;
    case '4 X 4':
      return '4WD';
    case '4 X 2':
      return 'RWD';
    default:
      return null;
  }
}

export function normalizeFuel(raw: string): Fuel | null {
  if (raw === 'GAS' || raw === 'DIESEL' || raw === 'FLEX') return raw;
  if (raw === 'BIODIESEL') return 'DIESEL';
  if (raw.includes('HYBRID') || raw === 'ELECTRIC/DIESEL' || raw === 'ELECTRIC/GAS')
    return 'HYBRID';
  if (raw.includes('EV') || raw === 'ELECTRIC') return 'ELECTRIC';
  return null;
}

export function normalizeBlock(raw: string): BlockType | null {
  return raw === 'L' || raw === 'V' || raw === 'H' || raw === 'W' || raw === 'R' ? raw : null;
}

export function toInt(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export function parseLiters(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)L?$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}
